import type { AgentTool } from './skills.js';
export type PaymentIntentStatus = 'pending' | 'claimed' | 'executed' | 'failed' | 'expired' | 'cancelled';
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
export declare class ProducerApiClient {
    private baseUrl;
    private apiKey?;
    private signingSecret?;
    private timeoutMs;
    constructor(config: ProducerApiClientConfig);
    createIntent(input: CreatePaymentIntentInput): Promise<PaymentIntent>;
    fetchNextIntent(agentAddress: string): Promise<PaymentIntent | null>;
    ackIntent(intentId: string, agentAddress: string, nonce: string): Promise<PaymentIntent>;
    reportIntentResult(intentId: string, input: ReportIntentResultInput): Promise<PaymentIntent>;
    getIntent(intentId: string): Promise<PaymentIntent>;
    listIntents(agentAddress?: string, status?: PaymentIntentStatus, limit?: number): Promise<PaymentIntent[]>;
    verifyIntentSignature(intent: PaymentIntent): Promise<boolean>;
    private request;
}
export declare function buildIntentSignaturePayload(intent: Pick<PaymentIntent, 'intentId' | 'merchantOrderId' | 'agentAddress' | 'walletId' | 'sessionCapId' | 'recipient' | 'amountMist' | 'currency' | 'reason' | 'expiresAtMs' | 'metadata'>): IntentSignaturePayload;
export declare function signIntentPayload(payload: IntentSignaturePayload, signingSecret: string): Promise<string>;
export declare function createProducerApiSkills(client: ProducerApiClient): AgentTool[];
