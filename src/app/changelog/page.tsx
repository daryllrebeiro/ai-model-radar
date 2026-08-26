import React from 'react';
import Link from 'next/link';
import { getRecentEvents } from '@/lib/db/queries';
import { Calendar, Sparkles, TrendingDown, ArrowRight, Rss, Layers } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function ChangelogIndexPage() {
  const events = await getRecentEvents(100);

  // Group events by YYYY-MM
  const monthGroups = new Map<string, typeof events>();
  for (const e of events) {
    const month = e.detected_at.slice(0, 7); // '2026-08'
    const group = monthGroups.get(month) || [];
    group.push(e);
    monthGroups.set(month, group);
  }

  // Ensure current month is present
  const currentMonth = new Date().toISOString().slice(0, 7);
  if (!monthGroups.has(currentMonth)) {
    monthGroups.set(currentMonth, []);
  }

  const sortedMonths = Array.from(monthGroups.keys()).sort().reverse();

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      {/* Header */}
      <div className="border-b border-gray-800 pb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-semibold bg-cyan-950/80 border border-cyan-800/60 text-cyan-300">
            <Calendar className="w-3.5 h-3.5" />
            <span>PUBLIC MARKET CHANGELOG</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            AI Model Industry Changelog
          </h1>
          <p className="text-sm text-gray-400 max-w-2xl leading-relaxed">
            Monthly executive summaries of frontier model releases, open-weight deployments, provider price wars, and API context updates.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <a
            href="/api/feed/json"
            target="_blank"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-800 bg-gray-900/80 hover:bg-gray-800 text-xs font-mono text-gray-300 transition-colors"
          >
            <Rss className="w-3.5 h-3.5 text-amber-400" />
            <span>JSON Feed</span>
          </a>
        </div>
      </div>

      {/* Monthly Summary Cards */}
      <div className="space-y-4">
        {sortedMonths.map((period) => {
          const monthEvents = monthGroups.get(period) || [];
          const priceDrops = monthEvents.filter(
            (e) => (e.event_type === 'PRICE_CHANGE' && (e.pct_change || 0) < 0) || e.event_type === 'BECAME_FREE'
          );
          const newModels = monthEvents.filter((e) => e.event_type === 'NEW_MODEL');
          const [year, month] = period.split('-');
          const monthName = new Date(parseInt(year), parseInt(month) - 1, 1).toLocaleString('default', {
            month: 'long',
            year: 'numeric',
          });

          return (
            <Link
              key={period}
              href={`/changelog/${period}`}
              className="group block p-6 rounded-2xl border border-gray-800 bg-[#111827]/70 hover:bg-gray-800/50 hover:border-gray-700 transition-all duration-200"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-white group-hover:text-cyan-400 transition-colors">
                      {monthName}
                    </span>
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-gray-900 border border-gray-800 text-gray-400">
                      {period}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-gray-400">
                    <span className="flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                      <strong className="text-white">{newModels.length}</strong> new models
                    </span>
                    <span className="flex items-center gap-1">
                      <TrendingDown className="w-3.5 h-3.5 text-emerald-400" />
                      <strong className="text-white">{priceDrops.length}</strong> price cuts
                    </span>
                    <span className="flex items-center gap-1">
                      <Layers className="w-3.5 h-3.5 text-amber-400" />
                      <strong className="text-white">{monthEvents.length}</strong> total updates
                    </span>
                  </div>
                </div>

                <div className="inline-flex items-center gap-1.5 text-xs font-mono font-semibold text-cyan-400 group-hover:translate-x-1 transition-transform self-end sm:self-center">
                  <span>View Monthly Report</span>
                  <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
