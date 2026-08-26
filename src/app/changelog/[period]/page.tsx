import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getRecentEvents } from '@/lib/db/queries';
import { EventCard } from '@/components/feed/event-card';
import { ArrowLeft, Calendar, Sparkles, TrendingDown, TrendingUp, Maximize2, Trash2, Cpu } from 'lucide-react';

export const dynamic = 'force-dynamic';

interface ChangelogPeriodPageProps {
  params: {
    period: string;
  };
}

export default async function ChangelogPeriodPage({ params }: ChangelogPeriodPageProps) {
  const period = params.period; // e.g. '2026-08'
  if (!/^\d{4}-\d{2}$/.test(period)) {
    notFound();
  }

  const [year, month] = period.split('-');
  const monthName = new Date(parseInt(year), parseInt(month) - 1, 1).toLocaleString('default', {
    month: 'long',
    year: 'numeric',
  });

  const allEvents = await getRecentEvents(200);
  const periodEvents = allEvents.filter((e) => e.detected_at.startsWith(period));

  // Category breakdowns
  const priceDrops = periodEvents.filter(
    (e) => (e.event_type === 'PRICE_CHANGE' && (e.pct_change || 0) < 0) || e.event_type === 'BECAME_FREE'
  );
  const newReleases = periodEvents.filter((e) => e.event_type === 'NEW_MODEL');
  const priceHikes = periodEvents.filter(
    (e) => (e.event_type === 'PRICE_CHANGE' && (e.pct_change || 0) > 0) || e.event_type === 'LEFT_FREE'
  );
  const contextChanges = periodEvents.filter((e) => e.event_type === 'CONTEXT_CHANGED');
  const removals = periodEvents.filter((e) => e.event_type === 'MODEL_REMOVED');

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      {/* Back to Changelog Link */}
      <div>
        <Link
          href="/changelog"
          className="inline-flex items-center gap-2 text-xs font-mono text-gray-400 hover:text-cyan-400 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to All Changelogs</span>
        </Link>
      </div>

      {/* Header */}
      <div className="border-b border-gray-800 pb-6 space-y-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-semibold bg-cyan-950/80 border border-cyan-800/60 text-cyan-300">
          <Calendar className="w-3.5 h-3.5" />
          <span>MONTHLY RECAP REPORT</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          AI Industry Changelog — {monthName}
        </h1>
        <p className="text-sm text-gray-400 max-w-2xl leading-relaxed">
          Full breakdown of model releases, pricing adjustments, context modifications, and deprecations recorded during {monthName}.
        </p>
      </div>

      {/* Metric Highlights Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 rounded-xl border border-gray-800 bg-[#111827]/70 space-y-1">
          <div className="text-[11px] font-mono text-gray-400">NEW MODELS</div>
          <div className="text-2xl font-bold text-cyan-400 flex items-center gap-1.5">
            <Sparkles className="w-5 h-5" />
            {newReleases.length}
          </div>
        </div>

        <div className="p-4 rounded-xl border border-gray-800 bg-[#111827]/70 space-y-1">
          <div className="text-[11px] font-mono text-gray-400">PRICE CUTS</div>
          <div className="text-2xl font-bold text-emerald-400 flex items-center gap-1.5">
            <TrendingDown className="w-5 h-5" />
            {priceDrops.length}
          </div>
        </div>

        <div className="p-4 rounded-xl border border-gray-800 bg-[#111827]/70 space-y-1">
          <div className="text-[11px] font-mono text-gray-400">PRICE INCREASES</div>
          <div className="text-2xl font-bold text-rose-400 flex items-center gap-1.5">
            <TrendingUp className="w-5 h-5" />
            {priceHikes.length}
          </div>
        </div>

        <div className="p-4 rounded-xl border border-gray-800 bg-[#111827]/70 space-y-1">
          <div className="text-[11px] font-mono text-gray-400">CONTEXT EXPANSIONS</div>
          <div className="text-2xl font-bold text-amber-400 flex items-center gap-1.5">
            <Maximize2 className="w-5 h-5" />
            {contextChanges.length}
          </div>
        </div>
      </div>

      {/* Section 1: New Models */}
      {newReleases.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <span>New Frontier & Open Weight Models ({newReleases.length})</span>
          </h2>
          <div className="space-y-3">
            {newReleases.map((e, idx) => (
              <EventCard key={e.id || idx} event={e} />
            ))}
          </div>
        </section>
      )}

      {/* Section 2: Price Cuts */}
      {priceDrops.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-emerald-400" />
            <span>Price Cuts & Free Tier Arrivals ({priceDrops.length})</span>
          </h2>
          <div className="space-y-3">
            {priceDrops.map((e, idx) => (
              <EventCard key={e.id || idx} event={e} />
            ))}
          </div>
        </section>
      )}

      {/* Section 3: Price Hikes & Other Events */}
      {(priceHikes.length > 0 || contextChanges.length > 0 || removals.length > 0) && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-amber-400" />
            <span>Context Expansions, Adjustments & Deprecations</span>
          </h2>
          <div className="space-y-3">
            {[...priceHikes, ...contextChanges, ...removals].map((e, idx) => (
              <EventCard key={e.id || idx} event={e} />
            ))}
          </div>
        </section>
      )}

      {periodEvents.length === 0 && (
        <div className="p-12 text-center rounded-2xl border border-gray-800 bg-[#111827]/40 text-gray-400 text-sm">
          No historical market events recorded for {monthName} in the live snapshot ledger.
        </div>
      )}
    </div>
  );
}
