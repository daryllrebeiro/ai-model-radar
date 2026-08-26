import type { Metadata } from 'next';
import './globals.css';
import Link from 'next/link';
import { Navbar } from '@/components/navbar';
import { WatchlistProvider } from '@/components/watchlist/watchlist-context';
import { validateEnv } from '@/lib/env';

// Enforce environment validation on server boot
validateEnv();

export const metadata: Metadata = {
  title: 'AI Model Radar — Real-time AI Model Changelog, Price Drops & Arbitrage Engine',
  description:
    'One unified feed of every price drop, free tier addition, new model release, and arbitrage opportunity across OpenRouter, DeepSeek, Anthropic, OpenAI, Meta, and Mistral.',
  openGraph: {
    title: 'AI Model Radar — Real-time AI Model Changelog & Price Intelligence',
    description: 'Track pricing shifts, new releases, and cost arbitrage opportunities in real time.',
    url: 'https://modelradar.ai',
    siteName: 'AI Model Radar',
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AI Model Radar',
    description: 'Real-time AI Model Changelog, Price Drops & Arbitrage Engine',
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'AI Model Radar',
  operatingSystem: 'All',
  applicationCategory: 'DeveloperApplication',
  description: 'Automated intelligence radar for AI model releases, price drops, context upgrades, and pricing arbitrage.',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="bg-[#0B0F17] text-gray-100 min-h-screen flex flex-col antialiased selection:bg-cyan-500 selection:text-black">
        <WatchlistProvider>
          <div className="fixed inset-0 radar-grid-bg pointer-events-none z-0" />
          <Navbar />
          <main className="flex-1 relative z-10">{children}</main>
          <footer className="relative z-10 border-t border-gray-800/80 bg-[#0B0F17]/95 py-6 mt-12 text-xs text-gray-400 font-mono">
            <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
              <p>AI Model Radar &copy; {new Date().getFullYear()} — Powered by OpenRouter, GitHub &amp; Hugging Face.</p>
              <div className="flex items-center gap-4">
                <Link href="/privacy" className="hover:text-cyan-400 transition-colors">Privacy Policy</Link>
                <Link href="/terms" className="hover:text-cyan-400 transition-colors">Terms of Service</Link>
                <Link href="/contact" className="hover:text-cyan-400 transition-colors">Support &amp; Security</Link>
                <Link href="/feed.xml" className="hover:text-amber-400 transition-colors">RSS Feed</Link>
              </div>
            </div>
          </footer>
        </WatchlistProvider>
      </body>
    </html>
  );
}
