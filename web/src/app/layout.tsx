import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
    title: 'SafeFlow Sui - Agent Air-Gap Wallet',
    description: 'Provide rate-limited, safely air-gapped hot wallets for AI agents on Sui.',
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
    children: React.ReactNode;
}) {
    return (
        <html lang="en">
            <body className={inter.className}>
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
