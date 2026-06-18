import 'dotenv/config';

import { createChainReadService } from '../lib/chain.mjs';
import { createPostgresStore, reconcileFromChain } from '../server.mjs';

// Rebuild / repair Postgres terminal state from on-chain PaymentExecuted events.
// This is the executable proof that Postgres is a disposable projection of
// Sui + Walrus: clear the executed status / txDigest / walrusBlobId of any
// payment_intents row and this script recovers it from chain.
//
// Usage:
//   DATABASE_URL=... PACKAGE_ID=0x... [SUI_NETWORK=testnet] \
//     node scripts/reconcile_from_chain.mjs

const packageId = process.env.PACKAGE_ID;
if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required.');
}
if (!packageId) {
    throw new Error('PACKAGE_ID is required.');
}

const store = createPostgresStore(process.env.DATABASE_URL);
const chainService = createChainReadService({
    packageId,
    network: process.env.SUI_NETWORK ?? 'testnet',
});

try {
    const report = await reconcileFromChain(store, chainService, {
        maxPages: Number.parseInt(process.env.RECONCILE_MAX_PAGES ?? '20', 10),
        pageSize: Number.parseInt(process.env.RECONCILE_PAGE_SIZE ?? '50', 10),
    });
    console.log('[reconcile] report:', JSON.stringify(report, null, 2));
} finally {
    await store.close?.();
}
