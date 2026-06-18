import { getFullnodeUrl, SuiClient } from '@mysten/sui.js/client';

// Kept local (not imported from server.mjs) to avoid a circular import, since
// server.mjs imports this module.
const EXECUTION_RAIL_NATIVE_GASLESS = 'native_gasless';

/**
 * Chain read service: treats Sui as the source of truth for settlement.
 *
 * The Producer API used to trust whatever `txDigest` / `walrusBlobId` the agent
 * reported. This service lets the API verify those claims against on-chain facts
 * (the `agent_wallet::wallet::PaymentExecuted` event) and rebuild DB state from
 * chain, so Postgres becomes a verifiable, rebuildable projection rather than the
 * authoritative store.
 *
 * `PaymentExecuted` event fields (see agent_wallet/sources/wallet.move):
 *   wallet_id: ID, amount: u64, recipient: address, walrus_blob_id: String
 * The event carries no intent_id and no coin type (coin type lives in the move
 * call type-arg), so matching is done on recipient + amount + walrus_blob_id +
 * wallet_id.
 */
export function createChainReadService({ packageId, network = 'testnet', client } = {}) {
    if (!packageId) {
        throw new Error('PACKAGE_ID is required for chain read service.');
    }
    const sui = client ?? new SuiClient({ url: getFullnodeUrl(network) });
    const paymentExecutedType = `${packageId}::wallet::PaymentExecuted`;

    /**
     * Verify an agent-reported result against on-chain facts.
     * @returns {Promise<{ ok: boolean, onchainWalrusBlobId?: string|null, mismatchReason?: string }>}
     */
    async function verifyPaymentExecuted({ txDigest, expected = {} }) {
        if (typeof txDigest !== 'string' || txDigest.trim().length === 0) {
            return { ok: false, mismatchReason: 'missing_tx_digest' };
        }

        let tx;
        try {
            tx = await sui.getTransactionBlock({
                digest: txDigest,
                options: { showEffects: true, showEvents: true, showBalanceChanges: true },
            });
        } catch (error) {
            return { ok: false, mismatchReason: `tx_not_found:${error?.message ?? 'unknown'}` };
        }

        const status = tx?.effects?.status?.status;
        if (status !== 'success') {
            return { ok: false, mismatchReason: `tx_status_${status ?? 'unknown'}` };
        }

        // Native gasless rail is a plain coin transfer; there is no wallet event.
        if (expected.executionRail === EXECUTION_RAIL_NATIVE_GASLESS) {
            if (!matchesBalanceTransfer(tx, expected)) {
                return { ok: false, mismatchReason: 'balance_change_mismatch' };
            }
            return { ok: true, onchainWalrusBlobId: expected.walrusBlobId ?? null };
        }

        // Sponsored guard rail (default): require a matching PaymentExecuted event.
        const events = Array.isArray(tx?.events) ? tx.events : [];
        const event = events.find((entry) => entry.type === paymentExecutedType);
        if (!event) {
            return { ok: false, mismatchReason: 'payment_executed_event_missing' };
        }

        const fields = event.parsedJson ?? {};
        const mismatch = matchPaymentFields(fields, expected);
        if (mismatch) {
            return { ok: false, mismatchReason: mismatch };
        }

        return {
            ok: true,
            onchainWalrusBlobId: typeof fields.walrus_blob_id === 'string' ? fields.walrus_blob_id : null,
        };
    }

    /**
     * Stream `PaymentExecuted` events for reconcile / DB rebuild.
     * @returns {Promise<{ data: Array, nextCursor: any, hasNextPage: boolean }>}
     */
    async function queryPaymentExecutedEvents({ cursor = null, limit = 50 } = {}) {
        return sui.queryEvents({
            query: { MoveEventType: paymentExecutedType },
            cursor,
            limit,
            order: 'ascending',
        });
    }

    return {
        paymentExecutedType,
        verifyPaymentExecuted,
        queryPaymentExecutedEvents,
    };
}

/** Returns a mismatch reason string, or null when all fields match. */
function matchPaymentFields(fields, expected) {
    if (expected.recipient !== undefined
        && !addressEquals(fields.recipient, expected.recipient)) {
        return 'recipient_mismatch';
    }
    if (expected.amountAtomic !== undefined
        && String(fields.amount) !== String(expected.amountAtomic)) {
        return 'amount_mismatch';
    }
    if (expected.walrusBlobId
        && String(fields.walrus_blob_id) !== String(expected.walrusBlobId)) {
        return 'walrus_blob_id_mismatch';
    }
    if (expected.walletId
        && !addressEquals(fields.wallet_id, expected.walletId)) {
        return 'wallet_id_mismatch';
    }
    return null;
}

/** Best-effort check that a native gasless transfer reached the recipient. */
function matchesBalanceTransfer(tx, expected) {
    const changes = Array.isArray(tx?.balanceChanges) ? tx.balanceChanges : [];
    return changes.some((change) => {
        const owner = change?.owner?.AddressOwner;
        if (!owner || !addressEquals(owner, expected.recipient)) {
            return false;
        }
        if (expected.coinType && change.coinType !== expected.coinType) {
            return false;
        }
        if (expected.amountAtomic !== undefined
            && String(change.amount) !== String(expected.amountAtomic)) {
            return false;
        }
        return true;
    });
}

/** Case-insensitive compare for Sui addresses / object IDs. */
function addressEquals(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') {
        return false;
    }
    return a.toLowerCase() === b.toLowerCase();
}
