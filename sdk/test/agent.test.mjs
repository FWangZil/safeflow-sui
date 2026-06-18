import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { toB64 } from '@mysten/sui.js/utils';
import { SafeFlowAgent } from '../dist/agent.js';

test('agent submits sponsored transaction bytes with agent and sponsor signatures', async () => {
  const agent = new SafeFlowAgent({
    packageId: `0x${'1'.repeat(64)}`,
    network: 'testnet',
  });

  let submitted;
  agent.client = {
    executeTransactionBlock: async (input) => {
      submitted = input;
      return { digest: 'digest_123' };
    },
  };

  const result = await agent.signAndSubmitSponsoredTransaction(
    toB64(new Uint8Array([1, 2, 3, 4])),
    'sponsor_sig',
  );

  assert.equal(result.digest, 'digest_123');
  assert.deepEqual(Array.from(submitted.transactionBlock), [1, 2, 3, 4]);
  assert.equal(submitted.signature.length, 2);
  assert.equal(submitted.signature[1], 'sponsor_sig');
  assert.equal(submitted.options.showEffects, true);
  assert.equal(submitted.options.showEvents, true);
});

test('agent executes native gasless stablecoin transfer without sponsor signature', async () => {
  const agent = new SafeFlowAgent({
    packageId: `0x${'1'.repeat(64)}`,
    network: 'testnet',
  });

  let submitted;
  agent.nativeGrpcClient = {
    signAndExecuteTransaction: async (input) => {
      submitted = input;
      return { digest: 'native_digest_123' };
    },
  };

  const result = await agent.executeNativeGaslessStablecoinTransfer({
    recipient: `0x${'b'.repeat(64)}`,
    amountAtomic: 1_000_000,
    coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
  });

  assert.equal(result.digest, 'native_digest_123');
  assert.equal(submitted.signer.getPublicKey().toSuiAddress(), agent.getAddress());
  assert.equal(submitted.include.effects, true);
  assert.equal(submitted.include.events, true);
  assert.equal(typeof submitted.transaction, 'object');
});
