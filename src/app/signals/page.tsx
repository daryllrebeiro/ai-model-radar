import React from 'react';
import { getLatestSnapshotsMap, getEvents } from '@/lib/db/queries';
import { detectMarketSignals } from '@/lib/signals';
import { Radio, AlertTriangle, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { formatRelativeTime } from '@/lib/utils';
import { WatchButton } from '@/components/watchlist/watch-button';

export const dynamic = 'force-dynamic';

export default async function SignalsPage() {
  const [snapshotsMap, eventsRes] = await Promise.all([
    getLatestSnapshotsMap(),
    getEvents({ limit: 500 }),
  ]);

  const snapshots = Array.from(snapshotsMap.values());
  const signals = detectMarketSignals(snapshots, eventsRes.events);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="border-b border-gray-800 pb-6">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-rose-950/60 border border-rose-800/50 text-rose-400 text-xs font-mono mb-2">
          <Radio className="w-3.5 h-3.5 animate-pulse" />
          <span>MARKET ANOMALIES &amp; EVIDENCE SIGNALS</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          Stealth Signals &amp; Pricing Anomalies
        </h1>
        <p className="mt-1.5 text-sm sm:text-base text-gray-400 max-w-2xl">
          Automated statistical anomaly detection comparing current token pricing, router endpoints, and context windows against 30-day market baselines.
        </p>
      </div>

      {/* Summary Strip */}
      {signals.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-4 rounded-xl border border-rose-500/20 bg-rose-950/10">
            <div className="text-xs font-mono text-rose-400 uppercase">Active Signals</div>
            <div className="text-2xl font-bold font-mono text-white mt-1">{signals.length}</div>
          </div>
          <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-950/10">
            <div className="text-xs font-mono text-amber-400 uppercase">High Severity</div>
            <div className="text-2xl font-bold font-mono text-white mt-1">
              {signals.filter((s) => s.severity === 'high').length}
            </div>
          </div>
          <div className="p-4 rounded-xl border border-cyan-500/20 bg-cyan-950/10">
            <div className="text-xs font-mono text-cyan-400 uppercase">Max Confidence</div>
            <div className="text-2xl font-bold font-mono text-white mt-1">
              {Math.max(...signals.map((s) => s.strength || 0))}
              <span className="text-sm text-gray-400">/100</span>
            </div>
          </div>
        </div>
      )}

      {/* Signals List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {[...signals]
          .sort((a, b) => (b.strength || 0) - (a.strength || 0))
          .map((sig) => (
          <div
            key={sig.id}
            className="group rounded-2xl border border-gray-800 bg-[#111827]/80 p-6 hover:border-gray-700 transition-all flex flex-col justify-between space-y-4"
          >
            <div>
              {/* Badge & Severity */}
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-mono font-bold text-rose-400 bg-rose-950/80 px-2.5 py-0.5 rounded border border-rose-500/30 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {sig.signal_type.replace(/_/g, ' ')}
                </span>
                <span className="text-xs font-mono text-gray-400">
                  {formatRelativeTime(sig.detected_at)}
                </span>
              </div>

              {/* Title & Model */}
              <h3 className="text-lg font-bold text-white group-hover:text-rose-300 transition-colors tracking-tight">
                {sig.title}
              </h3>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs font-mono text-cyan-400 bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-800">
                  {sig.provider}
                </span>
                <span className="text-xs font-mono text-gray-400 truncate">
                  {sig.model_id}
                </span>
              </div>

              {/* Strength Score (Enhanced) */}
              {sig.strength !== undefined && (
                <div className="mt-3 flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        sig.strength >= 70 ? 'bg-rose-500' : sig.strength >= 40 ? 'bg-amber-500' : 'bg-cyan-500'
                      }`}
                      style={{ width: `${sig.strength}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-mono font-bold text-gray-300">
                    Strength {sig.strength}/100
                  </span>
                </div>
              )}

              <p className="text-xs sm:text-sm text-gray-300 mt-3">
                {sig.summary}
              </p>

              {/* Baseline Evidence Box */}
              <div className="mt-4 p-3.5 rounded-xl border border-gray-800 bg-gray-950/70 font-mono text-xs space-y-1.5">
                <span className="text-[10px] text-gray-400 uppercase tracking-wider font-bold block">
                  Statistical Evidence ({sig.evidence.metric})
                </span>
                <div className="flex justify-between text-gray-300">
                  <span>Current:</span>
                  <span className="font-bold text-white">{sig.evidence.current_value}</span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span>Baseline:</span>
                  <span>{sig.evidence.baseline_value}</span>
                </div>
                <div className="flex justify-between text-emerald-400 font-bold pt-1 border-t border-gray-900">
                  <span>Deviation:</span>
                  <span>{sig.evidence.deviation}</span>
                </div>
              </div>

              {/* Strength Factor Breakdown (Enhanced) */}
              {sig.strength_factors && sig.strength_factors.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {sig.strength_factors.map((f) => (
                    <span
                      key={f}
                      className="text-[10px] font-mono text-gray-400 bg-gray-900 border border-gray-800 px-1.5 py-0.5 rounded"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Action footer */}
            <div className="pt-3 border-t border-gray-800/80 flex items-center justify-between">
              <WatchButton modelId={sig.model_id} />
              <Link
                href={`/models/${encodeURIComponent(sig.model_id)}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-cyan-400 hover:text-cyan-300 bg-cyan-950/40 hover:bg-cyan-900/50 px-2.5 py-1 rounded border border-cyan-800/40 transition-colors"
              >
                <span>Inspect Model History</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
