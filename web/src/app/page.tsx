'use client';

import { ConnectButton, useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { useState } from 'react';

const SUI_COIN_TYPE = '0x2::sui::SUI';
const CLOCK_OBJECT_ID = '0x6';
const DEFAULT_MAX_SPEND_PER_SECOND = 1_000_000;
const DEFAULT_MAX_TOTAL_SPEND = 5_000_000_000;
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function getDigestFromResult(result: unknown): string | null {
    if (!isRecord(result)) {
        return null;
    }

    const digest = result.digest;
    return typeof digest === 'string' ? digest : null;
}

function extractIdFromEvents(events: Array<{ type: string; parsedJson: unknown }>, eventName: string, fieldName: string): string | null {
    for (const event of events) {
        if (!event.type.endsWith(`::wallet::${eventName}`)) {
            continue;
        }

        if (!isRecord(event.parsedJson)) {
            continue;
        }

        const value = event.parsedJson[fieldName];
        if (typeof value === 'string') {
            return value;
        }
    }

    return null;
}

export default function Home() {
    const currentAccount = useCurrentAccount();
    const suiClient = useSuiClient();
    const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction();

    const [agentAddress, setAgentAddress] = useState('');
    const [status, setStatus] = useState('');
    const [walletId, setWalletId] = useState('');
    const [sessionCapId, setSessionCapId] = useState('');

    const handleCreateWalletAndCap = async () => {
        if (!currentAccount) {
            setStatus('Please connect your wallet first.');
            return;
        }

        if (!agentAddress) {
            setStatus('Please enter the Agent Address.');
            return;
        }

        const packageId = process.env.NEXT_PUBLIC_PACKAGE_ID;
        if (!packageId) {
            setStatus('Missing NEXT_PUBLIC_PACKAGE_ID. Please set it to your deployed package id.');
            return;
        }

        try {
            setWalletId('');
            setSessionCapId('');

            setStatus('1/2 Creating wallet...');
            const createWalletTx = new Transaction();
            createWalletTx.moveCall({
                target: `${packageId}::wallet::create_wallet`,
                typeArguments: [SUI_COIN_TYPE],
                arguments: [],
            });

            const walletExecution = await signAndExecuteTransaction({
                transaction: createWalletTx,
            });
            const walletDigest = getDigestFromResult(walletExecution);
            if (!walletDigest) {
                throw new Error('Wallet transaction completed but no digest returned.');
            }

            const walletTx = await suiClient.waitForTransaction({
                digest: walletDigest,
                options: { showEvents: true },
            });
            const walletEvents = walletTx.events ?? [];
            const createdWalletId = extractIdFromEvents(walletEvents, 'WalletCreated', 'wallet_id');
            if (!createdWalletId) {
                throw new Error('Wallet created but wallet_id was not found in events.');
            }
            setWalletId(createdWalletId);

            setStatus('2/2 Creating SessionCap...');
            const expiresAtMs = Date.now() + DEFAULT_SESSION_TTL_MS;
            const createCapTx = new Transaction();
            createCapTx.moveCall({
                target: `${packageId}::wallet::create_session_cap`,
                typeArguments: [SUI_COIN_TYPE],
                arguments: [
                    createCapTx.object(createdWalletId),
                    createCapTx.pure.address(agentAddress),
                    createCapTx.pure.u64(DEFAULT_MAX_SPEND_PER_SECOND),
                    createCapTx.pure.u64(DEFAULT_MAX_TOTAL_SPEND),
                    createCapTx.pure.u64(expiresAtMs),
                    createCapTx.object(CLOCK_OBJECT_ID),
                ],
            });

            const capExecution = await signAndExecuteTransaction({
                transaction: createCapTx,
            });
            const capDigest = getDigestFromResult(capExecution);
            if (!capDigest) {
                throw new Error('SessionCap transaction completed but no digest returned.');
            }

            const capTx = await suiClient.waitForTransaction({
                digest: capDigest,
                options: { showEvents: true },
            });
            const capEvents = capTx.events ?? [];
            const createdSessionCapId = extractIdFromEvents(capEvents, 'SessionCapCreated', 'cap_id');
            if (!createdSessionCapId) {
                throw new Error('SessionCap created but cap_id was not found in events.');
            }

            setSessionCapId(createdSessionCapId);
            setStatus(`Done. walletId=${createdWalletId}, sessionCapId=${createdSessionCapId}`);
        } catch (e: unknown) {
            setStatus(`Error: ${getErrorMessage(e)}`);
        }
    };

    return (
        <main className="flex min-h-screen flex-col items-center p-24 bg-zinc-50">
            <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm">
                <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm mb-8">
                    <h1 className="text-2xl font-bold text-zinc-800">TickPay <span className="text-blue-500">Agent Air-Gap</span></h1>
                    <ConnectButton />
                </div>

                <div className="bg-white p-8 rounded-xl shadow-sm border border-zinc-100 mb-8">
                    <h2 className="text-xl font-semibold mb-4 text-zinc-800">Human Dashboard</h2>
                    <p className="text-zinc-600 mb-6">
                        Deposit funds and provision a rate-limited SessionCap for your OpenClaw Agent. The agent can stream payments safely without exposing your main wallet.
                    </p>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-zinc-700 mb-1">OpenClaw Agent Address</label>
                            <input
                                type="text"
                                value={agentAddress}
                                onChange={(e) => setAgentAddress(e.target.value)}
                                className="w-full p-2 border border-zinc-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-black"
                                placeholder="0x..."
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-zinc-700 mb-1">Max Spend per Second (MIST)</label>
                                <input type="number" defaultValue={1000000} className="w-full p-2 border border-zinc-300 rounded-md shadow-sm bg-zinc-50 text-black" readOnly />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-zinc-700 mb-1">Max Total Spend (MIST)</label>
                                <input type="number" defaultValue={5000000000} className="w-full p-2 border border-zinc-300 rounded-md shadow-sm bg-zinc-50 text-black" readOnly />
                            </div>
                        </div>

                        <button
                            onClick={handleCreateWalletAndCap}
                            className="mt-4 w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md transition-colors"
                        >
                            Provision Agent Allowance
                        </button>
                    </div>

                    {status && (
                        <div className="mt-4 p-3 bg-zinc-100 rounded-md text-sm font-mono text-zinc-800">
                            {status}
                        </div>
                    )}
                    {walletId && (
                        <div className="mt-3 p-3 bg-zinc-100 rounded-md text-xs font-mono text-zinc-800 break-all">
                            walletId: {walletId}
                        </div>
                    )}
                    {sessionCapId && (
                        <div className="mt-3 p-3 bg-zinc-100 rounded-md text-xs font-mono text-zinc-800 break-all">
                            sessionCapId: {sessionCapId}
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-2 gap-8">
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-zinc-100">
                        <h3 className="font-semibold text-lg mb-2 text-zinc-800">1. Rate-Limited</h3>
                        <p className="text-sm text-zinc-600">The agent cannot spend faster than the limit you set, stopping malicious prompt injections from draining funds.</p>
                    </div>
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-zinc-100">
                        <h3 className="font-semibold text-lg mb-2 text-zinc-800">2. Auditable via Walrus</h3>
                        <p className="text-sm text-zinc-600">The agent must provide a cryptographic proof of its reasoning via Walrus blob ID to spend.</p>
                    </div>
                </div>
            </div>
        </main>
    );
}
