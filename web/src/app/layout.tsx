import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
    metadataBase: new URL(appUrl),
    title: 'SafeFlow Sui - Gasless Agent Checkout',
    description: 'A Sui checkout demo where AI agents spend stablecoins under SessionCap limits and sponsors pay execution gas.',
    icons: {
        icon: [
            { url: '/safeflow-logo-128.png', sizes: '128x128', type: 'image/png' },
            { url: '/safeflow-logo-256.png', sizes: '256x256', type: 'image/png' },
        ],
        shortcut: '/safeflow-logo-128.png',
        apple: '/safeflow-logo-256.png',
    },
    openGraph: {
        title: 'SafeFlow Sui - Agent Air-Gap Wallet',
        description: 'Provide rate-limited, safely air-gapped hot wallets for AI agents on Sui.',
        images: [
            {
                url: '/safeflow-logo-1024.png',
                width: 1024,
                height: 1024,
                alt: 'SafeFlow logo',
            },
        ],
    },
    twitter: {
        card: 'summary_large_image',
        title: 'SafeFlow Sui - Agent Air-Gap Wallet',
        description: 'Provide rate-limited, safely air-gapped hot wallets for AI agents on Sui.',
        images: ['/safeflow-logo-1024.png'],
    },
};

export default function RootLayout({
    children,
}: {
    children: ReactNode;
}) {
    return (
        <html lang="en">
            <body>
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
