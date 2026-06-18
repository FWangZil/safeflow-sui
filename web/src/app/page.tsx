'use client';

import { ConnectButton, useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import {
    Activity,
    ArrowUpRight,
    BadgeDollarSign,
    Clipboard,
    ExternalLink,
    Gauge,
    KeyRound,
    ReceiptText,
    ShieldCheck,
} from 'lucide-react';
import Image from 'next/image';
import { useMemo, useState } from 'react';

const DEFAULT_COIN_TYPE = process.env.NEXT_PUBLIC_DEFAULT_COIN_TYPE
    ?? '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';
const CLOCK_OBJECT_ID = '0x6';
const DEFAULT_WALRUS_AGGREGATOR_URL = process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL || 'https://aggregator.walrus-testnet.walrus.space';
const DEFAULT_WALRUS_SITE_SUFFIX = process.env.NEXT_PUBLIC_WALRUS_SITE_SUFFIX || '.walrus.site';
const DEFAULT_PRODUCER_API_BASE_URL = process.env.NEXT_PUBLIC_PRODUCER_API_BASE_URL || 'http://localhost:8787';
type CheckoutRailSelection = 'auto' | 'sponsored_guard' | 'native_gasless';

interface BlobLinks {
    aggregatorUrl: string;
    siteUrl: string | null;
}

interface IntentView {
    intentId: string;
    checkoutSessionId?: string;
    merchantOrderId: string;
    status: string;
    reason: string;
    amountAtomic: number;
    amountMist?: number;
    coinType: string;
    executionRail: 'sponsored_guard' | 'native_gasless';
    requiresSponsor: boolean;
    sponsorFeeAtomic?: number;
    sponsorFeeRecipient?: string | null;
    currencySymbol: string;
    recipient: string;
    txDigest?: string;
    walrusBlobId?: string;
    errorCode?: string;
    errorMessage?: string;
    updatedAtMs: number;
}

interface CheckoutSessionView {
    sessionId: string;
    merchantOrderId: string;
    intentId: string;
    status: string;
    checkoutUrl: string;
    recipient: string;
    amountAtomic: number;
    coinType: string;
    executionRail: 'sponsored_guard' | 'native_gasless';
    requiresSponsor: boolean;
    sponsorFeeAtomic?: number;
    sponsorFeeRecipient?: string | null;
    currencySymbol: string;
    txDigest?: string;
    walrusBlobId?: string;
    errorCode?: string;
    errorMessage?: string;
    updatedAtMs: number;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function getDigestFromResult(result: unknown): string | null {
    if (!isRecord(result)) return null;
    return typeof result.digest === 'string' ? result.digest : null;
}

function extractIdFromEvents(events: Array<{ type: string; parsedJson: unknown }>, eventName: string, fieldName: string): string | null {
    for (const event of events) {
        if (!event.type.endsWith(`::wallet::${eventName}`) || !isRecord(event.parsedJson)) continue;
        const value = event.parsedJson[fieldName];
        if (typeof value === 'string') return value;
    }
    return null;
}

function extractWalrusBlobIdFromPaymentEvent(events: Array<{ type: string; parsedJson: unknown }>, packageId: string): string | null {
    const exactType = `${packageId}::wallet::PaymentExecuted`;
    for (const event of events) {
        if ((event.type !== exactType && !event.type.endsWith('::wallet::PaymentExecuted')) || !isRecord(event.parsedJson)) continue;
        const blobId = event.parsedJson.walrus_blob_id;
        if (typeof blobId === 'string' && blobId.length > 0) return blobId;
    }
    return null;
}

function buildWalrusLinks(blobId: string): BlobLinks {
    const aggregatorUrl = `${DEFAULT_WALRUS_AGGREGATOR_URL.replace(/\/+$/, '')}/v1/blobs/${encodeURIComponent(blobId)}`;
    if (blobId.startsWith('fallback:')) return { aggregatorUrl, siteUrl: null };
    const suffix = DEFAULT_WALRUS_SITE_SUFFIX.startsWith('.') ? DEFAULT_WALRUS_SITE_SUFFIX : `.${DEFAULT_WALRUS_SITE_SUFFIX}`;
    return { aggregatorUrl, siteUrl: `https://${blobId}${suffix}` };
}

function formatAmount(amountAtomic: number, decimals = 6): string {
    const base = 10 ** decimals;
    return (amountAtomic / base).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: decimals,
    });
}

function formatRail(rail: 'sponsored_guard' | 'native_gasless'): string {
    return rail === 'native_gasless' ? 'Native gasless' : 'Sponsored guard';
}

function short(value: string, head = 8, tail = 6): string {
    return value.length > head + tail ? `${value.slice(0, head)}...${value.slice(-tail)}` : value;
}

function StatusPill({ status }: { status: string }) {
    const color = status === 'executed'
        ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
        : status === 'failed' || status === 'expired'
            ? 'bg-red-100 text-red-800 border-red-200'
            : status === 'claimed'
                ? 'bg-amber-100 text-amber-800 border-amber-200'
                : 'bg-slate-100 text-slate-700 border-slate-200';
    return <span className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-semibold ${color}`}>{status}</span>;
}

export default function Home() {
    const currentAccount = useCurrentAccount();
    const suiClient = useSuiClient();
    const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction();

    const [agentAddress, setAgentAddress] = useState('');
    const [coinType, setCoinType] = useState(DEFAULT_COIN_TYPE);
    const [maxSpendPerSecond, setMaxSpendPerSecond] = useState('1000000');
    const [maxTotalSpend, setMaxTotalSpend] = useState('10000000');
    const [operatorStatus, setOperatorStatus] = useState('');
    const [walletId, setWalletId] = useState('');
    const [sessionCapId, setSessionCapId] = useState('');

    const [merchantApiKey, setMerchantApiKey] = useState('');
    const [checkoutOrderId, setCheckoutOrderId] = useState(`order_${Date.now()}`);
    const [checkoutAmount, setCheckoutAmount] = useState('1250000');
    const [checkoutRail, setCheckoutRail] = useState<CheckoutRailSelection>('auto');
    const [checkoutReason, setCheckoutReason] = useState('AI agent checkout payment');
    const [checkoutStatus, setCheckoutStatus] = useState('');
    const [checkoutSession, setCheckoutSession] = useState<CheckoutSessionView | null>(null);
    const [checkoutIntent, setCheckoutIntent] = useState<IntentView | null>(null);
    const [sessionLookupId, setSessionLookupId] = useState('');

    const [intentIdQuery, setIntentIdQuery] = useState('');
    const [queryDigest, setQueryDigest] = useState('');
    const [auditStatus, setAuditStatus] = useState('');
    const [observedIntent, setObservedIntent] = useState<IntentView | null>(null);
    const [resolvedBlobId, setResolvedBlobId] = useState('');
    const [blobLinks, setBlobLinks] = useState<BlobLinks | null>(null);

    const packageId = process.env.NEXT_PUBLIC_PACKAGE_ID;
    const checkoutUrl = useMemo(() => checkoutSession?.checkoutUrl ?? '', [checkoutSession]);

    const handleCreateWalletAndCap = async () => {
        if (!currentAccount) {
            setOperatorStatus('Connect a Sui wallet first.');
            return;
        }
        if (!packageId) {
            setOperatorStatus('Missing NEXT_PUBLIC_PACKAGE_ID.');
            return;
        }
        if (!/^0x[0-9a-fA-F]{64}$/.test(agentAddress.trim())) {
            setOperatorStatus('Agent address must be 0x + 64 hex chars.');
            return;
        }

        try {
            setOperatorStatus('Creating stablecoin AgentWallet...');
            setWalletId('');
            setSessionCapId('');

            const createWalletTx = new Transaction();
            createWalletTx.moveCall({
                target: `${packageId}::wallet::create_wallet`,
                typeArguments: [coinType.trim()],
                arguments: [],
            });
            const walletExecution = await signAndExecuteTransaction({ transaction: createWalletTx });
            const walletDigest = getDigestFromResult(walletExecution);
            if (!walletDigest) throw new Error('Wallet transaction returned no digest.');
            const walletTx = await suiClient.waitForTransaction({ digest: walletDigest, options: { showEvents: true } });
            const createdWalletId = extractIdFromEvents(walletTx.events ?? [], 'WalletCreated', 'wallet_id');
            if (!createdWalletId) throw new Error('WalletCreated event did not include wallet_id.');
            setWalletId(createdWalletId);

            setOperatorStatus('Creating SessionCap...');
            const createCapTx = new Transaction();
            createCapTx.moveCall({
                target: `${packageId}::wallet::create_session_cap`,
                typeArguments: [coinType.trim()],
                arguments: [
                    createCapTx.object(createdWalletId),
                    createCapTx.pure.address(agentAddress.trim()),
                    createCapTx.pure.u64(Number(maxSpendPerSecond)),
                    createCapTx.pure.u64(Number(maxTotalSpend)),
                    createCapTx.pure.u64(Date.now() + 24 * 60 * 60 * 1000),
                    createCapTx.object(CLOCK_OBJECT_ID),
                ],
            });
            const capExecution = await signAndExecuteTransaction({ transaction: createCapTx });
            const capDigest = getDigestFromResult(capExecution);
            if (!capDigest) throw new Error('SessionCap transaction returned no digest.');
            const capTx = await suiClient.waitForTransaction({ digest: capDigest, options: { showEvents: true } });
            const createdCapId = extractIdFromEvents(capTx.events ?? [], 'SessionCapCreated', 'cap_id');
            if (!createdCapId) throw new Error('SessionCapCreated event did not include cap_id.');
            setSessionCapId(createdCapId);
            setOperatorStatus('Allowance created. Deposit USDC into the wallet object with the CLI helper, then seed the producer API.');
        } catch (error) {
            setOperatorStatus(`Error: ${getErrorMessage(error)}`);
        }
    };

    const handleCreateCheckoutSession = async () => {
        if (!merchantApiKey.trim()) {
            setCheckoutStatus('Enter the demo merchant API key from seed:demo.');
            return;
        }
        try {
            setCheckoutStatus('Creating checkout session...');
            const response = await fetch(`${DEFAULT_PRODUCER_API_BASE_URL.replace(/\/+$/, '')}/v1/checkout/sessions`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-api-key': merchantApiKey.trim(),
                },
                body: JSON.stringify({
                    merchantOrderId: checkoutOrderId.trim(),
                    executionRail: checkoutRail,
                    ...(agentAddress.trim() ? { agentAddress: agentAddress.trim() } : {}),
                    amountAtomic: Number(checkoutAmount),
                    coinType: coinType.trim(),
                    currencySymbol: 'USDC',
                    reason: checkoutReason.trim(),
                }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
            setCheckoutSession(payload.session);
            setCheckoutIntent(payload.intent);
            setSessionLookupId(payload.session.sessionId);
            setIntentIdQuery(payload.intent.intentId);
            setCheckoutStatus('Checkout session created.');
        } catch (error) {
            setCheckoutStatus(`Error: ${getErrorMessage(error)}`);
        }
    };

    const handleLoadCheckoutSession = async () => {
        if (!sessionLookupId.trim()) {
            setCheckoutStatus('Enter a checkout session id.');
            return;
        }
        try {
            setCheckoutStatus('Loading checkout session...');
            const response = await fetch(`${DEFAULT_PRODUCER_API_BASE_URL.replace(/\/+$/, '')}/v1/checkout/sessions/${encodeURIComponent(sessionLookupId.trim())}`);
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
            setCheckoutSession(payload.session);
            setCheckoutStatus('Checkout session loaded.');
        } catch (error) {
            setCheckoutStatus(`Error: ${getErrorMessage(error)}`);
        }
    };

    const handleLookupIntent = async () => {
        if (!intentIdQuery.trim()) {
            setAuditStatus('Enter an intent ID.');
            return;
        }
        try {
            setAuditStatus('Fetching intent...');
            const response = await fetch(`${DEFAULT_PRODUCER_API_BASE_URL.replace(/\/+$/, '')}/v1/intents/${encodeURIComponent(intentIdQuery.trim())}`);
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
            setObservedIntent(payload.intent);
            if (payload.intent.walrusBlobId) {
                setResolvedBlobId(payload.intent.walrusBlobId);
                setBlobLinks(buildWalrusLinks(payload.intent.walrusBlobId));
            }
            setAuditStatus('Intent loaded.');
        } catch (error) {
            setAuditStatus(`Error: ${getErrorMessage(error)}`);
        }
    };

    const handleLookupWalrusEvidence = async () => {
        if (!packageId) {
            setAuditStatus('Missing NEXT_PUBLIC_PACKAGE_ID.');
            return;
        }
        if (!queryDigest.trim()) {
            setAuditStatus('Enter a transaction digest.');
            return;
        }
        try {
            setAuditStatus('Fetching transaction events...');
            const tx = await suiClient.getTransactionBlock({
                digest: queryDigest.trim(),
                options: { showEvents: true },
            });
            const blobId = extractWalrusBlobIdFromPaymentEvent(tx.events ?? [], packageId);
            if (!blobId) throw new Error('No PaymentExecuted event with walrus_blob_id found.');
            setResolvedBlobId(blobId);
            setBlobLinks(buildWalrusLinks(blobId));
            setAuditStatus('Walrus evidence resolved.');
        } catch (error) {
            setAuditStatus(`Error: ${getErrorMessage(error)}`);
        }
    };

    const copy = async (value: string) => {
        await navigator.clipboard.writeText(value);
    };

    return (
        <main className="min-h-screen bg-[#f6f8f7] text-slate-950">
            <header className="border-b border-slate-200 bg-white">
                <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
                    <div className="flex items-center gap-3">
                        <Image src="/safeflow-logo-128.png" alt="SafeFlow" width={40} height={40} className="h-10 w-10 rounded-md" priority />
                        <div>
                            <h1 className="text-lg font-semibold tracking-normal">SafeFlow Gasless Checkout</h1>
                            <p className="text-xs text-slate-500">AgentPay Guard for stablecoin merchant settlement</p>
                        </div>
                    </div>
                    <ConnectButton />
                </div>
            </header>

            <section className="mx-auto grid max-w-7xl gap-5 px-5 py-6 lg:grid-cols-[1fr_1.15fr_1fr]">
                <Panel icon={<ShieldCheck className="h-5 w-5" />} title="Operator Setup" description="Provision a coin-specific wallet and SessionCap. Sponsor gas is used only later by the agent payment executor.">
                    <Field label="Agent address">
                        <input value={agentAddress} onChange={(event) => setAgentAddress(event.target.value)} className="input" placeholder="0x..." />
                    </Field>
                    <Field label="Coin type">
                        <textarea value={coinType} onChange={(event) => setCoinType(event.target.value)} className="input min-h-20 resize-none font-mono text-xs" />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Per-second limit">
                            <input value={maxSpendPerSecond} onChange={(event) => setMaxSpendPerSecond(event.target.value)} className="input" inputMode="numeric" />
                        </Field>
                        <Field label="Total cap">
                            <input value={maxTotalSpend} onChange={(event) => setMaxTotalSpend(event.target.value)} className="input" inputMode="numeric" />
                        </Field>
                    </div>
                    <button onClick={handleCreateWalletAndCap} className="primary-button">
                        <KeyRound className="h-4 w-4" /> Provision allowance
                    </button>
                    <StatusBox message={operatorStatus} />
                    <ObjectRow label="walletId" value={walletId} onCopy={copy} />
                    <ObjectRow label="sessionCapId" value={sessionCapId} onCopy={copy} />
                </Panel>

                <Panel icon={<ReceiptText className="h-5 w-5" />} title="Merchant Checkout" description="Create a checkout session backed by a signed intent. Simple transfers use native gasless stablecoins; guarded payments use sponsor gas.">
                    <Field label="Merchant API key">
                        <input value={merchantApiKey} onChange={(event) => setMerchantApiKey(event.target.value)} className="input" placeholder="sf_demo_..." />
                    </Field>
                    <div className="grid gap-3 md:grid-cols-2">
                        <Field label="Order ID">
                            <input value={checkoutOrderId} onChange={(event) => setCheckoutOrderId(event.target.value)} className="input" />
                        </Field>
                        <Field label="Amount atomic">
                            <input value={checkoutAmount} onChange={(event) => setCheckoutAmount(event.target.value)} className="input" inputMode="numeric" />
                        </Field>
                    </div>
                    <Field label="Execution rail">
                        <select value={checkoutRail} onChange={(event) => setCheckoutRail(event.target.value as CheckoutRailSelection)} className="input">
                            <option value="auto">Auto select best rail</option>
                            <option value="native_gasless">Native gasless stablecoin transfer</option>
                            <option value="sponsored_guard">Sponsored AgentPay Guard</option>
                        </select>
                    </Field>
                    <Field label="Reason">
                        <input value={checkoutReason} onChange={(event) => setCheckoutReason(event.target.value)} className="input" />
                    </Field>
                    <button onClick={handleCreateCheckoutSession} className="primary-button bg-slate-950 hover:bg-slate-800">
                        <BadgeDollarSign className="h-4 w-4" /> Create checkout session
                    </button>
                    <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                        <input value={sessionLookupId} onChange={(event) => setSessionLookupId(event.target.value)} className="input" placeholder="session id" />
                        <button onClick={handleLoadCheckoutSession} className="secondary-button">Refresh</button>
                    </div>
                    <StatusBox message={checkoutStatus} />
                    {checkoutSession && (
                        <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <div className="text-sm font-semibold">Checkout {short(checkoutSession.sessionId)}</div>
                                <StatusPill status={checkoutSession.status} />
                            </div>
                            <Metric label="Amount" value={`${formatAmount(checkoutSession.amountAtomic)} ${checkoutSession.currencySymbol}`} />
                            <Metric label="Rail" value={formatRail(checkoutSession.executionRail)} />
                            {checkoutSession.requiresSponsor && (
                                <Metric label="Sponsor fee" value={`${formatAmount(checkoutSession.sponsorFeeAtomic ?? 0)} ${checkoutSession.currencySymbol}`} />
                            )}
                            <Metric label="Intent" value={short(checkoutSession.intentId)} />
                            <Metric label="Recipient" value={short(checkoutSession.recipient)} />
                            {checkoutUrl && (
                                <a className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700" href={checkoutUrl} target="_blank" rel="noreferrer">
                                    Open checkout <ArrowUpRight className="h-4 w-4" />
                                </a>
                            )}
                        </div>
                    )}
                    {checkoutIntent && (
                        <>
                            <ObjectRow label="intentId" value={checkoutIntent.intentId} onCopy={copy} />
                            <ObjectRow label="requiresSponsor" value={String(checkoutIntent.requiresSponsor)} onCopy={copy} />
                            {checkoutIntent.sponsorFeeRecipient && <ObjectRow label="sponsorFeeRecipient" value={checkoutIntent.sponsorFeeRecipient} onCopy={copy} />}
                        </>
                    )}
                </Panel>

                <Panel icon={<Activity className="h-5 w-5" />} title="Audit Trail" description="Inspect producer status and resolve Walrus evidence from the final Sui transaction.">
                    <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                        <input value={intentIdQuery} onChange={(event) => setIntentIdQuery(event.target.value)} className="input" placeholder="intentId" />
                        <button onClick={handleLookupIntent} className="secondary-button">Load intent</button>
                    </div>
                    <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                        <input value={queryDigest} onChange={(event) => setQueryDigest(event.target.value)} className="input" placeholder="tx digest" />
                        <button onClick={handleLookupWalrusEvidence} className="secondary-button">Resolve evidence</button>
                    </div>
                    <StatusBox message={auditStatus} />
                    {observedIntent && (
                        <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <div className="text-sm font-semibold">{observedIntent.merchantOrderId}</div>
                                <StatusPill status={observedIntent.status} />
                            </div>
                            <Metric label="Amount" value={`${formatAmount(observedIntent.amountAtomic)} ${observedIntent.currencySymbol}`} />
                            {observedIntent.requiresSponsor && (
                                <Metric label="Sponsor fee" value={`${formatAmount(observedIntent.sponsorFeeAtomic ?? 0)} ${observedIntent.currencySymbol}`} />
                            )}
                            <Metric label="Recipient" value={short(observedIntent.recipient)} />
                            {observedIntent.txDigest && <Metric label="txDigest" value={short(observedIntent.txDigest)} />}
                            {observedIntent.walrusBlobId && <Metric label="Walrus" value={short(observedIntent.walrusBlobId)} />}
                        </div>
                    )}
                    {resolvedBlobId && <ObjectRow label="walrusBlobId" value={resolvedBlobId} onCopy={copy} />}
                    {blobLinks && (
                        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
                            <a className="flex items-center gap-2 text-emerald-700" href={blobLinks.aggregatorUrl} target="_blank" rel="noreferrer">
                                Aggregator <ExternalLink className="h-4 w-4" />
                            </a>
                            {blobLinks.siteUrl && (
                                <a className="flex items-center gap-2 text-emerald-700" href={blobLinks.siteUrl} target="_blank" rel="noreferrer">
                                    Walrus site <ExternalLink className="h-4 w-4" />
                                </a>
                            )}
                        </div>
                    )}
                </Panel>
            </section>

            <section className="mx-auto grid max-w-7xl gap-5 px-5 pb-8 md:grid-cols-3">
                <InfoStrip icon={<Gauge className="h-5 w-5" />} title="Guarded by SessionCap" body="The Move object enforces per-second spend, total spend, expiry, and wallet binding." />
                <InfoStrip icon={<BadgeDollarSign className="h-5 w-5" />} title="Stablecoin-first" body="Native gasless uses Sui address-balance stablecoin transfer for simple USDC checkout." />
                <InfoStrip icon={<ShieldCheck className="h-5 w-5" />} title="Guard when needed" body="Complex agent payments keep SessionCap controls and sponsor gas after ACK." />
            </section>
        </main>
    );
}

function Panel({ icon, title, description, children }: { icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) {
    return (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-start gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-md bg-emerald-50 text-emerald-700">{icon}</div>
                <div>
                    <h2 className="text-base font-semibold tracking-normal">{title}</h2>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
                </div>
            </div>
            <div className="space-y-4">{children}</div>
        </section>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-normal text-slate-500">{label}</span>
            {children}
        </label>
    );
}

function StatusBox({ message }: { message: string }) {
    if (!message) return null;
    return <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{message}</div>;
}

function ObjectRow({ label, value, onCopy }: { label: string; value: string; onCopy: (value: string) => void }) {
    if (!value) return null;
    return (
        <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="min-w-0">
                <div className="text-xs font-semibold uppercase text-slate-500">{label}</div>
                <div className="truncate font-mono text-xs text-slate-800">{value}</div>
            </div>
            <button aria-label={`Copy ${label}`} onClick={() => onCopy(value)} className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-100">
                <Clipboard className="h-4 w-4" />
            </button>
        </div>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="mb-2 flex items-center justify-between gap-4 text-sm">
            <span className="text-slate-500">{label}</span>
            <span className="min-w-0 truncate font-mono text-xs text-slate-900">{value}</span>
        </div>
    );
}

function InfoStrip({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
    return (
        <div className="flex gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-700">{icon}</div>
            <div>
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">{body}</p>
            </div>
        </div>
    );
}
