import { createServer } from 'http';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number.parseInt(process.env.PRODUCER_API_PORT ?? '8787', 10);
const API_KEY = process.env.PRODUCER_API_KEY ?? '';
const SIGNING_SECRET = process.env.PRODUCER_SIGNING_SECRET ?? 'dev-secret-change-me';
const DEFAULT_INTENT_TTL_MS = Number.parseInt(process.env.PRODUCER_DEFAULT_INTENT_TTL_MS ?? `${10 * 60 * 1000}`, 10);
const dataFile = process.env.PRODUCER_DATA_FILE ?? path.join(__dirname, 'data', 'intents.json');

const state = loadState(dataFile);

const server = createServer(async (req, res) => {
    try {
        await handleRequest(req, res);
    } catch (error) {
        const status = typeof error?.status === 'number' ? error.status : 500;
        const message = typeof error?.message === 'string' ? error.message : 'Internal server error';
        if (status >= 500) {
            console.error('[producer-api] unhandled error', error);
        }
        sendJson(res, status, { error: message });
    }
});

server.listen(PORT, () => {
    console.log(`[producer-api] listening on http://localhost:${PORT}`);
    console.log(`[producer-api] data file: ${dataFile}`);
});

async function handleRequest(req, res) {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `localhost:${PORT}`}`);
    const pathname = url.pathname;

    if (pathname === '/health' && req.method === 'GET') {
        sendJson(res, 200, { ok: true, nowMs: Date.now() });
        return;
    }

    if (pathname === '/v1/intents' && req.method === 'POST') {
        requireWriteAuth(req);
        const body = await parseJsonBody(req);
        const result = createOrGetIntent(body);
        sendJson(res, result.wasExisting ? 200 : 201, { intent: result.intent });
        return;
    }

    if (pathname === '/v1/intents' && req.method === 'GET') {
        const agentAddress = url.searchParams.get('agentAddress') ?? undefined;
        const status = url.searchParams.get('status') ?? undefined;
        const limitRaw = url.searchParams.get('limit') ?? '20';
        const limit = Math.max(1, Math.min(200, Number.parseInt(limitRaw, 10) || 20));
        const intents = listIntents({ agentAddress, status, limit });
        sendJson(res, 200, { intents });
        return;
    }

    if (pathname === '/v1/intents/next' && req.method === 'GET') {
        const agentAddress = url.searchParams.get('agentAddress');
        if (!agentAddress || !isSuiAddress(agentAddress)) {
            throw httpError(400, 'agentAddress is required and must be a Sui address.');
        }
        const intent = getNextIntent(agentAddress);
        sendJson(res, 200, { intent });
        return;
    }

    const matchIntentId = pathname.match(/^\/v1\/intents\/([^/]+)$/);
    if (matchIntentId && req.method === 'GET') {
        const intent = findIntent(matchIntentId[1]);
        if (!intent) {
            throw httpError(404, 'Intent not found.');
        }
        sendJson(res, 200, { intent });
        return;
    }

    const matchAck = pathname.match(/^\/v1\/intents\/([^/]+)\/ack$/);
    if (matchAck && req.method === 'POST') {
        requireWriteAuth(req);
        const body = await parseJsonBody(req);
        const intent = ackIntent(matchAck[1], body);
        sendJson(res, 200, { intent });
        return;
    }

    const matchResult = pathname.match(/^\/v1\/intents\/([^/]+)\/result$/);
    if (matchResult && req.method === 'POST') {
        requireWriteAuth(req);
        const body = await parseJsonBody(req);
        const intent = reportIntentResult(matchResult[1], body);
        sendJson(res, 200, { intent });
        return;
    }

    throw httpError(404, `Route not found: ${pathname}`);
}

function createOrGetIntent(body) {
    validateCreateIntentInput(body);
    expireOldPendingIntents();

    const existing = state.intents.find((candidate) => candidate.merchantOrderId === body.merchantOrderId);
    if (existing) {
        return { wasExisting: true, intent: existing };
    }

    const now = Date.now();
    const expiresAtMs = body.expiresAtMs ?? now + DEFAULT_INTENT_TTL_MS;
    const intent = {
        intentId: randomUUID(),
        merchantOrderId: body.merchantOrderId,
        agentAddress: body.agentAddress,
        walletId: body.walletId,
        sessionCapId: body.sessionCapId,
        recipient: body.recipient,
        amountMist: body.amountMist,
        currency: body.currency ?? 'SUI',
        reason: body.reason,
        metadata: isRecord(body.metadata) ? body.metadata : undefined,
        expiresAtMs,
        status: 'pending',
        attemptCount: 0,
        createdAtMs: now,
        updatedAtMs: now,
    };
    intent.signature = signIntentPayload(intent);

    state.intents.push(intent);
    persistState();
    return { wasExisting: false, intent };
}

function listIntents({ agentAddress, status, limit }) {
    expireOldPendingIntents();
    let intents = [...state.intents];
    if (agentAddress) {
        intents = intents.filter((intent) => intent.agentAddress === agentAddress);
    }
    if (status) {
        intents = intents.filter((intent) => intent.status === status);
    }
    intents.sort((a, b) => b.createdAtMs - a.createdAtMs);
    return intents.slice(0, limit);
}

function getNextIntent(agentAddress) {
    expireOldPendingIntents();
    const intent = state.intents
        .filter((candidate) => candidate.status === 'pending' && candidate.agentAddress === agentAddress)
        .sort((a, b) => a.createdAtMs - b.createdAtMs)[0];
    return intent ?? null;
}

function ackIntent(intentId, body) {
    const intent = mustFindIntent(intentId);
    validateAckInput(body);
    expireOldPendingIntents();

    if (intent.agentAddress !== body.agentAddress) {
        throw httpError(403, 'agentAddress does not match intent.');
    }
    if (intent.status !== 'pending') {
        throw httpError(409, `Intent cannot be acked from status ${intent.status}.`);
    }
    if (Date.now() > intent.expiresAtMs) {
        intent.status = 'expired';
        intent.updatedAtMs = Date.now();
        persistState();
        throw httpError(409, 'Intent already expired.');
    }

    intent.status = 'claimed';
    intent.claimedAtMs = Number.isFinite(body.ackAt) ? body.ackAt : Date.now();
    intent.ackNonce = body.nonce;
    intent.attemptCount += 1;
    intent.updatedAtMs = Date.now();
    persistState();
    return intent;
}

function reportIntentResult(intentId, body) {
    const intent = mustFindIntent(intentId);
    validateResultInput(body);

    if (body.success) {
        if (!body.txDigest || typeof body.txDigest !== 'string') {
            throw httpError(400, 'txDigest is required when success=true');
        }
        if (!body.walrusBlobId || typeof body.walrusBlobId !== 'string') {
            throw httpError(400, 'walrusBlobId is required when success=true');
        }
        intent.status = 'executed';
        intent.txDigest = body.txDigest;
        intent.walrusBlobId = body.walrusBlobId;
        intent.errorCode = undefined;
        intent.errorMessage = undefined;
    } else {
        intent.status = body.errorCode === 'expired' ? 'expired' : 'failed';
        intent.errorCode = body.errorCode ?? 'unknown';
        intent.errorMessage = body.errorMessage ?? 'unknown error';
    }
    intent.finishedAt = Number.isFinite(body.finishedAt) ? body.finishedAt : Date.now();
    intent.updatedAtMs = Date.now();
    persistState();
    return intent;
}

function mustFindIntent(intentId) {
    const intent = findIntent(intentId);
    if (!intent) {
        throw httpError(404, 'Intent not found.');
    }
    return intent;
}

function findIntent(intentId) {
    return state.intents.find((candidate) => candidate.intentId === intentId);
}

function expireOldPendingIntents() {
    const now = Date.now();
    let changed = false;
    for (const intent of state.intents) {
        if ((intent.status === 'pending' || intent.status === 'claimed') && intent.expiresAtMs < now) {
            intent.status = 'expired';
            intent.updatedAtMs = now;
            changed = true;
        }
    }
    if (changed) {
        persistState();
    }
}

function signIntentPayload(intent) {
    const payload = buildIntentSignaturePayload(intent);
    return createHmac('sha256', SIGNING_SECRET).update(JSON.stringify(payload)).digest('hex');
}

function verifyIntentSignature(intent) {
    const expected = signIntentPayload(intent);
    const left = Buffer.from(expected, 'hex');
    const right = Buffer.from(intent.signature ?? '', 'hex');
    if (left.length !== right.length) {
        return false;
    }
    return timingSafeEqual(left, right);
}

function buildIntentSignaturePayload(intent) {
    return {
        intentId: intent.intentId,
        merchantOrderId: intent.merchantOrderId,
        agentAddress: intent.agentAddress,
        walletId: intent.walletId,
        sessionCapId: intent.sessionCapId,
        recipient: intent.recipient,
        amountMist: intent.amountMist,
        currency: intent.currency,
        reason: intent.reason,
        expiresAtMs: intent.expiresAtMs,
        metadata: intent.metadata ?? null,
    };
}

function validateCreateIntentInput(body) {
    if (!isRecord(body)) {
        throw httpError(400, 'Body must be a JSON object.');
    }
    const requiredStringFields = ['merchantOrderId', 'agentAddress', 'walletId', 'sessionCapId', 'recipient', 'reason'];
    for (const field of requiredStringFields) {
        if (typeof body[field] !== 'string' || body[field].trim().length === 0) {
            throw httpError(400, `Missing or invalid field: ${field}`);
        }
    }
    if (!isSuiAddress(body.agentAddress) || !isSuiAddress(body.recipient)) {
        throw httpError(400, 'agentAddress and recipient must be valid Sui addresses.');
    }
    if (typeof body.amountMist !== 'number' || !Number.isInteger(body.amountMist) || body.amountMist <= 0) {
        throw httpError(400, 'amountMist must be a positive integer.');
    }
    if (body.expiresAtMs !== undefined && (!Number.isFinite(body.expiresAtMs) || body.expiresAtMs <= Date.now())) {
        throw httpError(400, 'expiresAtMs must be a future timestamp.');
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

function validateResultInput(body) {
    if (!isRecord(body)) {
        throw httpError(400, 'Body must be a JSON object.');
    }
    if (typeof body.success !== 'boolean') {
        throw httpError(400, 'success field is required.');
    }
}

function loadState(filePath) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });

    if (!fs.existsSync(filePath)) {
        const initial = { intents: [] };
        fs.writeFileSync(filePath, JSON.stringify(initial, null, 2));
        return initial;
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.intents)) {
        throw new Error(`Invalid producer data file format: ${filePath}`);
    }

    for (const intent of parsed.intents) {
        if (intent?.signature && !verifyIntentSignature(intent)) {
            intent.status = 'failed';
            intent.errorCode = 'signature_mismatch';
            intent.errorMessage = 'Signature mismatch detected on boot';
            intent.updatedAtMs = Date.now();
        }
    }
    return parsed;
}

function persistState() {
    const tmp = `${dataFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, dataFile);
}

function requireWriteAuth(req) {
    if (!API_KEY) {
        return;
    }
    const incoming = req.headers['x-api-key'];
    if (!incoming || incoming !== API_KEY) {
        throw httpError(401, 'Unauthorized: invalid x-api-key');
    }
}

async function parseJsonBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf-8');
    if (!text) {
        return {};
    }
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

process.on('uncaughtException', (error) => {
    console.error('[producer-api] uncaught exception', error);
});

process.on('unhandledRejection', (error) => {
    console.error('[producer-api] unhandled rejection', error);
});
