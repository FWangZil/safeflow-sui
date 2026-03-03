import 'dotenv/config';
import { getFullnodeUrl, SuiClient } from '@mysten/sui.js/client';

function getArg(name: string): string | undefined {
    const idx = process.argv.indexOf(name);
    if (idx === -1 || idx + 1 >= process.argv.length) {
        return undefined;
    }
    return process.argv[idx + 1];
}

function buildAggregatorBlobUrl(aggregatorUrl: string, blobId: string): string {
    return `${aggregatorUrl.replace(/\/+$/, '')}/v1/blobs/${encodeURIComponent(blobId)}`;
}

function buildSiteUrl(blobId: string, siteSuffix: string): string | null {
    if (!blobId || blobId.startsWith('fallback:')) {
        return null;
    }
    const suffix = siteSuffix.startsWith('.') ? siteSuffix : `.${siteSuffix}`;
    return `https://${blobId}${suffix}`;
}

async function main() {
    const packageId = process.env.PACKAGE_ID;
    if (!packageId) {
        throw new Error('Missing PACKAGE_ID in environment.');
    }

    const digest = getArg('--digest');
    if (!digest) {
        throw new Error('Missing --digest argument.');
    }

    const aggregatorUrl = getArg('--walrus-aggregator')
        ?? process.env.WALRUS_AGGREGATOR_URL
        ?? 'https://aggregator.walrus-testnet.walrus.space';
    const siteSuffix = getArg('--walrus-site-suffix')
        ?? process.env.WALRUS_SITE_SUFFIX
        ?? '.walrus.site';

    const client = new SuiClient({ url: getFullnodeUrl('testnet') });
    const tx = await client.getTransactionBlock({
        digest,
        options: { showEvents: true },
    });

    const eventType = `${packageId}::wallet::PaymentExecuted`;
    const event = (tx.events ?? []).find((candidate) => candidate.type === eventType || candidate.type.endsWith('::wallet::PaymentExecuted'));
    if (!event || typeof event.parsedJson !== 'object' || event.parsedJson === null) {
        throw new Error(`PaymentExecuted event not found in transaction ${digest}`);
    }

    const blobId = (event.parsedJson as { walrus_blob_id?: unknown }).walrus_blob_id;
    if (typeof blobId !== 'string' || blobId.length === 0) {
        throw new Error(`walrus_blob_id not found in PaymentExecuted event for transaction ${digest}`);
    }

    const aggregatorBlobUrl = buildAggregatorBlobUrl(aggregatorUrl, blobId);
    const siteUrl = buildSiteUrl(blobId, siteSuffix);

    console.log(
        JSON.stringify(
            {
                digest,
                packageId,
                walrusBlobId: blobId,
                aggregatorBlobUrl,
                siteUrl,
            },
            null,
            2,
        ),
    );
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
