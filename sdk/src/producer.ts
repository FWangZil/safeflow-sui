import type { AgentTool } from './skills.js';

export type PaymentIntentStatus =
    | 'pending'
    | 'claimed'
    | 'executed'
    | 'failed'
    | 'expired'
    | 'cancelled';

export type ExecutionRail = 'sponsored_guard' | 'native_gasless';
export type ExecutionRailSelection = ExecutionRail | 'auto';

export const DEFAULT_COIN_TYPE = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';
export const DEFAULT_CURRENCY_SYMBOL = 'USDC';
export const DEFAULT_CURRENCY_DECIMALS = 6;

export interface PaymentIntent {
    intentId: string;
    checkoutSessionId?: string;
    merchantId?: string;
    merchantOrderId: string;
    agentAddress: string;
    walletId: string | null;
    sessionCapId: string | null;
    recipient: string;
    amountAtomic: number;
    amountMist: number;
    coinType: string;
    executionRail: ExecutionRail;
    requiresSponsor: boolean;
    sponsorFeeAtomic?: number;
    sponsorFeeRecipient?: string | null;
    currency: string;
    currencySymbol: string;
    decimals?: number;
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
    walletId?: string | null;
    sessionCapId?: string | null;
    recipient: string;
    amountAtomic?: number;
    amountMist?: number;
    coinType?: string;
    executionRail?: ExecutionRailSelection;
    currency?: string;
    currencySymbol?: string;
    decimals?: number;
    reason: string;
    metadata?: Record<string, unknown>;
    expiresAtMs: number;
}

export interface ReportIntentResultInput {
    agentAddress: string;
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

export interface SponsorIntentInput {
    agentAddress: string;
    walrusBlobId: string;
}

export interface SponsorIntentResponse {
    transactionBytes: string;
    sponsorSignature: string;
    gasBudget: number;
    sponsorFeeAtomic: number;
    sponsorFeeRecipient: string | null;
}

export interface IntentSignaturePayload {
    intentId: string;
    merchantOrderId: string;
    agentAddress: string;
    walletId: string | null;
    sessionCapId: string | null;
    recipient: string;
    amountAtomic: number;
    amountMist: number;
    coinType: string;
    executionRail: ExecutionRail;
    requiresSponsor: boolean;
    sponsorFeeAtomic: number;
    sponsorFeeRecipient: string | null;
    currency: string;
    currencySymbol: string;
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
        const amountAtomic = input.amountAtomic ?? input.amountMist;
        if (!Number.isInteger(amountAtomic) || amountAtomic === undefined || amountAtomic <= 0) {
            throw new Error('amountAtomic or amountMist must be a positive integer.');
        }
        const payload = {
            ...input,
            amountAtomic,
            amountMist: input.amountMist ?? amountAtomic,
            coinType: input.coinType ?? DEFAULT_COIN_TYPE,
            executionRail: input.executionRail ?? 'auto',
            currency: input.currency ?? input.currencySymbol ?? DEFAULT_CURRENCY_SYMBOL,
            currencySymbol: input.currencySymbol ?? input.currency ?? DEFAULT_CURRENCY_SYMBOL,
            decimals: input.decimals ?? DEFAULT_CURRENCY_DECIMALS,
        };
        const response = await this.request<{ intent: PaymentIntent }>('/v1/intents', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
        return response.intent;
    }

    public async requestSponsor(intentId: string, input: SponsorIntentInput): Promise<SponsorIntentResponse> {
        const response = await this.request<{ sponsor: SponsorIntentResponse }>(`/v1/intents/${intentId}/sponsor`, {
            method: 'POST',
            body: JSON.stringify(input),
        });
        return response.sponsor;
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
    | 'checkoutSessionId'
    | 'merchantOrderId'
    | 'agentAddress'
    | 'walletId'
    | 'sessionCapId'
    | 'recipient'
    | 'amountAtomic'
    | 'amountMist'
    | 'coinType'
    | 'executionRail'
    | 'requiresSponsor'
    | 'sponsorFeeAtomic'
    | 'sponsorFeeRecipient'
    | 'currency'
    | 'currencySymbol'
    | 'reason'
    | 'expiresAtMs'
    | 'metadata'
>): IntentSignaturePayload {
    const amountAtomic = intent.amountAtomic ?? intent.amountMist;
    return {
        intentId: intent.intentId,
        merchantOrderId: intent.merchantOrderId,
        agentAddress: intent.agentAddress,
        walletId: intent.walletId,
        sessionCapId: intent.sessionCapId,
        recipient: intent.recipient,
        amountAtomic,
        amountMist: intent.amountMist ?? amountAtomic,
        coinType: intent.coinType,
        executionRail: intent.executionRail ?? 'sponsored_guard',
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
                agentAddress: {
                    type: 'string',
                    description: 'Agent wallet address assigned to the intent.',
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
            required: ['intentId', 'agentAddress', 'success'],
        },
        execute: async (args: {
            intentId: string;
            agentAddress: string;
            success: boolean;
            txDigest?: string;
            walrusBlobId?: string;
            errorCode?: string;
            errorMessage?: string;
        }) => {
            try {
                const intent = await client.reportIntentResult(args.intentId, {
                    agentAddress: args.agentAddress,
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
