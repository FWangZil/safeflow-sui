import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import {
  createInMemoryStore,
  createServerApp,
  DEFAULT_COIN_TYPE,
} from '../server.mjs';

const agentAddress = `0x${'a'.repeat(64)}`;
const payoutAddress = `0x${'b'.repeat(64)}`;
const sponsorFeeRecipient = `0x${'d'.repeat(64)}`;
const walletId = `0x${'1'.repeat(64)}`;
const sessionCapId = `0x${'2'.repeat(64)}`;

let server;
let baseUrl;

before(async () => {
  const store = createInMemoryStore();
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

  server = createServerApp({
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
    },
    sponsorService: {
      sponsorIntent: async ({ intent, agentAddress: requestedAgent, walrusBlobId, sponsorFeeAtomic, sponsorFeeRecipient: requestedFeeRecipient }) => {
        assert.equal(intent.status, 'claimed');
        assert.equal(requestedAgent, agentAddress);
        assert.equal(walrusBlobId, 'blob_123');
        assert.equal(requestedFeeRecipient, sponsorFeeRecipient);
        return {
          transactionBytes: 'AAECAw==',
          sponsorSignature: 'sponsor_sig',
          gasBudget: 10_000_000,
          sponsorFeeAtomic,
          sponsorFeeRecipient: requestedFeeRecipient,
        };
      },
    },
  });

  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('checkout session auto-selects native gasless for simple allowlisted stablecoin payment', async () => {
  const createResponse = await fetch(`${baseUrl}/v1/checkout/sessions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'demo-key',
    },
    body: JSON.stringify({
      merchantOrderId: 'order_1',
      amountAtomic: 1_250_000,
      reason: 'AI agent checkout demo',
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();

  assert.equal(created.session.status, 'created');
  assert.equal(created.session.merchantOrderId, 'order_1');
  assert.equal(created.session.amountAtomic, 1_250_000);
  assert.equal(created.session.coinType, DEFAULT_COIN_TYPE);
  assert.equal(created.session.executionRail, 'native_gasless');
  assert.equal(created.session.requiresSponsor, false);
  assert.equal(created.session.sponsorFeeAtomic, 0);
  assert.equal(created.session.sponsorFeeRecipient, null);
  assert.match(created.session.checkoutUrl, /^http:\/\/checkout\.test\/checkout\?sessionId=/);
  assert.equal(created.intent.status, 'pending');
  assert.equal(created.intent.agentAddress, agentAddress);
  assert.equal(created.intent.walletId, null);
  assert.equal(created.intent.sessionCapId, null);
  assert.equal(created.intent.currencySymbol, 'USDC');
  assert.equal(created.intent.executionRail, 'native_gasless');
  assert.equal(created.intent.requiresSponsor, false);
  assert.equal(created.intent.sponsorFeeAtomic, 0);
  assert.equal(created.intent.sponsorFeeRecipient, null);

  const nextResponse = await fetch(`${baseUrl}/v1/intents/next?agentAddress=${agentAddress}`);
  assert.equal(nextResponse.status, 200);
  const next = await nextResponse.json();
  assert.equal(next.intent.intentId, created.intent.intentId);
  assert.equal(next.intent.amountAtomic, 1_250_000);
  assert.equal(next.intent.coinType, DEFAULT_COIN_TYPE);
});

test('checkout session auto-selects sponsored guard when SessionCap guard is requested', async () => {
  const createResponse = await fetch(`${baseUrl}/v1/checkout/sessions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'demo-key',
    },
    body: JSON.stringify({
      merchantOrderId: 'order_auto_guard',
      requiresGuard: true,
      amountAtomic: 1_250_000,
      reason: 'Guarded agent checkout demo',
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();

  assert.equal(created.session.executionRail, 'sponsored_guard');
  assert.equal(created.session.requiresSponsor, true);
  assert.equal(created.session.sponsorFeeAtomic, 12_500);
  assert.equal(created.session.sponsorFeeRecipient, sponsorFeeRecipient);
  assert.equal(created.intent.walletId, walletId);
  assert.equal(created.intent.sessionCapId, sessionCapId);
});

test('checkout session can request native gasless stablecoin rail without SessionCap guard', async () => {
  const createResponse = await fetch(`${baseUrl}/v1/checkout/sessions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'demo-key',
    },
    body: JSON.stringify({
      merchantOrderId: 'order_native_gasless',
      executionRail: 'native_gasless',
      amountAtomic: 2_500_000,
      reason: 'Simple gasless USDC transfer',
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();

  assert.equal(created.session.executionRail, 'native_gasless');
  assert.equal(created.intent.executionRail, 'native_gasless');
  assert.equal(created.intent.walletId, null);
  assert.equal(created.intent.sessionCapId, null);
  assert.equal(created.intent.requiresSponsor, false);
  assert.equal(created.intent.sponsorFeeAtomic, 0);
  assert.equal(created.intent.sponsorFeeRecipient, null);
});

test('native gasless intent rejects sponsor requests', async () => {
  const createResponse = await fetch(`${baseUrl}/v1/checkout/sessions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'demo-key',
    },
    body: JSON.stringify({
      merchantOrderId: 'order_native_no_sponsor',
      executionRail: 'native_gasless',
      amountAtomic: 1_000_000,
      reason: 'Native rail should not sponsor',
    }),
  });
  const created = await createResponse.json();

  await fetch(`${baseUrl}/v1/intents/${created.intent.intentId}/ack`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agentAddress,
      nonce: 'nonce_native_12345',
    }),
  });

  const sponsorResponse = await fetch(`${baseUrl}/v1/intents/${created.intent.intentId}/sponsor`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agentAddress,
      walrusBlobId: 'blob_native',
    }),
  });
  assert.equal(sponsorResponse.status, 409);
});

test('ACK moves checkout status to claimed and sponsor endpoint returns gasless transaction bytes', async () => {
  const createResponse = await fetch(`${baseUrl}/v1/checkout/sessions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'demo-key',
    },
    body: JSON.stringify({
      merchantOrderId: 'order_sponsor_execution',
      executionRail: 'auto',
      requiresGuard: true,
      amountAtomic: 1_250_000,
      reason: 'Sponsored guard execution',
    }),
  });
  const next = await createResponse.json();

  const ackResponse = await fetch(`${baseUrl}/v1/intents/${next.intent.intentId}/ack`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      agentAddress,
      nonce: 'nonce_12345',
    }),
  });
  assert.equal(ackResponse.status, 200);
  const acked = await ackResponse.json();
  assert.equal(acked.intent.status, 'claimed');

  const sessionResponse = await fetch(`${baseUrl}/v1/checkout/sessions/${acked.intent.checkoutSessionId}`);
  assert.equal(sessionResponse.status, 200);
  const sessionPayload = await sessionResponse.json();
  assert.equal(sessionPayload.session.status, 'claimed');

  const sponsorResponse = await fetch(`${baseUrl}/v1/intents/${acked.intent.intentId}/sponsor`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      agentAddress,
      walrusBlobId: 'blob_123',
    }),
  });
  assert.equal(sponsorResponse.status, 200);
  const sponsorPayload = await sponsorResponse.json();
  assert.deepEqual(sponsorPayload.sponsor, {
    transactionBytes: 'AAECAw==',
    sponsorSignature: 'sponsor_sig',
    gasBudget: 10_000_000,
    sponsorFeeAtomic: 12_500,
    sponsorFeeRecipient,
  });

  const resultResponse = await fetch(`${baseUrl}/v1/intents/${acked.intent.intentId}/result`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      agentAddress,
      success: true,
      txDigest: 'demo_tx_digest',
      walrusBlobId: 'blob_123',
    }),
  });
  assert.equal(resultResponse.status, 200);
  const resultPayload = await resultResponse.json();
  assert.equal(resultPayload.intent.status, 'executed');

  const executedSessionResponse = await fetch(`${baseUrl}/v1/checkout/sessions/${acked.intent.checkoutSessionId}`);
  const executedSessionPayload = await executedSessionResponse.json();
  assert.equal(executedSessionPayload.session.status, 'executed');
  assert.equal(executedSessionPayload.session.txDigest, 'demo_tx_digest');
});
