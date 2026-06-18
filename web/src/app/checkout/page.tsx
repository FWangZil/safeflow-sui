'use client';

import { ArrowLeft, CheckCircle2, Clock3, ExternalLink, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';

const PRODUCER_API_BASE_URL = process.env.NEXT_PUBLIC_PRODUCER_API_BASE_URL || 'http://localhost:8787';

interface CheckoutSessionView {
    sessionId: string;
    merchantOrderId: string;
    status: string;
    recipient: string;
    amountAtomic: number;
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

function formatAmount(amountAtomic: number): string {
    return (amountAtomic / 1_000_000).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
    });
}

function short(value: string): string {
    return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-8)}` : value;
}

function formatRail(rail: 'sponsored_guard' | 'native_gasless'): string {
    return rail === 'native_gasless' ? 'Native gasless stablecoin' : 'Sponsored AgentPay Guard';
}

function CheckoutStatus() {
    const searchParams = useSearchParams();
    const sessionId = searchParams.get('sessionId') ?? searchParams.get('id') ?? '';
    const [session, setSession] = useState<CheckoutSessionView | null>(null);
    const [status, setStatus] = useState(sessionId ? 'Loading checkout session...' : 'Missing checkout session id.');

    const terminal = useMemo(() => ['executed', 'failed', 'expired', 'cancelled'].includes(session?.status ?? ''), [session?.status]);

    useEffect(() => {
        if (!sessionId) return;

        let cancelled = false;
        const load = async () => {
            try {
                const response = await fetch(`${PRODUCER_API_BASE_URL.replace(/\/+$/, '')}/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
                const payload = await response.json();
                if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
                if (!cancelled) {
                    setSession(payload.session);
                    setStatus('Session loaded.');
                }
            } catch (error) {
                if (!cancelled) setStatus(error instanceof Error ? error.message : String(error));
            }
        };
        load();
        const id = window.setInterval(load, 3000);
        return () => {
            cancelled = true;
            window.clearInterval(id);
        };
    }, [sessionId]);

    const icon = session?.status === 'executed'
        ? <CheckCircle2 className="h-10 w-10 text-emerald-600" />
        : session?.status === 'failed' || session?.status === 'expired'
            ? <XCircle className="h-10 w-10 text-red-600" />
            : <Clock3 className="h-10 w-10 text-amber-600" />;

    return (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-start gap-4">
                <div className="grid h-14 w-14 place-items-center rounded-md bg-slate-50">{icon}</div>
                <div>
                    <h1 className="text-2xl font-semibold tracking-normal">SafeFlow Checkout</h1>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                        This payment is executed by an authorized AI agent under a SessionCap. The sponsor pays agent gas after the intent is claimed.
                    </p>
                </div>
            </div>

            {session ? (
                <div className="mt-6 space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4">
                    <Row label="Order" value={session.merchantOrderId} />
                    <Row label="Status" value={session.status} />
                    <Row label="Rail" value={formatRail(session.executionRail)} />
                    <Row label="Amount" value={`${formatAmount(session.amountAtomic)} ${session.currencySymbol}`} />
                    {session.requiresSponsor && <Row label="Sponsor fee" value={`${formatAmount(session.sponsorFeeAtomic ?? 0)} ${session.currencySymbol}`} />}
                    <Row label="Recipient" value={short(session.recipient)} />
                    {session.txDigest && <Row label="Tx digest" value={short(session.txDigest)} />}
                    {session.walrusBlobId && <Row label="Evidence" value={short(session.walrusBlobId)} />}
                    {session.errorMessage && <Row label="Error" value={session.errorMessage} />}
                </div>
            ) : (
                <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">{status}</div>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
                <button
                    onClick={() => window.location.reload()}
                    className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                    Refresh status
                </button>
                {session?.txDigest && (
                    <a
                        href={`https://suiexplorer.com/txblock/${session.txDigest}?network=testnet`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                        Sui Explorer <ExternalLink className="h-4 w-4" />
                    </a>
                )}
            </div>

            {!terminal && sessionId && (
                <p className="mt-4 text-xs text-slate-500">Waiting for agent execution. This page polls every 3 seconds.</p>
            )}
        </section>
    );
}

export default function CheckoutPage() {
    return (
        <main className="min-h-screen bg-[#f6f8f7] px-5 py-8 text-slate-950">
            <div className="mx-auto max-w-2xl">
                <Link href="/" className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-950">
                    <ArrowLeft className="h-4 w-4" /> Demo console
                </Link>
                <Suspense fallback={<div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">Loading checkout session...</div>}>
                    <CheckoutStatus />
                </Suspense>
            </div>
        </main>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-slate-500">{label}</span>
            <span className="min-w-0 truncate font-mono text-xs text-slate-900">{value}</span>
        </div>
    );
}
