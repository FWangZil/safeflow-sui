import type { AgentTool } from './skills.js';

export type PaymentIntentStatus =
    | 'pending'
    | 'claimed'
    | 'executed'
    | 'failed'
    | 'expired'
    | 'cancelled';

export interface PaymentIntent {
    intentId: string;
    merchantOrderId: string;
    agentAddress: string;
    walletId: string;
    sessionCapId: string;
    recipient: string;
    amountMist: number;
    currency: string;
    reason: string;
    metadata?: Record<string, unknown>;
    expiresAtMs: number;
    status: PaymentIntentStatus;
    attemptCount: number;
    signature: string;
    createdAtMs: number;
    updatedAtMs: number;
    claimedAtMs?: number;
    txDigest?: string;
    walrusBlobId?: string;
    errorCode?: string;
    errorMessage?: string;
    finishedAt?: number;
}

export interface CreatePaymentIntentInput {
    merchantOrderId: string;
    agentAddress: string;
    walletId: string;
    sessionCapId: string;
    recipient: string;
    amountMist: number;
    currency?: string;
    reason: string;
    metadata?: Record<string, unknown>;
    expiresAtMs: number;
}

export interface ReportIntentResultInput {
    success: boolean;
    txDigest?: string;
    walrusBlobId?: string;
    errorCode?: string;
    errorMessage?: string;
    finishedAt?: number;
}

export interface ProducerApiClientConfig {
    baseUrl: string;
    apiKey?: string;
    signingSecret?: string;
    timeoutMs?: number;
}

export interface IntentSignaturePayload {
    intentId: string;
    merchantOrderId: string;
    agentAddress: string;
    walletId: string;
    sessionCapId: string;
    recipient: string;
    amountMist: number;
    currency: string;
    reason: string;
    expiresAtMs: number;
    metadata: Record<string, unknown> | null;
}

export class ProducerApiClient {
    private baseUrl: string;
    private apiKey?: string;
    private signingSecret?: string;
    private timeoutMs: number;

    constructor(config: ProducerApiClientConfig) {
        this.baseUrl = config.baseUrl.replace(/\/+$/, '');
        this.apiKey = config.apiKey;
        this.signingSecret = config.signingSecret;
        this.timeoutMs = config.timeoutMs ?? 15_000;
    }

    public async createIntent(input: CreatePaymentIntentInput): Promise<PaymentIntent> {
        const payload = {
            ...input,
            currency: input.currency ?? 'SUI',
        };
        const response = await this.request<{ intent: PaymentIntent }>('/v1/intents', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
        return response.intent;
    }

    public async fetchNextIntent(agentAddress: string): Promise<PaymentIntent | null> {
        const encoded = encodeURIComponent(agentAddress);
        const response = await this.request<{ intent: PaymentIntent | null }>(`/v1/intents/next?agentAddress=${encoded}`);
        return response.intent;
    }

    public async ackIntent(intentId: string, agentAddress: string, nonce: string): Promise<PaymentIntent> {
        const response = await this.request<{ intent: PaymentIntent }>(`/v1/intents/${intentId}/ack`, {
            method: 'POST',
            body: JSON.stringify({
                agentAddress,
                ackAt: Date.now(),
                nonce,
            }),
        });
        return response.intent;
    }

    public async reportIntentResult(intentId: string, input: ReportIntentResultInput): Promise<PaymentIntent> {
        const response = await this.request<{ intent: PaymentIntent }>(`/v1/intents/${intentId}/result`, {
            method: 'POST',
            body: JSON.stringify({
                ...input,
                finishedAt: input.finishedAt ?? Date.now(),
            }),
        });
        return response.intent;
    }

    public async getIntent(intentId: string): Promise<PaymentIntent> {
        const response = await this.request<{ intent: PaymentIntent }>(`/v1/intents/${intentId}`);
        return response.intent;
    }

    public async listIntents(agentAddress?: string, status?: PaymentIntentStatus, limit = 20): Promise<PaymentIntent[]> {
        const params = new URLSearchParams();
        params.set('limit', String(limit));
        if (agentAddress) {
            params.set('agentAddress', agentAddress);
        }
        if (status) {
            params.set('status', status);
        }
        const response = await this.request<{ intents: PaymentIntent[] }>(`/v1/intents?${params.toString()}`);
        return response.intents;
    }

    public async verifyIntentSignature(intent: PaymentIntent): Promise<boolean> {
        if (!this.signingSecret) {
            throw new Error('Missing signingSecret in ProducerApiClient config.');
        }
        const payload = buildIntentSignaturePayload(intent);
        const expected = await signIntentPayload(payload, this.signingSecret);
        return expected === intent.signature;
    }

    private async request<T>(path: string, init?: RequestInit): Promise<T> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
        };

        try {
            const response = await fetch(`${this.baseUrl}${path}`, {
                ...init,
                headers: {
                    ...headers,
                    ...(init?.headers ?? {}),
                },
                signal: controller.signal,
            });
            const text = await response.text();
            const parsed = safeJsonParse(text);
            if (!response.ok) {
                const message = isRecord(parsed) && typeof parsed.error === 'string'
                    ? parsed.error
                    : `${response.status} ${response.statusText}`;
                throw new Error(`Producer API request failed: ${message}`);
            }
            return parsed as T;
        } finally {
            clearTimeout(timeoutId);
        }
    }
}

export function buildIntentSignaturePayload(intent: Pick<
    PaymentIntent,
    | 'intentId'
    | 'merchantOrderId'
    | 'agentAddress'
    | 'walletId'
    | 'sessionCapId'
    | 'recipient'
    | 'amountMist'
    | 'currency'
    | 'reason'
    | 'expiresAtMs'
    | 'metadata'
>): IntentSignaturePayload {
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

export async function signIntentPayload(payload: IntentSignaturePayload, signingSecret: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(signingSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const signed = await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(JSON.stringify(payload)),
    );
    return bytesToHex(new Uint8Array(signed));
}

export function createProducerApiSkills(client: ProducerApiClient): AgentTool[] {
    const fetchNextIntentSkill: AgentTool = {
        name: 'fetch_next_payment_intent',
        description: 'Fetch the next pending payment intent assigned to the current agent from the producer API.',
        parameters: {
            type: 'object',
            properties: {
                agentAddress: {
                    type: 'string',
                    description: 'Agent wallet address used to query pending intents.',
                },
            },
            required: ['agentAddress'],
        },
        execute: async (args: { agentAddress: string }) => {
            try {
                const intent = await client.fetchNextIntent(args.agentAddress);
                return { success: true, intent };
            } catch (error: any) {
                return {
                    success: false,
                    error: error?.message ?? String(error),
                };
            }
        },
    };

    const reportResultSkill: AgentTool = {
        name: 'report_payment_result',
        description: 'Report execution result of a payment intent back to the producer API.',
        parameters: {
            type: 'object',
            properties: {
                intentId: {
                    type: 'string',
                    description: 'Payment intent id',
                },
                success: {
                    type: 'boolean',
                    description: 'Whether the payment execution succeeded',
                },
                txDigest: {
                    type: 'string',
                    description: 'On-chain tx digest when success',
                },
                walrusBlobId: {
                    type: 'string',
                    description: 'Walrus blob id or fallback id',
                },
                errorCode: {
                    type: 'string',
                    description: 'Failure code when success=false',
                },
                errorMessage: {
                    type: 'string',
                    description: 'Failure message when success=false',
                },
            },
            required: ['intentId', 'success'],
        },
        execute: async (args: {
            intentId: string;
            success: boolean;
            txDigest?: string;
            walrusBlobId?: string;
            errorCode?: string;
            errorMessage?: string;
        }) => {
            try {
                const intent = await client.reportIntentResult(args.intentId, {
                    success: args.success,
                    txDigest: args.txDigest,
                    walrusBlobId: args.walrusBlobId,
                    errorCode: args.errorCode,
                    errorMessage: args.errorMessage,
                });
                return { success: true, intent };
            } catch (error: any) {
                return {
                    success: false,
                    error: error?.message ?? String(error),
                };
            }
        },
    };

    return [fetchNextIntentSkill, reportResultSkill];
}

function safeJsonParse(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        return { raw: value };
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}
