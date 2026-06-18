import { strict as assert } from 'node:assert';
import { mock, test } from 'node:test';
import {
  ProducerApiClient,
  buildIntentSignaturePayload,
} from '../dist/producer.js';

const addressA = `0x${'a'.repeat(64)}`;
const addressB = `0x${'b'.repeat(64)}`;
const objectA = `0x${'1'.repeat(64)}`;
const objectB = `0x${'2'.repeat(64)}`;
const usdcType = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';

test('intent signature payload includes stablecoin atomic amount fields', () => {
  const payload = buildIntentSignaturePayload({
    intentId: 'intent_1',
    merchantOrderId: 'order_1',
    agentAddress: addressA,
    walletId: objectA,
    sessionCapId: objectB,
    recipient: addressB,
    amountAtomic: 1_250_000,
    amountMist: 1_250_000,
    coinType: usdcType,
    executionRail: 'native_gasless',
    requiresSponsor: false,
    sponsorFeeAtomic: 0,
    sponsorFeeRecipient: null,
    currency: 'USDC',
    currencySymbol: 'USDC',
    reason: 'checkout payment',
    expiresAtMs: 1_800_000_000_000,
    metadata: { checkoutSessionId: 'session_1' },
  });

  assert.equal(payload.amountAtomic, 1_250_000);
  assert.equal(payload.amountMist, 1_250_000);
  assert.equal(payload.coinType, usdcType);
  assert.equal(payload.executionRail, 'native_gasless');
  assert.equal(payload.requiresSponsor, false);
  assert.equal(payload.sponsorFeeAtomic, 0);
  assert.equal(payload.sponsorFeeRecipient, null);
  assert.equal(payload.currencySymbol, 'USDC');
});

test('producer client requests a sponsor signature for a claimed intent', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(String(url), 'http://producer.test/v1/intents/intent_1/sponsor');
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      agentAddress: addressA,
      walrusBlobId: 'blob_123',
    });

    return new Response(JSON.stringify({
      sponsor: {
        transactionBytes: 'AAECAw==',
        sponsorSignature: 'sponsor_sig',
        gasBudget: 10_000_000,
        sponsorFeeAtomic: 12_500,
        sponsorFeeRecipient: addressB,
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  try {
    const client = new ProducerApiClient({ baseUrl: 'http://producer.test' });
    const response = await client.requestSponsor('intent_1', {
      agentAddress: addressA,
      walrusBlobId: 'blob_123',
    });

    assert.equal(response.transactionBytes, 'AAECAw==');
    assert.equal(response.sponsorSignature, 'sponsor_sig');
    assert.equal(response.gasBudget, 10_000_000);
    assert.equal(response.sponsorFeeAtomic, 12_500);
    assert.equal(response.sponsorFeeRecipient, addressB);
    assert.equal(fetchMock.mock.callCount(), 1);
  } finally {
    fetchMock.mock.restore();
  }
});

test('producer client defaults new intents to auto execution rail', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(String(url), 'http://producer.test/v1/intents');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.executionRail, 'auto');
    assert.equal(body.amountAtomic, 1_000_000);

    return new Response(JSON.stringify({
      intent: {
        intentId: 'intent_auto',
        merchantOrderId: body.merchantOrderId,
        agentAddress: body.agentAddress,
        walletId: null,
        sessionCapId: null,
        recipient: body.recipient,
        amountAtomic: body.amountAtomic,
        amountMist: body.amountMist,
        coinType: body.coinType,
        executionRail: 'native_gasless',
        requiresSponsor: false,
        sponsorFeeAtomic: 0,
        sponsorFeeRecipient: null,
        currency: body.currency,
        currencySymbol: body.currencySymbol,
        reason: body.reason,
        expiresAtMs: body.expiresAtMs,
        status: 'pending',
        attemptCount: 0,
        signature: 'sig',
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  });

  try {
    const client = new ProducerApiClient({ baseUrl: 'http://producer.test', apiKey: 'demo-key' });
    const intent = await client.createIntent({
      merchantOrderId: 'order_auto',
      agentAddress: addressA,
      recipient: addressB,
      amountAtomic: 1_000_000,
      reason: 'auto rail checkout',
      expiresAtMs: 1_800_000_000_000,
    });

    assert.equal(intent.executionRail, 'native_gasless');
    assert.equal(fetchMock.mock.callCount(), 1);
  } finally {
    fetchMock.mock.restore();
  }
});
