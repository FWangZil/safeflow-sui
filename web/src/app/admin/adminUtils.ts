const SUI_OBJECT_ID_RE = /^0x[0-9a-fA-F]{64}$/;

interface ProducerEnvSnippetInput {
    payoutAddress: string;
    agentAddress: string;
    walletId: string;
    sessionCapId: string;
}

interface AgentRunnerCommandInput {
    producerApiBaseUrl: string;
    pollMs?: number;
}

export function isSuiObjectId(value: string): boolean {
    return SUI_OBJECT_ID_RE.test(value.trim());
}

export function buildProducerEnvSnippet({
    payoutAddress,
    agentAddress,
    walletId,
    sessionCapId,
}: ProducerEnvSnippetInput): string {
    return [
        `DEMO_PAYOUT_ADDRESS=${payoutAddress.trim()}`,
        `DEMO_AGENT_ADDRESS=${agentAddress.trim()}`,
        `DEMO_WALLET_ID=${walletId.trim()}`,
        `DEMO_SESSION_CAP_ID=${sessionCapId.trim()}`,
    ].join('\n');
}

export function buildAgentRunnerCommand({
    producerApiBaseUrl,
    pollMs = 3000,
}: AgentRunnerCommandInput): string {
    const baseUrl = producerApiBaseUrl.trim() || 'http://localhost:8787';
    const interval = Number.isFinite(pollMs) && pollMs > 0 ? Math.trunc(pollMs) : 3000;
    return [
        'cd agent_scripts',
        `PRODUCER_API_BASE_URL=${baseUrl} npm run run:e2e -- --poll-ms ${interval}`,
    ].join('\n');
}

export function formatAtomicAmount(amountAtomic: string | number | bigint, decimals = 6): string {
    const raw = normalizeAtomicAmount(amountAtomic);
    if (raw === BigInt(0)) return '0';

    const base = BigInt(10) ** BigInt(decimals);
    const whole = raw / base;
    const fraction = raw % base;
    if (fraction === BigInt(0)) return whole.toString();

    const padded = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
    return `${whole.toString()}.${padded}`;
}

export function normalizeAtomicAmount(amountAtomic: string | number | bigint): bigint {
    if (typeof amountAtomic === 'bigint') return amountAtomic < BigInt(0) ? BigInt(0) : amountAtomic;
    const value = String(amountAtomic).trim();
    if (!/^[0-9]+$/.test(value)) return BigInt(0);
    return BigInt(value);
}

export function shortObjectId(value: string, head = 8, tail = 6): string {
    const trimmed = value.trim();
    return trimmed.length > head + tail ? `${trimmed.slice(0, head)}...${trimmed.slice(-tail)}` : trimmed;
}
