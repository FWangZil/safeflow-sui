import type { AgentTool } from './skills.js';
export type PaymentIntentStatus = 'pending' | 'claimed' | 'executed' | 'failed' | 'expired' | 'cancelled';
export type ExecutionRail = 'sponsored_guard' | 'native_gasless';
export type ExecutionRailSelection = ExecutionRail | 'auto';
export declare const DEFAULT_COIN_TYPE = "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC";
export declare const DEFAULT_CURRENCY_SYMBOL = "USDC";
export declare const DEFAULT_CURRENCY_DECIMALS = 6;
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
export declare class ProducerApiClient {
    private baseUrl;
    private apiKey?;
    private signingSecret?;
    private timeoutMs;
    constructor(config: ProducerApiClientConfig);
    createIntent(input: CreatePaymentIntentInput): Promise<PaymentIntent>;
    requestSponsor(intentId: string, input: SponsorIntentInput): Promise<SponsorIntentResponse>;
    fetchNextIntent(agentAddress: string): Promise<PaymentIntent | null>;
    ackIntent(intentId: string, agentAddress: string, nonce: string): Promise<PaymentIntent>;
    reportIntentResult(intentId: string, input: ReportIntentResultInput): Promise<PaymentIntent>;
    getIntent(intentId: string): Promise<PaymentIntent>;
    listIntents(agentAddress?: string, status?: PaymentIntentStatus, limit?: number): Promise<PaymentIntent[]>;
    verifyIntentSignature(intent: PaymentIntent): Promise<boolean>;
    private request;
}
export declare function buildIntentSignaturePayload(intent: Pick<PaymentIntent, 'intentId' | 'checkoutSessionId' | 'merchantOrderId' | 'agentAddress' | 'walletId' | 'sessionCapId' | 'recipient' | 'amountAtomic' | 'amountMist' | 'coinType' | 'executionRail' | 'requiresSponsor' | 'sponsorFeeAtomic' | 'sponsorFeeRecipient' | 'currency' | 'currencySymbol' | 'reason' | 'expiresAtMs' | 'metadata'>): IntentSignaturePayload;
export declare function signIntentPayload(payload: IntentSignaturePayload, signingSecret: string): Promise<string>;
export declare function createProducerApiSkills(client: ProducerApiClient): AgentTool[];
