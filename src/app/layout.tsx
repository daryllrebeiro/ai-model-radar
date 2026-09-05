import type { Metadata } from 'next';
import './globals.css';
import Link from 'next/link';
import { Navbar } from '@/components/navbar';
import { WatchlistProvider } from '@/components/watchlist/watchlist-context';
import { CompareProvider } from '@/components/compare/compare-context';
import { FloatingCompareBar } from '@/components/compare/floating-compare-bar';
import { validateEnv, baseUrl } from '@/lib/env';

// Enforce environment validation on server boot
validateEnv();

const siteUrl = baseUrl();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'AI Model Radar — Real-time AI Model Changelog, Price Drops & Arbitrage Engine',
    template: '%s — AI Model Radar',
  },
  description:
    'One unified feed of every price drop, free tier addition, new model release, and arbitrage opportunity across OpenRouter, DeepSeek, Anthropic, OpenAI, Meta, and Mistral.',
  alternates: {
    canonical: '/',
    types: {
      'application/rss+xml': '/feed.xml',
      'application/feed+json': '/api/feed/json',
    },
  },
  openGraph: {
    title: 'AI Model Radar — Real-time AI Model Changelog & Price Intelligence',
    description: 'Track pricing shifts, new releases, and cost arbitrage opportunities in real time.',
    url: siteUrl,
    siteName: 'AI Model Radar',
    locale: 'en_US',
    type: 'website',
    images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'AI Model Radar' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AI Model Radar',
    description: 'Real-time AI Model Changelog, Price Drops & Arbitrage Engine',
    images: ['/opengraph-image'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
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
          <CompareProvider>
            <div className="fixed inset-0 radar-grid-bg pointer-events-none z-0" />
            <Navbar />
            <main className="flex-1 relative z-10">{children}</main>
            <FloatingCompareBar />
            <footer className="relative z-10 border-t border-gray-800/80 bg-[#0B0F17]/95 py-6 mt-12 text-xs text-gray-400 font-mono">
              <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                <p>AI Model Radar &copy; {new Date().getFullYear()} — Powered by OpenRouter, GitHub &amp; Hugging Face.</p>
                <div className="flex items-center gap-4">
                  <Link href="/compare" className="hover:text-cyan-400 transition-colors">Compare</Link>
                  <Link href="/pricing" className="hover:text-cyan-400 transition-colors">Pricing</Link>
                  <Link href="/privacy" className="hover:text-cyan-400 transition-colors">Privacy Policy</Link>
                  <Link href="/terms" className="hover:text-cyan-400 transition-colors">Terms of Service</Link>
                  <Link href="/contact" className="hover:text-cyan-400 transition-colors">Support &amp; Security</Link>
                  <Link href="/feed.xml" className="hover:text-amber-400 transition-colors">RSS Feed</Link>
                </div>
              </div>
            </footer>
          </CompareProvider>
        </WatchlistProvider>
      </body>
    </html>
  );
}
