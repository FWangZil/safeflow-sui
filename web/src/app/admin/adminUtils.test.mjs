import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildAgentRunnerCommand,
    buildProducerEnvSnippet,
    formatAtomicAmount,
    isSuiObjectId,
} from './adminUtils.ts';

test('validates Sui object ids', () => {
    assert.equal(isSuiObjectId('0x' + 'a'.repeat(64)), true);
    assert.equal(isSuiObjectId('0x1234'), false);
    assert.equal(isSuiObjectId('not-an-object'), false);
});

test('builds producer demo env snippet without private material', () => {
    const snippet = buildProducerEnvSnippet({
        payoutAddress: '0x' + '1'.repeat(64),
        agentAddress: '0x' + '2'.repeat(64),
        walletId: '0x' + '3'.repeat(64),
        sessionCapId: '0x' + '4'.repeat(64),
    });

    assert.match(snippet, /DEMO_PAYOUT_ADDRESS=0x1{64}/);
    assert.match(snippet, /DEMO_AGENT_ADDRESS=0x2{64}/);
    assert.match(snippet, /DEMO_WALLET_ID=0x3{64}/);
    assert.match(snippet, /DEMO_SESSION_CAP_ID=0x4{64}/);
    assert.doesNotMatch(snippet, /SECRET|PRIVATE|SPONSOR/i);
});

test('formats atomic stablecoin amounts', () => {
    assert.equal(formatAtomicAmount('1250000', 6), '1.25');
    assert.equal(formatAtomicAmount('10000000', 6), '10');
    assert.equal(formatAtomicAmount('', 6), '0');
});

test('builds a local agent runner command without private material', () => {
    const command = buildAgentRunnerCommand({
        producerApiBaseUrl: 'http://localhost:8787',
        pollMs: 3000,
    });

    assert.match(command, /cd agent_scripts/);
    assert.match(command, /PRODUCER_API_BASE_URL=http:\/\/localhost:8787/);
    assert.match(command, /npm run run:e2e -- --poll-ms 3000/);
    assert.doesNotMatch(command, /SECRET|PRIVATE|KEY/i);
});
