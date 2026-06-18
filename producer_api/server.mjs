import 'dotenv/config';
import { createServer } from 'http';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { pathToFileURL } from 'url';
import { Pool } from 'pg';
import { getFullnodeUrl, SuiClient } from '@mysten/sui.js/client';
import { decodeSuiPrivateKey } from '@mysten/sui.js/cryptography';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { toB64 } from '@mysten/sui.js/utils';

export const DEFAULT_COIN_TYPE = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';
export const DEFAULT_CURRENCY_SYMBOL = 'USDC';
export const DEFAULT_CURRENCY_DECIMALS = 6;
export const EXECUTION_RAIL_SPONSORED_GUARD = 'sponsored_guard';
export const EXECUTION_RAIL_NATIVE_GASLESS = 'native_gasless';
export const EXECUTION_RAIL_AUTO = 'auto';

const DEFAULT_INTENT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_SPONSOR_FEE_BPS = 0;
const DEFAULT_SPONSOR_MIN_FEE_ATOMIC = 0;

export function createServerApp({
    store,
    config,
    sponsorService,
}) {
    const defaultCoinType = config.defaultCoinType ?? DEFAULT_COIN_TYPE;
    const resolvedConfig = {
        appUrl: config.appUrl ?? 'http://localhost:3000',
        defaultCoinType,
        defaultCurrencySymbol: config.defaultCurrencySymbol ?? DEFAULT_CURRENCY_SYMBOL,
        defaultCurrencyDecimals: config.defaultCurrencyDecimals ?? DEFAULT_CURRENCY_DECIMALS,
        defaultIntentTtlMs: config.defaultIntentTtlMs ?? DEFAULT_INTENT_TTL_MS,
        signingSecret: config.signingSecret ?? 'dev-secret-change-me',
        sponsorMaxGasBudget: config.sponsorMaxGasBudget ?? 10_000_000,
        sponsorFeeBps: config.sponsorFeeBps ?? DEFAULT_SPONSOR_FEE_BPS,
        sponsorMinFeeAtomic: config.sponsorMinFeeAtomic ?? DEFAULT_SPONSOR_MIN_FEE_ATOMIC,
        sponsorFeeRecipient: config.sponsorFeeRecipient ?? sponsorService?.sponsorAddress ?? null,
        nativeGaslessCoinTypes: normalizeCoinTypeList(config.nativeGaslessCoinTypes ?? [defaultCoinType]),
    };

    return createServer(async (req, res) => {
        try {
            await handleRequest(req, res, store, resolvedConfig, sponsorService);
        } catch (error) {
            const status = typeof error?.status === 'number' ? error.status : 500;
            const message = typeof error?.message === 'string' ? error.message : 'Internal server error';
            if (status >= 500) {
                console.error('[producer-api] unhandled error', error);
            }
            sendJson(res, status, { error: message });
        }
    });
}

async function handleRequest(req, res, store, config, sponsorService) {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;

    if (pathname === '/health' && req.method === 'GET') {
        sendJson(res, 200, { ok: true, nowMs: Date.now() });
        return;
    }

    if (pathname === '/v1/checkout/sessions' && req.method === 'POST') {
        const merchant = await requireMerchantAuth(req, store);
        const body = await parseJsonBody(req);
        const result = await createCheckoutSession(store, config, merchant, body);
        sendJson(res, result.wasExisting ? 200 : 201, {
            session: result.session,
            intent: result.intent,
        });
        return;
    }

    const matchCheckoutSession = pathname.match(/^\/v1\/checkout\/sessions\/([^/]+)$/);
    if (matchCheckoutSession && req.method === 'GET') {
        await expireOldIntents(store);
        const session = await store.getCheckoutSession(matchCheckoutSession[1]);
        if (!session) {
            throw httpError(404, 'Checkout session not found.');
        }
        sendJson(res, 200, { session });
        return;
    }

    if (pathname === '/v1/intents' && req.method === 'POST') {
        const merchant = await requireMerchantAuth(req, store);
        const body = await parseJsonBody(req);
        const result = await createDirectIntent(store, config, merchant, body);
        sendJson(res, result.wasExisting ? 200 : 201, { intent: result.intent });
        return;
    }

    if (pathname === '/v1/intents' && req.method === 'GET') {
        await expireOldIntents(store);
        const agentAddress = url.searchParams.get('agentAddress') ?? undefined;
        const status = url.searchParams.get('status') ?? undefined;
        const limitRaw = url.searchParams.get('limit') ?? '20';
        const limit = Math.max(1, Math.min(200, Number.parseInt(limitRaw, 10) || 20));
        const intents = await store.listIntents({ agentAddress, status, limit });
        sendJson(res, 200, { intents });
        return;
    }

    if (pathname === '/v1/intents/next' && req.method === 'GET') {
        await expireOldIntents(store);
        const agentAddress = url.searchParams.get('agentAddress');
        if (!agentAddress || !isSuiAddress(agentAddress)) {
            throw httpError(400, 'agentAddress is required and must be a Sui address.');
        }
        const intent = await store.getNextIntent(agentAddress);
        sendJson(res, 200, { intent });
        return;
    }

    const matchIntentId = pathname.match(/^\/v1\/intents\/([^/]+)$/);
    if (matchIntentId && req.method === 'GET') {
        await expireOldIntents(store);
        const intent = await store.getIntent(matchIntentId[1]);
        if (!intent) {
            throw httpError(404, 'Intent not found.');
        }
        sendJson(res, 200, { intent });
        return;
    }

    const matchAck = pathname.match(/^\/v1\/intents\/([^/]+)\/ack$/);
    if (matchAck && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const intent = await ackIntent(store, matchAck[1], body);
        sendJson(res, 200, { intent });
        return;
    }

    const matchSponsor = pathname.match(/^\/v1\/intents\/([^/]+)\/sponsor$/);
    if (matchSponsor && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const sponsor = await sponsorIntent(store, sponsorService, config, matchSponsor[1], body);
        sendJson(res, 200, { sponsor });
        return;
    }

    const matchResult = pathname.match(/^\/v1\/intents\/([^/]+)\/result$/);
    if (matchResult && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const intent = await reportIntentResult(store, matchResult[1], body);
        sendJson(res, 200, { intent });
        return;
    }

    throw httpError(404, `Route not found: ${pathname}`);
}

async function createCheckoutSession(store, config, merchant, body) {
    validateCheckoutSessionInput(body);

    const allowance = await store.findActiveAllowance({
        merchantId: merchant.id,
        agentAddress: body.agentAddress,
        coinType: body.coinType ?? merchant.defaultCoinType ?? config.defaultCoinType,
    });
    if (!allowance) {
        throw httpError(404, 'No active allowance found for merchant, agent, and coin type.');
    }

    const existing = await store.findCheckoutSessionByOrder(merchant.id, body.merchantOrderId);
    if (existing) {
        const intent = await store.getIntent(existing.intentId);
        return { wasExisting: true, session: existing, intent };
    }

    const now = Date.now();
    const intentId = randomUUID();
    const sessionId = randomUUID();
    const expiresAtMs = body.expiresAtMs ?? now + (config.defaultIntentTtlMs ?? DEFAULT_INTENT_TTL_MS);
    const amountAtomic = resolveAmountAtomic(body);
    const coinType = body.coinType ?? allowance.coinType ?? config.defaultCoinType;
    const executionRail = resolveExecutionRail(body, config, { coinType });
    const requiresSponsor = executionRail === EXECUTION_RAIL_SPONSORED_GUARD;
    const sponsorFeeQuote = quoteSponsorFee(config, { amountAtomic, requiresSponsor });
    const currencySymbol = body.currencySymbol ?? merchant.currencySymbol ?? config.defaultCurrencySymbol;
    const currency = body.currency ?? currencySymbol;
    const checkoutUrl = `${config.appUrl.replace(/\/+$/, '')}/checkout?sessionId=${encodeURIComponent(sessionId)}`;
    const metadata = isRecord(body.metadata) ? body.metadata : {};

    const intent = {
        intentId,
        checkoutSessionId: sessionId,
        merchantId: merchant.id,
        merchantOrderId: body.merchantOrderId,
        agentAddress: allowance.agentAddress,
        walletId: requiresSponsor ? allowance.walletId : null,
        sessionCapId: requiresSponsor ? allowance.sessionCapId : null,
        recipient: body.recipient ?? merchant.payoutAddress,
        amountAtomic,
        amountMist: body.amountMist ?? amountAtomic,
        coinType,
        executionRail,
        requiresSponsor,
        sponsorFeeAtomic: sponsorFeeQuote.sponsorFeeAtomic,
        sponsorFeeRecipient: sponsorFeeQuote.sponsorFeeRecipient,
        currency,
        currencySymbol,
        decimals: body.decimals ?? config.defaultCurrencyDecimals,
        reason: body.reason,
        metadata,
        expiresAtMs,
        status: 'pending',
        attemptCount: 0,
        createdAtMs: now,
        updatedAtMs: now,
    };
    intent.signature = signIntentPayload(intent, config.signingSecret);

    const session = {
        sessionId,
        merchantId: merchant.id,
        merchantOrderId: body.merchantOrderId,
        intentId,
        status: 'created',
        checkoutUrl,
        recipient: intent.recipient,
        amountAtomic,
        coinType,
        executionRail,
        requiresSponsor,
        sponsorFeeAtomic: sponsorFeeQuote.sponsorFeeAtomic,
        sponsorFeeRecipient: sponsorFeeQuote.sponsorFeeRecipient,
        currency,
        currencySymbol,
        expiresAtMs,
        createdAtMs: now,
        updatedAtMs: now,
    };

    await store.createCheckoutSessionWithIntent(session, intent);
    return { wasExisting: false, session, intent };
}

async function createDirectIntent(store, config, merchant, body) {
    validateDirectIntentInput(body);
    const existing = await store.findIntentByOrder(merchant.id, body.merchantOrderId);
    if (existing) {
        return { wasExisting: true, intent: existing };
    }

    const now = Date.now();
    const amountAtomic = resolveAmountAtomic(body);
    const currencySymbol = body.currencySymbol ?? body.currency ?? config.defaultCurrencySymbol;
    const coinType = body.coinType ?? config.defaultCoinType;
    const executionRail = resolveExecutionRail(body, config, { coinType });
    const requiresSponsor = executionRail === EXECUTION_RAIL_SPONSORED_GUARD;
    if (requiresSponsor) {
        validateGuardObjects(body);
    }
    const sponsorFeeQuote = quoteSponsorFee(config, { amountAtomic, requiresSponsor });
    const intent = {
        intentId: randomUUID(),
        checkoutSessionId: undefined,
        merchantId: merchant.id,
        merchantOrderId: body.merchantOrderId,
        agentAddress: body.agentAddress,
        walletId: requiresSponsor ? body.walletId : null,
        sessionCapId: requiresSponsor ? body.sessionCapId : null,
        recipient: body.recipient,
        amountAtomic,
        amountMist: body.amountMist ?? amountAtomic,
        coinType,
        executionRail,
        requiresSponsor,
        sponsorFeeAtomic: sponsorFeeQuote.sponsorFeeAtomic,
        sponsorFeeRecipient: sponsorFeeQuote.sponsorFeeRecipient,
        currency: body.currency ?? currencySymbol,
        currencySymbol,
        decimals: body.decimals ?? config.defaultCurrencyDecimals,
        reason: body.reason,
        metadata: isRecord(body.metadata) ? body.metadata : {},
        expiresAtMs: body.expiresAtMs ?? now + (config.defaultIntentTtlMs ?? DEFAULT_INTENT_TTL_MS),
        status: 'pending',
        attemptCount: 0,
        createdAtMs: now,
        updatedAtMs: now,
    };
    intent.signature = signIntentPayload(intent, config.signingSecret);
    await store.createIntent(intent);
    return { wasExisting: false, intent };
}

async function ackIntent(store, intentId, body) {
    validateAckInput(body);
    await expireOldIntents(store);
    const intent = await store.getIntent(intentId);
    if (!intent) {
        throw httpError(404, 'Intent not found.');
    }
    if (intent.agentAddress !== body.agentAddress) {
        throw httpError(403, 'agentAddress does not match intent.');
    }
    if (intent.status !== 'pending') {
        throw httpError(409, `Intent cannot be acked from status ${intent.status}.`);
    }
    if (Date.now() > intent.expiresAtMs) {
        const expired = await store.markIntentExpired(intentId);
        throw httpError(409, expired ? 'Intent already expired.' : 'Intent already expired.');
    }
    return store.ackIntent(intentId, {
        ackAtMs: Number.isFinite(body.ackAt) ? body.ackAt : Date.now(),
        nonce: body.nonce,
    });
}

async function sponsorIntent(store, sponsorService, config, intentId, body) {
    if (!sponsorService) {
        throw httpError(503, 'Sponsor service is not configured.');
    }
    validateSponsorInput(body);
    const intent = await store.getIntent(intentId);
    if (!intent) {
        throw httpError(404, 'Intent not found.');
    }
    if (intent.agentAddress !== body.agentAddress) {
        throw httpError(403, 'agentAddress does not match intent.');
    }
    if (!intent.requiresSponsor) {
        throw httpError(409, `Intent execution rail ${intent.executionRail} does not require sponsorship.`);
    }
    if (intent.status !== 'claimed') {
        throw httpError(409, `Intent must be claimed before sponsorship; current status is ${intent.status}.`);
    }

    try {
        const sponsorFee = resolveIntentSponsorFee(intent, config);
        const sponsor = await sponsorService.sponsorIntent({
            intent,
            agentAddress: body.agentAddress,
            walrusBlobId: body.walrusBlobId,
            gasBudget: config.sponsorMaxGasBudget,
            sponsorFeeAtomic: sponsorFee.sponsorFeeAtomic,
            sponsorFeeRecipient: sponsorFee.sponsorFeeRecipient,
        });
        await store.recordSponsorAttempt({
            intentId,
            agentAddress: body.agentAddress,
            gasBudget: sponsor.gasBudget,
            coinType: intent.coinType,
            sponsorFeeAtomic: sponsor.sponsorFeeAtomic ?? sponsorFee.sponsorFeeAtomic,
            sponsorFeeRecipient: sponsor.sponsorFeeRecipient ?? sponsorFee.sponsorFeeRecipient,
            status: 'sponsored',
            errorMessage: null,
        });
        return sponsor;
    } catch (error) {
        await store.recordSponsorAttempt({
            intentId,
            agentAddress: body.agentAddress,
            gasBudget: config.sponsorMaxGasBudget,
            coinType: intent.coinType,
            sponsorFeeAtomic: intent.sponsorFeeAtomic ?? 0,
            sponsorFeeRecipient: intent.sponsorFeeRecipient ?? null,
            status: 'failed',
            errorMessage: error?.message ?? String(error),
        });
        throw error;
    }
}

async function reportIntentResult(store, intentId, body) {
    validateResultInput(body);
    const intent = await store.getIntent(intentId);
    if (!intent) {
        throw httpError(404, 'Intent not found.');
    }
    if (intent.agentAddress !== body.agentAddress) {
        throw httpError(403, 'agentAddress does not match intent.');
    }
    return store.reportIntentResult(intentId, {
        success: body.success,
        txDigest: body.txDigest,
        walrusBlobId: body.walrusBlobId,
        errorCode: body.errorCode,
        errorMessage: body.errorMessage,
        finishedAtMs: Number.isFinite(body.finishedAt) ? body.finishedAt : Date.now(),
    });
}

async function expireOldIntents(store) {
    return store.expireOldIntents(Date.now());
}

function validateCheckoutSessionInput(body) {
    if (!isRecord(body)) {
        throw httpError(400, 'Body must be a JSON object.');
    }
    for (const field of ['merchantOrderId', 'reason']) {
        if (typeof body[field] !== 'string' || body[field].trim().length === 0) {
            throw httpError(400, `Missing or invalid field: ${field}`);
        }
    }
    if (body.agentAddress !== undefined && !isSuiAddress(body.agentAddress)) {
        throw httpError(400, 'agentAddress must be a valid Sui address.');
    }
    if (body.recipient !== undefined && !isSuiAddress(body.recipient)) {
        throw httpError(400, 'recipient must be a valid Sui address.');
    }
    validateGuardPreferenceInput(body);
    validateAmountInput(body);
    if (body.expiresAtMs !== undefined && (!Number.isFinite(body.expiresAtMs) || body.expiresAtMs <= Date.now())) {
        throw httpError(400, 'expiresAtMs must be a future timestamp.');
    }
    validateExecutionRailInput(body);
}

function validateDirectIntentInput(body) {
    if (!isRecord(body)) {
        throw httpError(400, 'Body must be a JSON object.');
    }
    for (const field of ['merchantOrderId', 'agentAddress', 'recipient', 'reason']) {
        if (typeof body[field] !== 'string' || body[field].trim().length === 0) {
            throw httpError(400, `Missing or invalid field: ${field}`);
        }
    }
    if (!isSuiAddress(body.agentAddress) || !isSuiAddress(body.recipient)) {
        throw httpError(400, 'agentAddress and recipient must be valid Sui addresses.');
    }
    validateGuardPreferenceInput(body);
    validateAmountInput(body);
    if (body.expiresAtMs !== undefined && (!Number.isFinite(body.expiresAtMs) || body.expiresAtMs <= Date.now())) {
        throw httpError(400, 'expiresAtMs must be a future timestamp.');
    }
    validateExecutionRailInput(body);
}

function validateAmountInput(body) {
    const amountAtomic = resolveAmountAtomic(body);
    if (!Number.isInteger(amountAtomic) || amountAtomic <= 0) {
        throw httpError(400, 'amountAtomic or amountMist must be a positive integer.');
    }
}

function validateAckInput(body) {
    if (!isRecord(body)) {
        throw httpError(400, 'Body must be a JSON object.');
    }
    if (typeof body.agentAddress !== 'string' || !isSuiAddress(body.agentAddress)) {
        throw httpError(400, 'agentAddress is required and must be valid.');
    }
    if (typeof body.nonce !== 'string' || body.nonce.length < 8) {
        throw httpError(400, 'nonce is required.');
    }
}

function validateSponsorInput(body) {
    if (!isRecord(body)) {
        throw httpError(400, 'Body must be a JSON object.');
    }
    if (typeof body.agentAddress !== 'string' || !isSuiAddress(body.agentAddress)) {
        throw httpError(400, 'agentAddress is required and must be valid.');
    }
    if (typeof body.walrusBlobId !== 'string' || body.walrusBlobId.trim().length === 0) {
        throw httpError(400, 'walrusBlobId is required.');
    }
}

function validateResultInput(body) {
    if (!isRecord(body)) {
        throw httpError(400, 'Body must be a JSON object.');
    }
    if (typeof body.success !== 'boolean') {
        throw httpError(400, 'success field is required.');
    }
    if (typeof body.agentAddress !== 'string' || !isSuiAddress(body.agentAddress)) {
        throw httpError(400, 'agentAddress is required and must be valid.');
    }
}

function resolveAmountAtomic(body) {
    return body.amountAtomic ?? body.amountMist;
}

function validateExecutionRailInput(body) {
    if (body.executionRail === undefined) {
        return;
    }
    if (![EXECUTION_RAIL_AUTO, EXECUTION_RAIL_SPONSORED_GUARD, EXECUTION_RAIL_NATIVE_GASLESS].includes(body.executionRail)) {
        throw httpError(400, `executionRail must be ${EXECUTION_RAIL_AUTO}, ${EXECUTION_RAIL_SPONSORED_GUARD}, or ${EXECUTION_RAIL_NATIVE_GASLESS}.`);
    }
}

function validateGuardPreferenceInput(body) {
    if (body.requiresGuard !== undefined && typeof body.requiresGuard !== 'boolean') {
        throw httpError(400, 'requiresGuard must be a boolean when provided.');
    }
}

function validateGuardObjects(body) {
    for (const field of ['walletId', 'sessionCapId']) {
        if (typeof body[field] !== 'string' || body[field].trim().length === 0) {
            throw httpError(400, `Missing or invalid field: ${field}`);
        }
    }
}

function resolveExecutionRail(body, config, { coinType }) {
    const requestedRail = body.executionRail ?? EXECUTION_RAIL_AUTO;
    if (requestedRail !== EXECUTION_RAIL_AUTO) {
        return requestedRail;
    }
    if (body.requiresGuard === true || hasGuardObjects(body)) {
        return EXECUTION_RAIL_SPONSORED_GUARD;
    }
    if (isNativeGaslessCoinType(coinType, config)) {
        return EXECUTION_RAIL_NATIVE_GASLESS;
    }
    return EXECUTION_RAIL_SPONSORED_GUARD;
}

function hasGuardObjects(body) {
    return typeof body.walletId === 'string'
        || typeof body.sessionCapId === 'string';
}

function isNativeGaslessCoinType(coinType, config) {
    return normalizeCoinTypeList(config.nativeGaslessCoinTypes ?? [config.defaultCoinType ?? DEFAULT_COIN_TYPE])
        .includes(normalizeCoinType(coinType));
}

function normalizeCoinTypeList(value) {
    if (Array.isArray(value)) {
        return value.map(normalizeCoinType).filter(Boolean);
    }
    if (typeof value === 'string') {
        return value.split(',').map(normalizeCoinType).filter(Boolean);
    }
    return [];
}

function normalizeCoinType(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function quoteSponsorFee(config, { amountAtomic, requiresSponsor }) {
    if (!requiresSponsor) {
        return {
            sponsorFeeAtomic: 0,
            sponsorFeeRecipient: null,
        };
    }
    const sponsorFeeAtomic = calculateSponsorFeeAtomic(
        amountAtomic,
        config.sponsorFeeBps ?? DEFAULT_SPONSOR_FEE_BPS,
        config.sponsorMinFeeAtomic ?? DEFAULT_SPONSOR_MIN_FEE_ATOMIC,
    );
    if (sponsorFeeAtomic === 0) {
        return {
            sponsorFeeAtomic,
            sponsorFeeRecipient: null,
        };
    }
    if (!isSuiAddress(config.sponsorFeeRecipient)) {
        throw httpError(500, 'Sponsor fee recipient is required when SPONSOR_FEE_BPS or SPONSOR_MIN_FEE_ATOMIC is enabled.');
    }
    return {
        sponsorFeeAtomic,
        sponsorFeeRecipient: config.sponsorFeeRecipient,
    };
}

function calculateSponsorFeeAtomic(amountAtomic, feeBps, minFeeAtomic) {
    if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
        throw httpError(500, 'Sponsor fee bps must be an integer between 0 and 10000.');
    }
    if (!Number.isInteger(minFeeAtomic) || minFeeAtomic < 0) {
        throw httpError(500, 'Sponsor minimum fee must be a non-negative integer.');
    }
    if (feeBps === 0 && minFeeAtomic === 0) {
        return 0;
    }
    const percentageFee = feeBps === 0 ? 0 : Math.ceil((amountAtomic * feeBps) / 10_000);
    return Math.max(percentageFee, minFeeAtomic);
}

function resolveIntentSponsorFee(intent, config) {
    const sponsorFeeAtomic = intent.sponsorFeeAtomic ?? quoteSponsorFee(config, {
        amountAtomic: intent.amountAtomic,
        requiresSponsor: intent.requiresSponsor,
    }).sponsorFeeAtomic;
    if (sponsorFeeAtomic === 0) {
        return {
            sponsorFeeAtomic,
            sponsorFeeRecipient: null,
        };
    }
    const sponsorFeeRecipient = intent.sponsorFeeRecipient ?? config.sponsorFeeRecipient;
    if (!isSuiAddress(sponsorFeeRecipient)) {
        throw httpError(500, 'Sponsor fee recipient is missing for this sponsored intent.');
    }
    return {
        sponsorFeeAtomic,
        sponsorFeeRecipient,
    };
}

async function requireMerchantAuth(req, store) {
    const apiKey = req.headers['x-api-key'];
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
        throw httpError(401, 'Unauthorized: missing x-api-key.');
    }
    const merchant = await store.findMerchantByApiKey(apiKey);
    if (!merchant) {
        throw httpError(401, 'Unauthorized: invalid x-api-key.');
    }
    return merchant;
}

export function buildIntentSignaturePayload(intent) {
    return {
        intentId: intent.intentId,
        merchantOrderId: intent.merchantOrderId,
        agentAddress: intent.agentAddress,
        walletId: intent.walletId,
        sessionCapId: intent.sessionCapId,
        recipient: intent.recipient,
        amountAtomic: intent.amountAtomic,
        amountMist: intent.amountMist ?? intent.amountAtomic,
        coinType: intent.coinType,
        executionRail: intent.executionRail ?? EXECUTION_RAIL_SPONSORED_GUARD,
        requiresSponsor: intent.requiresSponsor ?? true,
        sponsorFeeAtomic: intent.sponsorFeeAtomic ?? 0,
        sponsorFeeRecipient: intent.sponsorFeeRecipient ?? null,
        currency: intent.currency,
        currencySymbol: intent.currencySymbol,
        reason: intent.reason,
        expiresAtMs: intent.expiresAtMs,
        metadata: intent.metadata ?? null,
    };
}

function signIntentPayload(intent, signingSecret) {
    return createHmac('sha256', signingSecret)
        .update(JSON.stringify(buildIntentSignaturePayload(intent)))
        .digest('hex');
}

export function verifyIntentSignature(intent, signingSecret) {
    const expected = signIntentPayload(intent, signingSecret);
    const left = Buffer.from(expected, 'hex');
    const right = Buffer.from(intent.signature ?? '', 'hex');
    return left.length === right.length && timingSafeEqual(left, right);
}

export function createInMemoryStore() {
    const merchants = [];
    const allowances = [];
    const sessions = [];
    const intents = [];
    const sponsorAttempts = [];

    return {
        async seedDemo(input) {
            const merchant = {
                id: input.merchantId,
                name: input.merchantName,
                apiKeyHash: hashApiKey(input.apiKey),
                payoutAddress: input.payoutAddress,
                webhookUrl: input.webhookUrl ?? null,
                defaultCoinType: input.coinType ?? DEFAULT_COIN_TYPE,
                currencySymbol: input.currencySymbol ?? DEFAULT_CURRENCY_SYMBOL,
                createdAtMs: Date.now(),
                updatedAtMs: Date.now(),
            };
            merchants.push(merchant);
            allowances.push({
                id: randomUUID(),
                merchantId: merchant.id,
                agentAddress: input.agentAddress,
                walletId: input.walletId,
                sessionCapId: input.sessionCapId,
                coinType: input.coinType ?? DEFAULT_COIN_TYPE,
                status: 'active',
                createdAtMs: Date.now(),
                updatedAtMs: Date.now(),
            });
            return merchant;
        },
        async findMerchantByApiKey(apiKey) {
            const hash = hashApiKey(apiKey);
            return clone(merchants.find((merchant) => merchant.apiKeyHash === hash));
        },
        async findActiveAllowance({ merchantId, agentAddress, coinType }) {
            return clone(allowances.find((allowance) =>
                allowance.merchantId === merchantId
                && (agentAddress === undefined || allowance.agentAddress === agentAddress)
                && allowance.coinType === coinType
                && allowance.status === 'active'
            ));
        },
        async findCheckoutSessionByOrder(merchantId, merchantOrderId) {
            return clone(sessions.find((session) => session.merchantId === merchantId && session.merchantOrderId === merchantOrderId));
        },
        async findIntentByOrder(merchantId, merchantOrderId) {
            return clone(intents.find((intent) => intent.merchantId === merchantId && intent.merchantOrderId === merchantOrderId));
        },
        async createCheckoutSessionWithIntent(session, intent) {
            sessions.push(clone(session));
            intents.push(clone(intent));
        },
        async createIntent(intent) {
            intents.push(clone(intent));
        },
        async getCheckoutSession(sessionId) {
            return clone(sessions.find((session) => session.sessionId === sessionId));
        },
        async getIntent(intentId) {
            return clone(intents.find((intent) => intent.intentId === intentId));
        },
        async listIntents({ agentAddress, status, limit }) {
            let rows = intents.slice();
            if (agentAddress) rows = rows.filter((intent) => intent.agentAddress === agentAddress);
            if (status) rows = rows.filter((intent) => intent.status === status);
            rows.sort((a, b) => b.createdAtMs - a.createdAtMs);
            return clone(rows.slice(0, limit));
        },
        async getNextIntent(agentAddress) {
            const intent = intents
                .filter((candidate) => candidate.status === 'pending' && candidate.agentAddress === agentAddress)
                .sort((a, b) => a.createdAtMs - b.createdAtMs)[0];
            return clone(intent ?? null);
        },
        async ackIntent(intentId, { ackAtMs, nonce }) {
            const intent = mustFindInMemory(intents, intentId);
            intent.status = 'claimed';
            intent.claimedAtMs = ackAtMs;
            intent.ackNonce = nonce;
            intent.attemptCount += 1;
            intent.updatedAtMs = Date.now();
            syncSessionStatus(sessions, intent, 'claimed');
            return clone(intent);
        },
        async markIntentExpired(intentId) {
            const intent = mustFindInMemory(intents, intentId);
            intent.status = 'expired';
            intent.updatedAtMs = Date.now();
            syncSessionStatus(sessions, intent, 'expired');
            return clone(intent);
        },
        async reportIntentResult(intentId, input) {
            const intent = mustFindInMemory(intents, intentId);
            if (input.success) {
                intent.status = 'executed';
                intent.txDigest = input.txDigest;
                intent.walrusBlobId = input.walrusBlobId;
                intent.errorCode = undefined;
                intent.errorMessage = undefined;
                syncSessionStatus(sessions, intent, 'executed');
            } else {
                intent.status = input.errorCode === 'expired' ? 'expired' : 'failed';
                intent.errorCode = input.errorCode ?? 'unknown';
                intent.errorMessage = input.errorMessage ?? 'unknown error';
                syncSessionStatus(sessions, intent, intent.status);
            }
            intent.finishedAt = input.finishedAtMs;
            intent.updatedAtMs = Date.now();
            return clone(intent);
        },
        async recordSponsorAttempt(input) {
            sponsorAttempts.push({
                id: randomUUID(),
                ...input,
                createdAtMs: Date.now(),
            });
        },
        async expireOldIntents(nowMs) {
            for (const intent of intents) {
                if ((intent.status === 'pending' || intent.status === 'claimed') && intent.expiresAtMs < nowMs) {
                    intent.status = 'expired';
                    intent.updatedAtMs = nowMs;
                    syncSessionStatus(sessions, intent, 'expired');
                }
            }
        },
    };
}

function mustFindInMemory(intents, intentId) {
    const intent = intents.find((candidate) => candidate.intentId === intentId);
    if (!intent) {
        throw httpError(404, 'Intent not found.');
    }
    return intent;
}

function syncSessionStatus(sessions, intent, status) {
    if (!intent.checkoutSessionId) {
        return;
    }
    const session = sessions.find((candidate) => candidate.sessionId === intent.checkoutSessionId);
    if (session) {
        session.status = status;
        session.txDigest = intent.txDigest;
        session.walrusBlobId = intent.walrusBlobId;
        session.errorCode = intent.errorCode;
        session.errorMessage = intent.errorMessage;
        session.updatedAtMs = Date.now();
    }
}

export function createPostgresStore(connectionString) {
    const pool = new Pool({ connectionString });
    return {
        async close() {
            await pool.end();
        },
        async findMerchantByApiKey(apiKey) {
            const { rows } = await pool.query(
                'select * from merchants where api_key_hash = $1 limit 1',
                [hashApiKey(apiKey)],
            );
            return rows[0] ? mapMerchant(rows[0]) : null;
        },
        async findActiveAllowance({ merchantId, agentAddress, coinType }) {
            const values = [merchantId, coinType];
            const agentClause = agentAddress === undefined ? '' : `and agent_address = $${values.push(agentAddress)}`;
            const { rows } = await pool.query(
                `select * from agent_allowances
                 where merchant_id = $1 and coin_type = $2 and status = 'active'
                 ${agentClause}
                 order by created_at_ms asc
                 limit 1`,
                values,
            );
            return rows[0] ? mapAllowance(rows[0]) : null;
        },
        async findCheckoutSessionByOrder(merchantId, merchantOrderId) {
            const { rows } = await pool.query(
                'select * from checkout_sessions where merchant_id = $1 and merchant_order_id = $2 limit 1',
                [merchantId, merchantOrderId],
            );
            return rows[0] ? mapSession(rows[0]) : null;
        },
        async findIntentByOrder(merchantId, merchantOrderId) {
            const { rows } = await pool.query(
                'select * from payment_intents where merchant_id = $1 and merchant_order_id = $2 limit 1',
                [merchantId, merchantOrderId],
            );
            return rows[0] ? mapIntent(rows[0]) : null;
        },
        async createCheckoutSessionWithIntent(session, intent) {
            const client = await pool.connect();
            try {
                await client.query('begin');
                await insertSession(client, session);
                await insertIntent(client, intent);
                await client.query('commit');
            } catch (error) {
                await client.query('rollback');
                throw error;
            } finally {
                client.release();
            }
        },
        async createIntent(intent) {
            await insertIntent(pool, intent);
        },
        async getCheckoutSession(sessionId) {
            const { rows } = await pool.query('select * from checkout_sessions where id = $1 limit 1', [sessionId]);
            return rows[0] ? mapSession(rows[0]) : null;
        },
        async getIntent(intentId) {
            const { rows } = await pool.query('select * from payment_intents where id = $1 limit 1', [intentId]);
            return rows[0] ? mapIntent(rows[0]) : null;
        },
        async listIntents({ agentAddress, status, limit }) {
            const clauses = [];
            const values = [];
            if (agentAddress) {
                values.push(agentAddress);
                clauses.push(`agent_address = $${values.length}`);
            }
            if (status) {
                values.push(status);
                clauses.push(`status = $${values.length}`);
            }
            values.push(limit);
            const where = clauses.length > 0 ? `where ${clauses.join(' and ')}` : '';
            const { rows } = await pool.query(
                `select * from payment_intents ${where} order by created_at_ms desc limit $${values.length}`,
                values,
            );
            return rows.map(mapIntent);
        },
        async getNextIntent(agentAddress) {
            const { rows } = await pool.query(
                `select * from payment_intents
                 where status = 'pending' and agent_address = $1
                 order by created_at_ms asc
                 limit 1`,
                [agentAddress],
            );
            return rows[0] ? mapIntent(rows[0]) : null;
        },
        async ackIntent(intentId, { ackAtMs, nonce }) {
            const { rows } = await pool.query(
                `update payment_intents
                 set status = 'claimed', claimed_at_ms = $2, ack_nonce = $3,
                     attempt_count = attempt_count + 1, updated_at_ms = $4
                 where id = $1
                 returning *`,
                [intentId, ackAtMs, nonce, Date.now()],
            );
            const intent = mapIntent(rows[0]);
            await updateSessionFromIntent(pool, intent, 'claimed');
            return intent;
        },
        async markIntentExpired(intentId) {
            const { rows } = await pool.query(
                `update payment_intents set status = 'expired', updated_at_ms = $2 where id = $1 returning *`,
                [intentId, Date.now()],
            );
            if (!rows[0]) return null;
            const intent = mapIntent(rows[0]);
            await updateSessionFromIntent(pool, intent, 'expired');
            return intent;
        },
        async reportIntentResult(intentId, input) {
            const status = input.success ? 'executed' : (input.errorCode === 'expired' ? 'expired' : 'failed');
            const { rows } = await pool.query(
                `update payment_intents
                 set status = $2, tx_digest = $3, walrus_blob_id = $4,
                     error_code = $5, error_message = $6, finished_at_ms = $7, updated_at_ms = $8
                 where id = $1
                 returning *`,
                [
                    intentId,
                    status,
                    input.success ? input.txDigest : null,
                    input.success ? input.walrusBlobId : null,
                    input.success ? null : input.errorCode ?? 'unknown',
                    input.success ? null : input.errorMessage ?? 'unknown error',
                    input.finishedAtMs,
                    Date.now(),
                ],
            );
            const intent = mapIntent(rows[0]);
            await updateSessionFromIntent(pool, intent, status);
            return intent;
        },
        async recordSponsorAttempt(input) {
            await pool.query(
                `insert into sponsor_attempts
                    (id, intent_id, agent_address, gas_budget, coin_type, sponsor_fee_atomic,
                     sponsor_fee_recipient, status, error_message, created_at_ms)
                 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [
                    randomUUID(),
                    input.intentId,
                    input.agentAddress,
                    input.gasBudget,
                    input.coinType,
                    input.sponsorFeeAtomic ?? 0,
                    input.sponsorFeeRecipient ?? null,
                    input.status,
                    input.errorMessage,
                    Date.now(),
                ],
            );
        },
        async expireOldIntents(nowMs) {
            const { rows } = await pool.query(
                `update payment_intents
                 set status = 'expired', updated_at_ms = $1
                 where status in ('pending', 'claimed') and expires_at_ms < $1
                 returning *`,
                [nowMs],
            );
            for (const row of rows) {
                await updateSessionFromIntent(pool, mapIntent(row), 'expired');
            }
        },
    };
}

async function insertSession(client, session) {
    await client.query(
        `insert into checkout_sessions
            (id, merchant_id, merchant_order_id, intent_id, status, checkout_url, recipient,
             amount_atomic, coin_type, execution_rail, requires_sponsor, sponsor_fee_atomic,
             sponsor_fee_recipient, currency, currency_symbol, expires_at_ms, created_at_ms, updated_at_ms)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 $13, $14, $15, $16, $17, $18)`,
        [
            session.sessionId,
            session.merchantId,
            session.merchantOrderId,
            session.intentId,
            session.status,
            session.checkoutUrl,
            session.recipient,
            session.amountAtomic,
            session.coinType,
            session.executionRail,
            session.requiresSponsor,
            session.sponsorFeeAtomic ?? 0,
            session.sponsorFeeRecipient ?? null,
            session.currency,
            session.currencySymbol,
            session.expiresAtMs,
            session.createdAtMs,
            session.updatedAtMs,
        ],
    );
}

async function insertIntent(client, intent) {
    await client.query(
        `insert into payment_intents
            (id, checkout_session_id, merchant_id, merchant_order_id, agent_address, wallet_id,
             session_cap_id, recipient, amount_atomic, amount_mist, coin_type, execution_rail,
             requires_sponsor, sponsor_fee_atomic, sponsor_fee_recipient, currency,
             currency_symbol, decimals, reason, metadata_json, expires_at_ms, status,
             attempt_count, signature, created_at_ms, updated_at_ms)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                 $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)`,
        [
            intent.intentId,
            intent.checkoutSessionId ?? null,
            intent.merchantId,
            intent.merchantOrderId,
            intent.agentAddress,
            intent.walletId,
            intent.sessionCapId,
            intent.recipient,
            intent.amountAtomic,
            intent.amountMist,
            intent.coinType,
            intent.executionRail,
            intent.requiresSponsor,
            intent.sponsorFeeAtomic ?? 0,
            intent.sponsorFeeRecipient ?? null,
            intent.currency,
            intent.currencySymbol,
            intent.decimals,
            intent.reason,
            JSON.stringify(intent.metadata ?? {}),
            intent.expiresAtMs,
            intent.status,
            intent.attemptCount,
            intent.signature,
            intent.createdAtMs,
            intent.updatedAtMs,
        ],
    );
}

async function updateSessionFromIntent(client, intent, status) {
    if (!intent.checkoutSessionId) return;
    await client.query(
        `update checkout_sessions
         set status = $2, tx_digest = $3, walrus_blob_id = $4,
             error_code = $5, error_message = $6, updated_at_ms = $7
         where id = $1`,
        [
            intent.checkoutSessionId,
            status,
            intent.txDigest ?? null,
            intent.walrusBlobId ?? null,
            intent.errorCode ?? null,
            intent.errorMessage ?? null,
            Date.now(),
        ],
    );
}

function mapMerchant(row) {
    return {
        id: row.id,
        name: row.name,
        apiKeyHash: row.api_key_hash,
        payoutAddress: row.payout_address,
        webhookUrl: row.webhook_url,
        defaultCoinType: row.default_coin_type,
        currencySymbol: row.currency_symbol,
        createdAtMs: Number(row.created_at_ms),
        updatedAtMs: Number(row.updated_at_ms),
    };
}

function mapAllowance(row) {
    return {
        id: row.id,
        merchantId: row.merchant_id,
        agentAddress: row.agent_address,
        walletId: row.wallet_id,
        sessionCapId: row.session_cap_id,
        coinType: row.coin_type,
        status: row.status,
        createdAtMs: Number(row.created_at_ms),
        updatedAtMs: Number(row.updated_at_ms),
    };
}

function mapSession(row) {
    return {
        sessionId: row.id,
        merchantId: row.merchant_id,
        merchantOrderId: row.merchant_order_id,
        intentId: row.intent_id,
        status: row.status,
        checkoutUrl: row.checkout_url,
        recipient: row.recipient,
        amountAtomic: Number(row.amount_atomic),
        coinType: row.coin_type,
        executionRail: row.execution_rail ?? EXECUTION_RAIL_SPONSORED_GUARD,
        requiresSponsor: row.requires_sponsor ?? true,
        sponsorFeeAtomic: Number(row.sponsor_fee_atomic ?? 0),
        sponsorFeeRecipient: row.sponsor_fee_recipient ?? null,
        currency: row.currency,
        currencySymbol: row.currency_symbol,
        expiresAtMs: Number(row.expires_at_ms),
        txDigest: row.tx_digest ?? undefined,
        walrusBlobId: row.walrus_blob_id ?? undefined,
        errorCode: row.error_code ?? undefined,
        errorMessage: row.error_message ?? undefined,
        createdAtMs: Number(row.created_at_ms),
        updatedAtMs: Number(row.updated_at_ms),
    };
}

function mapIntent(row) {
    return {
        intentId: row.id,
        checkoutSessionId: row.checkout_session_id ?? undefined,
        merchantId: row.merchant_id,
        merchantOrderId: row.merchant_order_id,
        agentAddress: row.agent_address,
        walletId: row.wallet_id,
        sessionCapId: row.session_cap_id,
        recipient: row.recipient,
        amountAtomic: Number(row.amount_atomic),
        amountMist: Number(row.amount_mist),
        coinType: row.coin_type,
        executionRail: row.execution_rail ?? EXECUTION_RAIL_SPONSORED_GUARD,
        requiresSponsor: row.requires_sponsor ?? true,
        sponsorFeeAtomic: Number(row.sponsor_fee_atomic ?? 0),
        sponsorFeeRecipient: row.sponsor_fee_recipient ?? null,
        currency: row.currency,
        currencySymbol: row.currency_symbol,
        decimals: Number(row.decimals),
        reason: row.reason,
        metadata: row.metadata_json ?? {},
        expiresAtMs: Number(row.expires_at_ms),
        status: row.status,
        attemptCount: Number(row.attempt_count),
        signature: row.signature,
        createdAtMs: Number(row.created_at_ms),
        updatedAtMs: Number(row.updated_at_ms),
        claimedAtMs: row.claimed_at_ms === null ? undefined : Number(row.claimed_at_ms),
        txDigest: row.tx_digest ?? undefined,
        walrusBlobId: row.walrus_blob_id ?? undefined,
        errorCode: row.error_code ?? undefined,
        errorMessage: row.error_message ?? undefined,
        finishedAt: row.finished_at_ms === null ? undefined : Number(row.finished_at_ms),
    };
}

export function createSuiSponsorService({
    packageId,
    sponsorSecretKey,
    network = 'testnet',
    maxGasBudget = 10_000_000,
}) {
    if (!packageId) {
        throw new Error('PACKAGE_ID is required for sponsor service.');
    }
    if (!sponsorSecretKey) {
        throw new Error('SPONSOR_SECRET_KEY is required for sponsor service.');
    }
    const keypair = Ed25519Keypair.fromSecretKey(normalizeSecretKey(sponsorSecretKey));
    const client = new SuiClient({ url: getFullnodeUrl(network) });
    const sponsorAddress = keypair.getPublicKey().toSuiAddress();

    return {
        sponsorAddress,
        async sponsorIntent({
            intent,
            agentAddress,
            walrusBlobId,
            gasBudget,
            sponsorFeeAtomic = 0,
            sponsorFeeRecipient = sponsorAddress,
        }) {
            const budget = gasBudget ?? maxGasBudget;
            const gasCoins = await client.getCoins({
                owner: sponsorAddress,
                coinType: '0x2::sui::SUI',
            });
            const gasCoin = gasCoins.data[0];
            if (!gasCoin) {
                throw httpError(503, 'Sponsor has no SUI gas coins.');
            }

            const txb = new TransactionBlock();
            txb.setSender(agentAddress);
            txb.setGasOwner(sponsorAddress);
            txb.setGasBudget(budget);
            txb.setGasPayment([{
                objectId: gasCoin.coinObjectId,
                version: gasCoin.version,
                digest: gasCoin.digest,
            }]);
            if (sponsorFeeAtomic > 0) {
                if (!isSuiAddress(sponsorFeeRecipient)) {
                    throw httpError(500, 'Sponsor fee recipient must be a valid Sui address.');
                }
                txb.moveCall({
                    target: `${packageId}::wallet::execute_payment_with_fee`,
                    typeArguments: [intent.coinType],
                    arguments: [
                        txb.object(intent.walletId),
                        txb.object(intent.sessionCapId),
                        txb.pure(intent.amountAtomic),
                        txb.pure(intent.recipient),
                        txb.pure(sponsorFeeAtomic),
                        txb.pure(sponsorFeeRecipient),
                        txb.pure(walrusBlobId),
                        txb.object('0x6'),
                    ],
                });
            } else {
                txb.moveCall({
                    target: `${packageId}::wallet::execute_payment`,
                    typeArguments: [intent.coinType],
                    arguments: [
                        txb.object(intent.walletId),
                        txb.object(intent.sessionCapId),
                        txb.pure(intent.amountAtomic),
                        txb.pure(intent.recipient),
                        txb.pure(walrusBlobId),
                        txb.object('0x6'),
                    ],
                });
            }

            const bytes = await txb.build({ client });
            const { signature } = await keypair.signTransactionBlock(bytes);
            return {
                transactionBytes: toB64(bytes),
                sponsorSignature: signature,
                gasBudget: budget,
                sponsorFeeAtomic,
                sponsorFeeRecipient: sponsorFeeAtomic > 0 ? sponsorFeeRecipient : null,
            };
        },
    };
}

function normalizeSecretKey(secretKey) {
    const raw = String(secretKey).trim();
    if (raw.startsWith('suiprivkey')) {
        return decodeSuiPrivateKey(raw).secretKey;
    }
    const withNoPrefix = raw.startsWith('0x') ? raw.slice(2) : raw;
    if (withNoPrefix.length > 0 && withNoPrefix.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(withNoPrefix)) {
        return Uint8Array.from(withNoPrefix.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
    }
    return Uint8Array.from(Buffer.from(raw, 'base64'));
}

export function hashApiKey(apiKey) {
    return createHash('sha256').update(apiKey).digest('hex');
}

function clone(value) {
    if (value === undefined || value === null) {
        return value ?? null;
    }
    return JSON.parse(JSON.stringify(value));
}

async function parseJsonBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf-8');
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        throw httpError(400, 'Invalid JSON body.');
    }
}

function isSuiAddress(value) {
    return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function isRecord(value) {
    return typeof value === 'object' && value !== null;
}

function httpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function setCorsHeaders(res) {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type,x-api-key');
}

function sendJson(res, status, payload) {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(payload, null, 2));
}

function readServerConfigFromEnv() {
    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is required.');
    }
    return {
        port: Number.parseInt(process.env.PRODUCER_API_PORT ?? '8787', 10),
        store: createPostgresStore(process.env.DATABASE_URL),
        config: {
            appUrl: process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? 'http://localhost:3000',
            defaultCoinType: process.env.DEFAULT_COIN_TYPE ?? DEFAULT_COIN_TYPE,
            defaultCurrencySymbol: process.env.DEFAULT_CURRENCY_SYMBOL ?? DEFAULT_CURRENCY_SYMBOL,
            defaultCurrencyDecimals: Number.parseInt(process.env.DEFAULT_CURRENCY_DECIMALS ?? `${DEFAULT_CURRENCY_DECIMALS}`, 10),
            nativeGaslessCoinTypes: normalizeCoinTypeList(process.env.NATIVE_GASLESS_COIN_TYPES ?? process.env.DEFAULT_COIN_TYPE ?? DEFAULT_COIN_TYPE),
            defaultIntentTtlMs: Number.parseInt(process.env.PRODUCER_DEFAULT_INTENT_TTL_MS ?? `${DEFAULT_INTENT_TTL_MS}`, 10),
            signingSecret: process.env.PRODUCER_SIGNING_SECRET ?? 'dev-secret-change-me',
            sponsorMaxGasBudget: Number.parseInt(process.env.SPONSOR_MAX_GAS_BUDGET ?? '10000000', 10),
            sponsorFeeBps: Number.parseInt(process.env.SPONSOR_FEE_BPS ?? `${DEFAULT_SPONSOR_FEE_BPS}`, 10),
            sponsorMinFeeAtomic: Number.parseInt(process.env.SPONSOR_MIN_FEE_ATOMIC ?? `${DEFAULT_SPONSOR_MIN_FEE_ATOMIC}`, 10),
            sponsorFeeRecipient: process.env.SPONSOR_FEE_RECIPIENT ?? null,
        },
        sponsorService: createSuiSponsorService({
            packageId: process.env.PACKAGE_ID,
            sponsorSecretKey: process.env.SPONSOR_SECRET_KEY,
            network: process.env.SUI_NETWORK ?? 'testnet',
            maxGasBudget: Number.parseInt(process.env.SPONSOR_MAX_GAS_BUDGET ?? '10000000', 10),
        }),
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const { port, store, config, sponsorService } = readServerConfigFromEnv();
    const server = createServerApp({ store, config, sponsorService });
    server.listen(port, () => {
        console.log(`[producer-api] listening on http://localhost:${port}`);
        console.log('[producer-api] storage: postgres');
    });
}
