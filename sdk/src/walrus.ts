export interface WalrusClientConfig {
    publisherUrl: string;
    aggregatorUrl: string;
    epochs: number;
    timeoutMs?: number;
    apiKey?: string;
}

export interface WalrusReasoningPayload {
    version: string;
    timestampMs: number;
    agentAddress: string;
    walletId: string;
    sessionCapId: string;
    recipient: string;
    amountMist: number;
    mode: string;
    reasoning: string;
    context?: Record<string, unknown>;
}

export interface WalrusUploadResult {
    blobId: string;
    aggregatorUrl: string;
    siteUrl: string | null;
    alreadyCertified?: boolean;
}

export const DEFAULT_WALRUS_PUBLISHER_URL = 'https://publisher.testnet.walrus.space';
export const DEFAULT_WALRUS_AGGREGATOR_URL = 'https://aggregator.testnet.walrus.space';
export const DEFAULT_WALRUS_EPOCHS = 5;
export const DEFAULT_WALRUS_TIMEOUT_MS = 20_000;
export const DEFAULT_WALRUS_SITE_SUFFIX = '.walrus.site';

interface WalrusUploadParseResult {
    blobId: string;
    alreadyCertified: boolean;
}

export async function uploadJsonToWalrus(
    payload: WalrusReasoningPayload,
    inputConfig: Partial<WalrusClientConfig> = {},
): Promise<WalrusUploadResult> {
    const config = resolveWalrusClientConfig(inputConfig);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs ?? DEFAULT_WALRUS_TIMEOUT_MS);
    const requestUrl = `${removeTrailingSlash(config.publisherUrl)}/v1/blobs?epochs=${config.epochs}`;
    const body = JSON.stringify(payload);

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (config.apiKey) {
        headers.Authorization = `Bearer ${config.apiKey}`;
        headers['x-api-key'] = config.apiKey;
    }

    try {
        const response = await fetch(requestUrl, {
            method: 'PUT',
            headers,
            body,
            signal: controller.signal,
        });

        if (!response.ok) {
            const snippet = (await response.text()).slice(0, 600);
            throw new Error(`Walrus upload failed (${response.status}): ${snippet}`);
        }

        const rawText = await response.text();
        const parsedResponse = parseJsonSafe(rawText);
        const parsed = extractBlobId(parsedResponse);
        return {
            blobId: parsed.blobId,
            aggregatorUrl: buildAggregatorBlobUrl(config.aggregatorUrl, parsed.blobId),
            siteUrl: buildWalrusSiteUrl(parsed.blobId),
            alreadyCertified: parsed.alreadyCertified,
        };
    } catch (error) {
        if (isAbortError(error)) {
            throw new Error(`Walrus upload timed out after ${config.timeoutMs ?? DEFAULT_WALRUS_TIMEOUT_MS} ms`);
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

export function resolveWalrusClientConfig(inputConfig: Partial<WalrusClientConfig> = {}): WalrusClientConfig {
    const epochs = inputConfig.epochs ?? DEFAULT_WALRUS_EPOCHS;
    if (!Number.isInteger(epochs) || epochs <= 0) {
        throw new Error(`Invalid Walrus epochs: ${epochs}`);
    }
    return {
        publisherUrl: inputConfig.publisherUrl ?? DEFAULT_WALRUS_PUBLISHER_URL,
        aggregatorUrl: inputConfig.aggregatorUrl ?? DEFAULT_WALRUS_AGGREGATOR_URL,
        epochs,
        timeoutMs: inputConfig.timeoutMs ?? DEFAULT_WALRUS_TIMEOUT_MS,
        apiKey: inputConfig.apiKey,
    };
}

export function buildAggregatorBlobUrl(aggregatorUrl: string, blobId: string): string {
    return `${removeTrailingSlash(aggregatorUrl)}/v1/blobs/${encodeURIComponent(blobId)}`;
}

export function buildWalrusSiteUrl(blobId: string, suffix = DEFAULT_WALRUS_SITE_SUFFIX): string | null {
    if (!blobId || blobId.startsWith('fallback:')) {
        return null;
    }
    const normalizedSuffix = suffix.startsWith('.') ? suffix : `.${suffix}`;
    return `https://${blobId}${normalizedSuffix}`;
}

function removeTrailingSlash(input: string): string {
    return input.replace(/\/+$/, '');
}

function parseJsonSafe(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function extractBlobId(parsedResponse: unknown): WalrusUploadParseResult {
    if (typeof parsedResponse === 'string') {
        throw new Error(`Walrus response is not JSON: ${parsedResponse.slice(0, 300)}`);
    }

    const directBlobId = findStringByKeys(parsedResponse, ['blobId', 'blob_id']);
    if (directBlobId) {
        return {
            blobId: directBlobId,
            alreadyCertified: hasKey(parsedResponse, 'alreadyCertified'),
        };
    }

    const newlyCreated = getChild(parsedResponse, 'newlyCreated');
    const alreadyCertified = getChild(parsedResponse, 'alreadyCertified');
    const nestedBlobId = findStringByKeys(newlyCreated, ['blobId', 'blob_id'])
        ?? findStringByKeys(alreadyCertified, ['blobId', 'blob_id']);
    if (nestedBlobId) {
        return {
            blobId: nestedBlobId,
            alreadyCertified: !!alreadyCertified,
        };
    }

    throw new Error(`Could not extract blobId from Walrus response: ${JSON.stringify(parsedResponse).slice(0, 600)}`);
}

function getChild(value: unknown, key: string): unknown {
    if (!isRecord(value)) {
        return undefined;
    }
    return value[key];
}

function hasKey(value: unknown, key: string): boolean {
    return isRecord(value) && key in value;
}

function findStringByKeys(value: unknown, keys: string[]): string | null {
    if (typeof value === 'string' && value.length > 0) {
        return value;
    }
    if (Array.isArray(value)) {
        for (const entry of value) {
            const found = findStringByKeys(entry, keys);
            if (found) {
                return found;
            }
        }
        return null;
    }
    if (!isRecord(value)) {
        return null;
    }

    for (const key of keys) {
        const candidate = value[key];
        if (typeof candidate === 'string' && candidate.length > 0) {
            return candidate;
        }
    }

    for (const candidate of Object.values(value)) {
        const found = findStringByKeys(candidate, keys);
        if (found) {
            return found;
        }
    }

    return null;
}

function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
