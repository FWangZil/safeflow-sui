import { strict as assert } from 'node:assert';
import { after, before, beforeEach, test } from 'node:test';
import {
  createInMemoryStore,
  createServerApp,
  reconcileFromChain,
  DEFAULT_COIN_TYPE,
} from '../server.mjs';

const agentAddress = `0x${'a'.repeat(64)}`;
const payoutAddress = `0x${'b'.repeat(64)}`;
const sponsorFeeRecipient = `0x${'d'.repeat(64)}`;
const walletId = `0x${'1'.repeat(64)}`;
const sessionCapId = `0x${'2'.repeat(64)}`;

// Fake chain service: returns whatever the test arms it with.
let chainResponse;
const chainService = {
  paymentExecutedType: '0xpkg::wallet::PaymentExecuted',
  async verifyPaymentExecuted({ txDigest, expected }) {
    chainService.lastVerify = { txDigest, expected };
    return chainResponse;
  },
  async queryPaymentExecutedEvents() {
    return { data: chainService.events ?? [], nextCursor: null, hasNextPage: false };
  },
};

let server;
let baseUrl;

async function buildServer(store) {
  const srv = createServerApp({
    store,
    config: {
      appUrl: 'http://checkout.test',
      defaultCoinType: DEFAULT_COIN_TYPE,
      defaultCurrencySymbol: 'USDC',
      defaultCurrencyDecimals: 6,
      signingSecret: 'test-secret',
      sponsorMaxGasBudget: 10_000_000,
      sponsorFeeBps: 100,
      sponsorMinFeeAtomic: 10,
      sponsorFeeRecipient,
      requireOnchainVerify: true,
      adminToken: 'admin-secret',
    },
    sponsorService: {
      sponsorIntent: async ({ sponsorFeeAtomic, sponsorFeeRecipient: feeRecipient }) => ({
        transactionBytes: 'AAECAw==',
        sponsorSignature: 'sponsor_sig',
        gasBudget: 10_000_000,
        sponsorFeeAtomic,
        sponsorFeeRecipient: feeRecipient,
      }),
    },
    chainService,
  });
  await new Promise((resolve) => srv.listen(0, resolve));
  return srv;
}

async function seed(store) {
  await store.seedDemo({
    merchantId: 'merchant_demo',
    merchantName: 'Demo Merchant',
    apiKey: 'demo-key',
    payoutAddress,
    agentAddress,
    walletId,
    sessionCapId,
    coinType: DEFAULT_COIN_TYPE,
  });
}

async function createGuardedIntent(orderId, amountAtomic) {
  const createResponse = await fetch(`${baseUrl}/v1/checkout/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'demo-key' },
    body: JSON.stringify({ merchantOrderId: orderId, requiresGuard: true, amountAtomic, reason: 'verify test' }),
  });
  const created = await createResponse.json();
  await fetch(`${baseUrl}/v1/intents/${created.intent.intentId}/ack`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentAddress, nonce: `nonce_${orderId}_xyz` }),
  });
  await fetch(`${baseUrl}/v1/intents/${created.intent.intentId}/sponsor`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentAddress, walrusBlobId: 'blob_real' }),
  });
  return created.intent;
}

function reportResult(intentId, body) {
  return fetch(`${baseUrl}/v1/intents/${intentId}/result`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentAddress, ...body }),
  }).then((r) => r.json());
}

let store;
before(async () => {
  store = createInMemoryStore();
  await seed(store);
  server = await buildServer(store);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

beforeEach(() => {
  chainResponse = { ok: true, onchainWalrusBlobId: 'blob_real' };
});

test('forged success result is rejected when on-chain verification fails', async () => {
  const intent = await createGuardedIntent('order_forged', 1_250_000);
  chainResponse = { ok: false, mismatchReason: 'payment_executed_event_missing' };

  const payload = await reportResult(intent.intentId, {
    success: true,
    txDigest: 'forged_digest',
    walrusBlobId: 'blob_agent_claimed',
  });

  assert.equal(payload.intent.status, 'failed');
  assert.equal(payload.intent.errorCode, 'onchain_verification_failed');
  assert.match(payload.intent.errorMessage, /payment_executed_event_missing/);
});

test('verified success writes executed and prefers the on-chain walrus blob id', async () => {
  const intent = await createGuardedIntent('order_verified', 1_250_000);
  chainResponse = { ok: true, onchainWalrusBlobId: 'blob_onchain_wins' };

  const payload = await reportResult(intent.intentId, {
    success: true,
    txDigest: 'real_digest',
    walrusBlobId: 'blob_agent_claimed',
  });

  assert.equal(payload.intent.status, 'executed');
  assert.equal(payload.intent.txDigest, 'real_digest');
  assert.equal(payload.intent.walrusBlobId, 'blob_onchain_wins');
  // Expected values passed to the verifier come from the intent, not the agent body.
  assert.equal(chainService.lastVerify.expected.recipient, payoutAddress);
  assert.equal(chainService.lastVerify.expected.amountAtomic, 1_250_000);
});

test('reconcile rebuilds executed terminal state from chain events', async () => {
  const localStore = createInMemoryStore();
  await seed(localStore);

  // Create + claim an intent directly through the store, then leave it pending
  // (as if the DB lost the executed result).
  const created = await fetch(`${baseUrl}/v1/checkout/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'demo-key' },
    body: JSON.stringify({ merchantOrderId: 'order_reconcile', requiresGuard: true, amountAtomic: 999_000, reason: 'reconcile' }),
  }).then((r) => r.json()).catch(() => null);
  assert.ok(created);

  // Look up the intent we just created in the shared store and reconcile it.
  const target = await store.findReconcilableIntent({ recipient: payoutAddress, amountAtomic: 999_000, walletId });
  assert.ok(target, 'intent should exist for reconcile');
  assert.notEqual(target.status, 'executed');

  chainService.events = [{
    id: { txDigest: 'reconciled_digest' },
    parsedJson: {
      wallet_id: walletId,
      amount: '999000',
      recipient: payoutAddress,
      walrus_blob_id: 'blob_from_chain',
    },
  }];

  const report = await reconcileFromChain(store, chainService, {});
  assert.equal(report.repaired, 1);

  const after = await store.getIntent(target.intentId);
  assert.equal(after.status, 'executed');
  assert.equal(after.txDigest, 'reconciled_digest');
  assert.equal(after.walrusBlobId, 'blob_from_chain');
});

test('admin reconcile endpoint requires a valid admin token', async () => {
  const unauthorized = await fetch(`${baseUrl}/v1/admin/reconcile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(unauthorized.status, 401);

  chainService.events = [];
  const authorized = await fetch(`${baseUrl}/v1/admin/reconcile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': 'admin-secret' },
    body: JSON.stringify({}),
  });
  assert.equal(authorized.status, 200);
});
