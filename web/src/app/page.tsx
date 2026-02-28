'use client';

import { ConnectButton, useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { useState } from 'react';

export default function Home() {
    const currentAccount = useCurrentAccount();
    const suiClient = useSuiClient();
    const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction();

    const [agentAddress, setAgentAddress] = useState('');
    const [status, setStatus] = useState('');

    const handleCreateWalletAndCap = async () => {
        if (!currentAccount) {
            setStatus('Please connect your wallet first.');
            return;
        }

        if (!agentAddress) {
            setStatus('Please enter the Agent Address.');
            return;
        }

        try {
            setStatus('Creating Wallet and SessionCap...');
            const tx = new Transaction();

            // Note: In a real deployment, replace this with the actual package ID
            const PACKAGE_ID = process.env.NEXT_PUBLIC_PACKAGE_ID || '0x_YOUR_PACKAGE_ID';
            const SUI_COIN_TYPE = '0x2::sui::SUI';

            setStatus('For the demo, this is a placeholder UI for the human dashboard. See Move contract logic.');

        } catch (e: any) {
            setStatus(`Error: ${e.message}`);
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
