'use client';

import React from 'react';
import Link from 'next/link';
import { MigrationReport } from '@/lib/migration-advisor';
import { ArrowRight, Scale, TrendingDown, Cpu, Sparkles } from 'lucide-react';
import { CompareButton } from '../compare/compare-button';
import { trackEvent } from '@/lib/analytics';

interface MigrationAlternativesCardProps {
  report: MigrationReport;
}

export function MigrationAlternativesCard({ report }: MigrationAlternativesCardProps) {
  const { target_model, alternatives, compare_url } = report;

  if (!alternatives || alternatives.length === 0) return null;

  return (
    <div className="rounded-2xl border border-gray-800 bg-[#111827]/70 backdrop-blur-sm p-5 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-800/80 pb-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 mb-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            <span>MIGRATION ADVISOR</span>
          </div>
          <h3 className="text-lg font-bold text-white tracking-tight">
            Drop-In Alternatives & Workload Migrations
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Transparent replacements based on matching context window, lower blended token pricing, and verified benchmarks.
          </p>
        </div>

        <Link
          href={compare_url}
          onClick={() => trackEvent('migration_compare_all', { targetModel: target_model.model_id })}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-mono font-semibold transition-all shadow-sm shrink-0"
        >
          <Scale className="w-4 h-4" />
          <span>Compare All ({alternatives.length + 1})</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Grid of 2-3 Alternative Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {alternatives.map((alt) => (
          <div
            key={alt.model_id}
            className="flex flex-col justify-between p-4 rounded-xl border border-gray-800 bg-gray-900/60 hover:bg-gray-900/90 transition-all space-y-4 hover:border-gray-700"
          >
            <div className="space-y-3">
              {/* Header: Name + Provider + Savings Badge */}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[11px] font-mono text-cyan-400 flex items-center gap-1">
                    <Cpu className="w-3 h-3" />
                    {alt.provider}
                  </div>
                  <h4 className="text-sm font-bold text-white mt-0.5">{alt.model_name}</h4>
                </div>

                {alt.cost_savings_pct > 0 ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/40 shrink-0">
                    <TrendingDown className="w-3 h-3" />
                    {alt.cost_savings_pct}% Save
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-gray-800 text-gray-300 border border-gray-700 shrink-0">
                    Comparable Cost
                  </span>
                )}
              </div>

              {/* Rationale text */}
              <p className="text-xs text-gray-300 leading-relaxed font-sans bg-gray-950/60 p-2.5 rounded-lg border border-gray-800/80">
                {alt.rationale}
              </p>

              {/* Specs & Pricing Deltas */}
              <div className="space-y-1.5 text-xs font-mono">
                <div className="flex justify-between py-1 border-b border-gray-800/40">
                  <span className="text-gray-400">Pricing / 1M:</span>
                  <span className="text-gray-200 font-bold">
                    ${alt.prompt_per_1m.toFixed(2)} / ${alt.comp_per_1m.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-gray-800/40">
                  <span className="text-gray-400">Context:</span>
                  <span className="text-gray-200">{alt.context_comparison_label}</span>
                </div>
                {alt.benchmark_comparison?.arena_elo && (
                  <div className="flex justify-between py-1 border-b border-gray-800/40">
                    <span className="text-gray-400">Arena Elo:</span>
                    <span className="text-cyan-400 font-bold">
                      {alt.benchmark_comparison.arena_elo}
                      {alt.benchmark_comparison.delta_elo !== undefined && (
                        <span className={`text-[10px] ml-1 ${alt.benchmark_comparison.delta_elo >= 0 ? 'text-emerald-400' : 'text-gray-400'}`}>
                          ({alt.benchmark_comparison.delta_elo >= 0 ? '+' : ''}{alt.benchmark_comparison.delta_elo})
                        </span>
                      )}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-800/60">
              <Link
                href={`/models/${encodeURIComponent(alt.model_id)}`}
                className="text-xs font-mono text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
              >
                Model Details
              </Link>
              <CompareButton modelId={alt.model_id} variant="compact" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
