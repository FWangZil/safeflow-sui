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
export declare const DEFAULT_WALRUS_PUBLISHER_URL = "https://publisher.testnet.walrus.space";
export declare const DEFAULT_WALRUS_AGGREGATOR_URL = "https://aggregator.testnet.walrus.space";
export declare const DEFAULT_WALRUS_EPOCHS = 5;
export declare const DEFAULT_WALRUS_TIMEOUT_MS = 20000;
export declare const DEFAULT_WALRUS_SITE_SUFFIX = ".walrus.site";
export declare function uploadJsonToWalrus(payload: WalrusReasoningPayload, inputConfig?: Partial<WalrusClientConfig>): Promise<WalrusUploadResult>;
export declare function resolveWalrusClientConfig(inputConfig?: Partial<WalrusClientConfig>): WalrusClientConfig;
export declare function buildAggregatorBlobUrl(aggregatorUrl: string, blobId: string): string;
export declare function buildWalrusSiteUrl(blobId: string, suffix?: string): string | null;
