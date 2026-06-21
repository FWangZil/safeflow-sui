'use client';

import { ConnectButton, useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import {
    BadgeDollarSign,
    CheckCircle2,
    Clipboard,
    Coins,
    Database,
    ExternalLink,
    KeyRound,
    RefreshCw,
    ShieldCheck,
    Terminal,
    WalletCards,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
    buildAgentRunnerCommand,
    buildProducerEnvSnippet,
    formatAtomicAmount,
    isSuiObjectId,
    normalizeAtomicAmount,
    shortObjectId,
} from './adminUtils';

const DEFAULT_PACKAGE_ID = process.env.NEXT_PUBLIC_PACKAGE_ID ?? '';
const DEFAULT_COIN_TYPE = process.env.NEXT_PUBLIC_DEFAULT_COIN_TYPE
    ?? '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';
const DEFAULT_AGENT_ADDRESS = process.env.NEXT_PUBLIC_DEMO_AGENT_ADDRESS ?? '';
const DEFAULT_PAYOUT_ADDRESS = process.env.NEXT_PUBLIC_DEMO_PAYOUT_ADDRESS ?? '';
const DEFAULT_WALLET_ID = process.env.NEXT_PUBLIC_DEMO_WALLET_ID ?? '';
const DEFAULT_SESSION_CAP_ID = process.env.NEXT_PUBLIC_DEMO_SESSION_CAP_ID ?? '';
const DEFAULT_PRODUCER_API_BASE_URL = process.env.NEXT_PUBLIC_PRODUCER_API_BASE_URL ?? 'http://localhost:8787';
const DEFAULT_DEMO_MERCHANT_API_KEY = process.env.NEXT_PUBLIC_DEMO_MERCHANT_API_KEY ?? '';
const CLOCK_OBJECT_ID = '0x6';

interface CoinOption {
    coinObjectId: string;
    balance: string;
    version?: string;
    digest?: string;
}

interface WaitForTransactionResult {
    events?: Array<{ type: string; parsedJson?: unknown }>;
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

function extractIdFromEvents(events: Array<{ type: string; parsedJson?: unknown }>, eventName: string, fieldName: string): string | null {
    for (const event of events) {
        if (!event.type.endsWith(`::wallet::${eventName}`) || !isRecord(event.parsedJson)) continue;
        const value = event.parsedJson[fieldName];
        if (typeof value === 'string') return value;
    }
    return null;
}

function extractWalletBalance(content: unknown): string | null {
    if (!isRecord(content) || content.dataType !== 'moveObject' || !isRecord(content.fields)) return null;
    const balance = content.fields.balance;
    return typeof balance === 'string' ? balance : null;
}

export default function AdminPage() {
    const currentAccount = useCurrentAccount();
    const suiClient = useSuiClient();
    const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction();

    const [packageId, setPackageId] = useState(DEFAULT_PACKAGE_ID);
    const [coinType, setCoinType] = useState(DEFAULT_COIN_TYPE);
    const [payoutAddress, setPayoutAddress] = useState(DEFAULT_PAYOUT_ADDRESS);
    const [agentAddress, setAgentAddress] = useState(DEFAULT_AGENT_ADDRESS);
    const [walletId, setWalletId] = useState(DEFAULT_WALLET_ID);
    const [sessionCapId, setSessionCapId] = useState(DEFAULT_SESSION_CAP_ID);
    const [maxSpendPerSecond, setMaxSpendPerSecond] = useState('1000000');
    const [maxTotalSpend, setMaxTotalSpend] = useState('10000000');
    const [depositAmountAtomic, setDepositAmountAtomic] = useState('1000000');
    const [selectedCoinId, setSelectedCoinId] = useState('');
    const [coins, setCoins] = useState<CoinOption[]>([]);
    const [walletBalanceAtomic, setWalletBalanceAtomic] = useState('');
    const [setupStatus, setSetupStatus] = useState('');
    const [depositStatus, setDepositStatus] = useState('');
    const [lastWalletDigest, setLastWalletDigest] = useState('');
    const [lastCapDigest, setLastCapDigest] = useState('');
    const [lastDepositDigest, setLastDepositDigest] = useState('');

    const selectedCoin = useMemo(
        () => coins.find((coin) => coin.coinObjectId === selectedCoinId) ?? null,
        [coins, selectedCoinId],
    );
    const envSnippet = useMemo(
        () => buildProducerEnvSnippet({ payoutAddress, agentAddress, walletId, sessionCapId }),
        [agentAddress, payoutAddress, sessionCapId, walletId],
    );
    const agentRunnerCommand = useMemo(
        () => buildAgentRunnerCommand({ producerApiBaseUrl: DEFAULT_PRODUCER_API_BASE_URL, pollMs: 3000 }),
        [],
    );
    const canSeedProducer = [payoutAddress, agentAddress, walletId, sessionCapId].every(isSuiObjectId);
    const depositAmount = normalizeAtomicAmount(depositAmountAtomic);

    const copy = async (value: string) => {
        await navigator.clipboard.writeText(value);
    };

    const refreshCoins = async () => {
        if (!currentAccount) {
            setDepositStatus('Connect the owner wallet first.');
            return;
        }
        try {
            setDepositStatus('Loading owned coin objects...');
            const response = await suiClient.getCoins({
                owner: currentAccount.address,
                coinType: coinType.trim(),
                limit: 50,
            });
            const nextCoins = response.data.map((coin) => ({
                coinObjectId: coin.coinObjectId,
                balance: coin.balance,
                version: coin.version,
                digest: coin.digest,
            }));
            setCoins(nextCoins);
            setSelectedCoinId((current) => current || nextCoins[0]?.coinObjectId || '');
            setDepositStatus(nextCoins.length > 0 ? 'Coin objects loaded.' : 'No coin objects found for this owner and coin type.');
        } catch (error) {
            setDepositStatus(`Error: ${getErrorMessage(error)}`);
        }
    };

    const refreshWalletBalance = async () => {
        if (!isSuiObjectId(walletId)) {
            setDepositStatus('Enter a valid wallet object id first.');
            return;
        }
        try {
            setDepositStatus('Loading guarded wallet balance...');
            const response = await suiClient.getObject({
                id: walletId.trim(),
                options: { showContent: true },
            });
            const balance = extractWalletBalance(response.data?.content);
            if (balance === null) throw new Error('Could not read AgentWallet balance from object content.');
            setWalletBalanceAtomic(balance);
            setDepositStatus('Guarded wallet balance refreshed.');
        } catch (error) {
            setDepositStatus(`Error: ${getErrorMessage(error)}`);
        }
    };

    const createWalletAndCap = async () => {
        if (!currentAccount) {
            setSetupStatus('Connect the owner wallet first.');
            return;
        }
        if (!isSuiObjectId(packageId)) {
            setSetupStatus('Enter a valid package id.');
            return;
        }
        if (!isSuiObjectId(agentAddress)) {
            setSetupStatus('Enter a valid agent address.');
            return;
        }
        try {
            setSetupStatus('Creating AgentWallet...');
            setLastWalletDigest('');
            setLastCapDigest('');

            const createWalletTx = new Transaction();
            createWalletTx.moveCall({
                target: `${packageId.trim()}::wallet::create_wallet`,
                typeArguments: [coinType.trim()],
                arguments: [],
            });
            const walletExecution = await signAndExecuteTransaction({ transaction: createWalletTx });
            const walletDigest = getDigestFromResult(walletExecution);
            if (!walletDigest) throw new Error('Wallet creation returned no digest.');
            setLastWalletDigest(walletDigest);
            const walletTx = await suiClient.waitForTransaction({
                digest: walletDigest,
                options: { showEvents: true },
            }) as WaitForTransactionResult;
            const createdWalletId = extractIdFromEvents(walletTx.events ?? [], 'WalletCreated', 'wallet_id');
            if (!createdWalletId) throw new Error('WalletCreated event did not include wallet_id.');
            setWalletId(createdWalletId);

            setSetupStatus('Creating SessionCap...');
            const createCapTx = new Transaction();
            createCapTx.moveCall({
                target: `${packageId.trim()}::wallet::create_session_cap`,
                typeArguments: [coinType.trim()],
                arguments: [
                    createCapTx.object(createdWalletId),
                    createCapTx.pure.address(agentAddress.trim()),
                    createCapTx.pure.u64(Number(maxSpendPerSecond)),
                    createCapTx.pure.u64(Number(maxTotalSpend)),
                    createCapTx.pure.u64(Date.now() + 7 * 24 * 60 * 60 * 1000),
                    createCapTx.object(CLOCK_OBJECT_ID),
                ],
            });
            const capExecution = await signAndExecuteTransaction({ transaction: createCapTx });
            const capDigest = getDigestFromResult(capExecution);
            if (!capDigest) throw new Error('SessionCap creation returned no digest.');
            setLastCapDigest(capDigest);
            const capTx = await suiClient.waitForTransaction({
                digest: capDigest,
                options: { showEvents: true },
            }) as WaitForTransactionResult;
            const createdCapId = extractIdFromEvents(capTx.events ?? [], 'SessionCapCreated', 'cap_id');
            if (!createdCapId) throw new Error('SessionCapCreated event did not include cap_id.');
            setSessionCapId(createdCapId);
            setSetupStatus('Wallet and SessionCap created. Copy the env snippet into producer_api/.env, then seed the Producer API.');
        } catch (error) {
            setSetupStatus(`Error: ${getErrorMessage(error)}`);
        }
    };

    const depositSelectedCoin = async () => {
        if (!currentAccount) {
            setDepositStatus('Connect the owner wallet first.');
            return;
        }
        if (!isSuiObjectId(packageId) || !isSuiObjectId(walletId)) {
            setDepositStatus('Enter valid package and wallet ids.');
            return;
        }
        if (!selectedCoin) {
            setDepositStatus('Select a coin object first.');
            return;
        }
        if (depositAmount <= BigInt(0)) {
            setDepositStatus('Enter a positive atomic deposit amount.');
            return;
        }
        const selectedBalance = normalizeAtomicAmount(selectedCoin.balance);
        if (depositAmount > selectedBalance) {
            setDepositStatus('Deposit amount exceeds selected coin balance.');
            return;
        }

        try {
            setDepositStatus('Depositing coin into guarded wallet...');
            setLastDepositDigest('');
            const tx = new Transaction();
            const depositCoin = depositAmount === selectedBalance
                ? tx.object(selectedCoin.coinObjectId)
                : tx.splitCoins(tx.object(selectedCoin.coinObjectId), [depositAmount.toString()])[0];
            tx.moveCall({
                target: `${packageId.trim()}::wallet::deposit`,
                typeArguments: [coinType.trim()],
                arguments: [
                    tx.object(walletId.trim()),
                    depositCoin,
                ],
            });
            const execution = await signAndExecuteTransaction({ transaction: tx });
            const digest = getDigestFromResult(execution);
            if (!digest) throw new Error('Deposit returned no digest.');
            setLastDepositDigest(digest);
            await suiClient.waitForTransaction({ digest });
            setDepositStatus('Deposit transaction finalized.');
            await refreshWalletBalance();
            await refreshCoins();
        } catch (error) {
            setDepositStatus(`Error: ${getErrorMessage(error)}`);
        }
    };

    return (
        <main className="min-h-screen bg-[#f6f8f7] text-slate-950">
            <header className="border-b border-slate-200 bg-white">
                <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4">
                    <div className="flex items-center gap-3">
                        <Image src="/safeflow-logo-128.png" alt="SafeFlow" width={40} height={40} className="h-10 w-10 rounded-md" priority />
                        <div>
                            <h1 className="text-lg font-semibold tracking-normal">SafeFlow Admin</h1>
                            <p className="text-xs text-slate-500">Guarded wallet funding for sponsored AgentPay checkout</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <Link className="secondary-button hidden sm:inline-flex" href="/">Console</Link>
                        <ConnectButton />
                    </div>
                </div>
            </header>

            <section className="mx-auto grid max-w-7xl gap-5 px-5 py-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.1fr)_minmax(0,0.95fr)]">
                <Panel icon={<ShieldCheck className="h-5 w-5" />} title="Demo Binding" description="Create the guarded wallet objects used by sponsored_guard checkout and seed_demo.">
                    <Field label="Package ID">
                        <input className="input font-mono text-xs" value={packageId} onChange={(event) => setPackageId(event.target.value)} />
                    </Field>
                    <Field label="Coin type">
                        <textarea className="input min-h-20 resize-none font-mono text-xs" value={coinType} onChange={(event) => setCoinType(event.target.value)} />
                    </Field>
                    <Field label="Merchant payout address">
                        <input className="input font-mono text-xs" value={payoutAddress} onChange={(event) => setPayoutAddress(event.target.value)} placeholder="0x..." />
                    </Field>
                    <Field label="Agent address">
                        <input className="input font-mono text-xs" value={agentAddress} onChange={(event) => setAgentAddress(event.target.value)} placeholder="0x..." />
                    </Field>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Per-second limit">
                            <input className="input" inputMode="numeric" value={maxSpendPerSecond} onChange={(event) => setMaxSpendPerSecond(event.target.value)} />
                        </Field>
                        <Field label="Total cap">
                            <input className="input" inputMode="numeric" value={maxTotalSpend} onChange={(event) => setMaxTotalSpend(event.target.value)} />
                        </Field>
                    </div>
                    <button className="primary-button" onClick={createWalletAndCap}>
                        <KeyRound className="h-4 w-4" /> Create wallet and cap
                    </button>
                    <StatusBox message={setupStatus} />
                    <ObjectRow label="walletId" value={walletId} onCopy={copy} />
                    <ObjectRow label="sessionCapId" value={sessionCapId} onCopy={copy} />
                    {lastWalletDigest && <ObjectRow label="wallet tx" value={lastWalletDigest} onCopy={copy} />}
                    {lastCapDigest && <ObjectRow label="cap tx" value={lastCapDigest} onCopy={copy} />}
                </Panel>

                <Panel icon={<Coins className="h-5 w-5" />} title="Deposit Test USDC" description="Move a selected Coin<T> into the guarded AgentWallet so sponsored_guard can spend it.">
                    <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                        <Field label="Wallet object">
                            <input className="input font-mono text-xs" value={walletId} onChange={(event) => setWalletId(event.target.value)} placeholder="0x..." />
                        </Field>
                        <button className="secondary-button self-end" onClick={refreshWalletBalance}>
                            <RefreshCw className="h-4 w-4" /> Balance
                        </button>
                    </div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                        <div className="text-xs font-semibold uppercase text-slate-500">Guarded wallet balance</div>
                        <div className="mt-1 font-mono text-sm text-slate-900">
                            {walletBalanceAtomic ? `${formatAtomicAmount(walletBalanceAtomic, 6)} USDC` : 'Not loaded'}
                        </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                        <Field label="Owned coin object">
                            <select className="input" value={selectedCoinId} onChange={(event) => setSelectedCoinId(event.target.value)}>
                                <option value="">Select coin object</option>
                                {coins.map((coin) => (
                                    <option key={coin.coinObjectId} value={coin.coinObjectId}>
                                        {shortObjectId(coin.coinObjectId)} - {formatAtomicAmount(coin.balance, 6)} USDC
                                    </option>
                                ))}
                            </select>
                        </Field>
                        <button className="secondary-button self-end" onClick={refreshCoins}>
                            <RefreshCw className="h-4 w-4" /> Coins
                        </button>
                    </div>
                    <Field label="Deposit amount atomic">
                        <input className="input" inputMode="numeric" value={depositAmountAtomic} onChange={(event) => setDepositAmountAtomic(event.target.value)} />
                    </Field>
                    <div className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-600">
                        <div className="flex items-center justify-between gap-3">
                            <span>Deposit preview</span>
                            <span className="font-mono text-slate-950">{formatAtomicAmount(depositAmountAtomic, 6)} USDC</span>
                        </div>
                    </div>
                    <button className="primary-button bg-slate-950 hover:bg-slate-800" onClick={depositSelectedCoin}>
                        <BadgeDollarSign className="h-4 w-4" /> Deposit selected coin
                    </button>
                    <StatusBox message={depositStatus} />
                    {lastDepositDigest && <ObjectRow label="deposit tx" value={lastDepositDigest} onCopy={copy} />}
                </Panel>

                <Panel icon={<Database className="h-5 w-5" />} title="Producer Seed" description="Copy these public object bindings into producer_api/.env, then run seed:demo.">
                    <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                        {canSeedProducer ? <CheckCircle2 className="h-4 w-4 text-emerald-700" /> : <WalletCards className="h-4 w-4 text-amber-600" />}
                        <span className="text-slate-700">{canSeedProducer ? 'Seed inputs are complete.' : 'Fill payout, agent, wallet, and SessionCap first.'}</span>
                    </div>
                    <pre className="overflow-x-auto rounded-md border border-slate-200 bg-slate-950 p-4 text-xs leading-6 text-slate-100">{envSnippet}</pre>
                    <button className="secondary-button w-full" onClick={() => copy(envSnippet)}>
                        <Clipboard className="h-4 w-4" /> Copy env snippet
                    </button>
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                        <div className="font-semibold text-slate-900">Then run locally:</div>
                        <code className="mt-2 block rounded bg-white px-3 py-2 font-mono text-xs text-slate-800">cd producer_api && npm run seed:demo</code>
                    </div>
                    <Link className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700" href="/" target="_self">
                        Open merchant checkout <ExternalLink className="h-4 w-4" />
                    </Link>
                </Panel>
            </section>

            <section className="mx-auto max-w-7xl px-5 pb-8">
                <Panel icon={<Terminal className="h-5 w-5" />} title="Agent Runner" description="Run this local process after creating a checkout session so intents move from pending to executed.">
                    <div className="grid gap-3 md:grid-cols-3">
                        <ReadinessItem label="Producer API" value={DEFAULT_PRODUCER_API_BASE_URL} />
                        <ReadinessItem label="Agent address" value={agentAddress || 'Set in Demo Binding'} />
                        <ReadinessItem label="Merchant key" value={DEFAULT_DEMO_MERCHANT_API_KEY ? 'Auto-filled on Console' : 'Paste seed:demo output'} />
                    </div>
                    <pre className="overflow-x-auto rounded-md border border-slate-200 bg-slate-950 p-4 text-xs leading-6 text-slate-100">{agentRunnerCommand}</pre>
                    <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                        <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                            Keep <span className="font-mono text-xs">agent_scripts/.env</span> aligned with Producer API for <span className="font-mono text-xs">PACKAGE_ID</span> and <span className="font-mono text-xs">PRODUCER_SIGNING_SECRET</span>. The agent private key stays local in <span className="font-mono text-xs">agent_scripts/.agent_key.json</span>.
                        </div>
                        <button className="secondary-button self-start" onClick={() => copy(agentRunnerCommand)}>
                            <Clipboard className="h-4 w-4" /> Copy runner command
                        </button>
                    </div>
                </Panel>
            </section>
        </main>
    );
}

function Panel({ icon, title, description, children }: { icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) {
    return (
        <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
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
        <label className="block min-w-0">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-normal text-slate-500">{label}</span>
            {children}
        </label>
    );
}

function StatusBox({ message }: { message: string }) {
    if (!message) return null;
    return <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{message}</div>;
}

function ReadinessItem({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-semibold uppercase text-slate-500">{label}</div>
            <div className="mt-1 truncate font-mono text-xs text-slate-800">{value}</div>
        </div>
    );
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
