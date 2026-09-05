import React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getEvents, getMarketStats } from '@/lib/db/queries';
import { MarketStatsBanner } from '@/components/market-stats-banner';
import { EventFeed } from '@/components/feed/event-feed';
import { Radio, Zap, Scale, ArrowRight, Check } from 'lucide-react';
import { isBillingEnabled } from '@/lib/feature-flags';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AI Model Radar — Real-time AI Model Price Drops, Releases & Arbitrage',
  description:
    'Live, automated changelog of AI model prices, free-tier releases, context-length upgrades, and cross-provider arbitrage opportunities across all major labs.',
  alternates: { canonical: '/' },
};

export default async function HomePage() {
  const [eventsData, stats] = await Promise.all([
    getEvents({ limit: 200 }),
    getMarketStats(),
  ]);

  const billingEnabled = isBillingEnabled();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-3xl border border-gray-800/80 bg-gradient-to-b from-[#111827]/90 via-[#0B0F17] to-[#0B0F17] p-6 sm:p-10">
        <div className="max-w-3xl space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/70 border border-cyan-700/60 text-cyan-400 text-xs font-mono">
            <Radio className="w-3.5 h-3.5 animate-pulse" />
            <span>REAL-TIME INTELLIGENCE &amp; ARBITRAGE RADAR</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight">
            Track AI Model Price Drops, New Releases &amp; Arbitrage
          </h1>

          <p className="text-sm sm:text-base text-gray-300 leading-relaxed">
            The automated, append-only changelog engine for LLMs. Continuously scanning OpenRouter, DeepSeek, Anthropic, OpenAI, Meta, and Mistral for price shifts, context expansion, and zero-cost inference endpoints.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              href="/arbitrage"
              className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold uppercase tracking-wider transition-all flex items-center gap-2"
            >
              <Scale className="w-4 h-4" />
              <span>Explore Price Arbitrage</span>
            </Link>
            <Link
              href="/advisor"
              className="px-4 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold uppercase tracking-wider transition-all border border-gray-700 flex items-center gap-2"
            >
              <Zap className="w-4 h-4 text-amber-400" />
              <span>Cost Optimizer</span>
            </Link>
            <Link
              href="/docs"
              className="px-4 py-2.5 rounded-xl bg-gray-900/80 hover:bg-gray-800 text-cyan-400 text-xs font-mono transition-all border border-gray-800 flex items-center gap-2"
            >
              <span>API v1 Reference</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>

      {/* Market Stats Ticker */}
      <MarketStatsBanner stats={stats} />

      {/* Live Activity Feed */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-800 pb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-white tracking-wide">Live Model Intelligence Changelog</h2>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-950/80 border border-emerald-700/60 text-emerald-400">
              APPEND-ONLY
            </span>
          </div>
          <Link
            href="/feed.xml"
            className="text-xs font-mono text-amber-400 hover:text-amber-300 flex items-center gap-1"
          >
            <span>Subscribe via RSS</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <EventFeed initialEvents={eventsData.events} />
      </section>

      {/* Subscription & Pricing Tiers Banner */}
      <section className="pt-6 border-t border-gray-800 space-y-6">
        <div className="text-center max-w-2xl mx-auto space-y-2">
          <h2 className="text-2xl font-extrabold text-white">
            {billingEnabled ? 'Developer & Enterprise Tiers' : 'Open Developer Access'}
          </h2>
          <p className="text-xs text-gray-400">
            {billingEnabled
              ? 'Scale from free community access to real-time webhook automation, high-concurrency API quotas, and daily digests.'
              : 'Free, open API access and real-time LLM intelligence feeds for the AI engineering community.'}
          </p>
        </div>

        <div className={`grid grid-cols-1 ${billingEnabled ? 'md:grid-cols-3' : 'max-w-md mx-auto'} gap-6`}>
          {/* Free Tier */}
          <div className="p-6 rounded-2xl border border-gray-800 bg-[#111827]/60 space-y-4">
            <div>
              <span className="text-xs font-mono text-cyan-400 uppercase font-semibold">Community</span>
              <h3 className="text-xl font-bold text-white mt-1">Free</h3>
              <p className="text-2xl font-extrabold text-white mt-2">$0 <span className="text-xs text-gray-400 font-normal">/ mo</span></p>
            </div>
            <ul className="space-y-2 text-xs text-gray-300 font-mono">
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> 60 API requests / min</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Public intelligence feed</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> RSS Feed &amp; JSON endpoints</li>
            </ul>
            <Link
              href="/docs"
              className="block w-full py-2 text-center rounded-lg bg-gray-800 hover:bg-gray-700 text-xs font-semibold text-white uppercase transition-colors"
            >
              Get Free Key
            </Link>
          </div>

          {/* Paid Tiers only rendered when billing is enabled */}
          {billingEnabled && (
            <>
              {/* Developer Tier */}
              <div className="p-6 rounded-2xl border-2 border-cyan-500 bg-[#111827] space-y-4 relative shadow-lg shadow-cyan-950/50">
                <span className="absolute -top-3 right-4 px-2.5 py-0.5 rounded-full bg-cyan-500 text-[#0B0F17] text-[10px] font-bold uppercase tracking-wider">
                  Popular
                </span>
                <div>
                  <span className="text-xs font-mono text-cyan-400 uppercase font-semibold">Pro Engineer</span>
                  <h3 className="text-xl font-bold text-white mt-1">Developer</h3>
                  <p className="text-2xl font-extrabold text-white mt-2">$29 <span className="text-xs text-gray-400 font-normal">/ mo</span></p>
                </div>
                <ul className="space-y-2 text-xs text-gray-300 font-mono">
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-cyan-400" /> 300 API requests / min</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-cyan-400" /> Instant Webhook Notifications</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-cyan-400" /> Daily Email Digest via Resend</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-cyan-400" /> Arbitrage Opportunity API</li>
                </ul>
                <Link
                  href="/alerts"
                  className="block w-full py-2 text-center rounded-lg bg-cyan-600 hover:bg-cyan-500 text-xs font-semibold text-white uppercase tracking-wider transition-colors"
                >
                  Upgrade to Developer
                </Link>
              </div>

              {/* Enterprise Tier */}
              <div className="p-6 rounded-2xl border border-gray-800 bg-[#111827]/60 space-y-4">
                <div>
                  <span className="text-xs font-mono text-purple-400 uppercase font-semibold">Organization</span>
                  <h3 className="text-xl font-bold text-white mt-1">Enterprise</h3>
                  <p className="text-2xl font-extrabold text-white mt-2">$99 <span className="text-xs text-gray-400 font-normal">/ mo</span></p>
                </div>
                <ul className="space-y-2 text-xs text-gray-300 font-mono">
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-purple-400" /> 1,200 API requests / min</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-purple-400" /> Unlimited Webhook Endpoints</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-purple-400" /> Priority SLA &amp; Dedicated Support</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-purple-400" /> Multi-seat Watchlists</li>
                </ul>
                <Link
                  href="/contact"
                  className="block w-full py-2 text-center rounded-lg bg-gray-800 hover:bg-gray-700 text-xs font-semibold text-white uppercase transition-colors"
                >
                  Contact Sales
                </Link>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
