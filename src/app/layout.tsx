import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import LiveDataBootstrap from '@/components/shared/LiveDataBootstrap';
import '@/lib/env';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'HybridTurtle Trading System v6.0',
  description: 'Systematic trading management platform — rules-based, emotionally-disciplined weekly trading workflow',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} antialiased min-h-screen bg-background`}>
        <LiveDataBootstrap />
        {children}
      </body>
    </html>
  );
}
