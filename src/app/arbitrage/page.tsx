import React from 'react';
import Link from 'next/link';
import { getLatestSnapshotsMap } from '@/lib/db/queries';
import { computeArbitrageOpportunities, ArbitrageCluster } from '@/lib/arbitrage';
import { formatPricePerMillion, formatContextLength } from '@/lib/utils';
import { Scale, TrendingDown, ArrowRight, ShieldCheck, ChevronRight, Zap } from 'lucide-react';
import { WatchButton } from '@/components/watchlist/watch-button';

export const dynamic = 'force-dynamic';

export default async function ArbitragePage() {
  const snapshotsMap = await getLatestSnapshotsMap();
  const snapshots = Array.from(snapshotsMap.values());
  const opportunities = computeArbitrageOpportunities(snapshots);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="border-b border-gray-800 pb-6">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-cyan-950/60 border border-cyan-800/50 text-cyan-400 text-xs font-mono mb-2">
          <Scale className="w-3.5 h-3.5" />
          <span>MULTI-PROVIDER PRICE ARBITRAGE</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          AI Provider Price Arbitrage
        </h1>
        <p className="mt-1.5 text-sm sm:text-base text-gray-400 max-w-2xl">
          Compare different endpoints and host providers serving identical model architectures to find the lowest latency and cheapest token pricing.
        </p>
      </div>

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5">
          <span className="text-xs font-mono text-cyan-400 uppercase">Analyzed Clusters</span>
          <div className="text-2xl font-bold font-mono text-white mt-1">
            {opportunities.length} Multi-Host Models
          </div>
          <p className="text-xs text-gray-400 mt-0.5">models with 2+ hosting providers</p>
        </div>

        <div className="p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
          <span className="text-xs font-mono text-emerald-400 uppercase">Max Cost Discrepancy</span>
          <div className="text-2xl font-bold font-mono text-emerald-400 mt-1">
            {opportunities.length > 0 ? `${opportunities[0].max_prompt_savings_pct}% Spread` : '0%'}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">potential savings for identical weights</p>
        </div>

        <div className="p-4 rounded-xl border border-purple-500/20 bg-purple-500/5">
          <span className="text-xs font-mono text-purple-400 uppercase">Free Routing Available</span>
          <div className="text-2xl font-bold font-mono text-purple-300 mt-1">
            {opportunities.filter((o) => o.cheapest_option.is_free).length} Free Options
          </div>
          <p className="text-xs text-gray-400 mt-0.5">supported by community rate limits</p>
        </div>
      </div>

      {/* Arbitrage Clusters List */}
      <div className="space-y-6">
        <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
          <Zap className="w-4 h-4 text-cyan-400" />
          Model Architecture Arbitrage Comparison
        </h2>

        {opportunities.length > 0 ? (
          opportunities.map((cluster) => (
            <div
              key={cluster.family_key}
              className="rounded-2xl border border-gray-800 bg-[#111827]/70 p-5 sm:p-6 space-y-4 shadow-sm"
            >
              {/* Cluster Title & Spread Badge */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-800/80 pb-3">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-bold text-white tracking-tight">
                    {cluster.display_name}
                  </h3>
                  <span className="text-xs font-mono text-gray-400 bg-gray-800 px-2 py-0.5 rounded">
                    {cluster.provider_count} Providers Available
                  </span>
                </div>

                {cluster.max_prompt_savings_pct > 0 && (
                  <span className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold bg-emerald-950/80 border border-emerald-500/40 text-emerald-300">
                    <TrendingDown className="w-3.5 h-3.5" />
                    Up to {cluster.max_prompt_savings_pct}% Cheaper
                  </span>
                )}
              </div>

              {/* Provider Options Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono border-collapse">
                  <thead>
                    <tr className="border-b border-gray-800 text-gray-400 uppercase tracking-wider">
                      <th className="py-2.5 px-3">Provider / Endpoint</th>
                      <th className="py-2.5 px-3 text-right">Prompt Price ($/1M)</th>
                      <th className="py-2.5 px-3 text-right">Completion Price ($/1M)</th>
                      <th className="py-2.5 px-3 text-right">Context</th>
                      <th className="py-2.5 px-3 text-center">Status</th>
                      <th className="py-2.5 px-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/60">
                    {cluster.all_options.map((opt, idx) => {
                      const isCheapest = opt.model_id === cluster.cheapest_option.model_id;
                      const isExpensive = opt.model_id === cluster.expensive_option.model_id && cluster.all_options.length > 1;

                      return (
                        <tr
                          key={opt.model_id}
                          className={`hover:bg-gray-800/30 transition-colors ${
                            isCheapest ? 'bg-emerald-950/20' : ''
                          }`}
                        >
                          <td className="py-3 px-3 font-sans">
                            <div className="font-semibold text-white">
                              {opt.provider}
                            </div>
                            <span className="text-[11px] font-mono text-gray-400 truncate block max-w-xs">
                              {opt.model_id}
                            </span>
                          </td>

                          <td className="py-3 px-3 text-right">
                            <span
                              className={`font-bold ${
                                opt.is_free
                                  ? 'text-purple-400'
                                  : isCheapest
                                  ? 'text-emerald-400'
                                  : isExpensive
                                  ? 'text-rose-400'
                                  : 'text-gray-200'
                              }`}
                            >
                              {formatPricePerMillion(opt.price_prompt)}
                            </span>
                          </td>

                          <td className="py-3 px-3 text-right">
                            <span
                              className={`font-bold ${
                                opt.is_free
                                  ? 'text-purple-400'
                                  : isCheapest
                                  ? 'text-emerald-400'
                                  : isExpensive
                                  ? 'text-rose-400'
                                  : 'text-gray-200'
                              }`}
                            >
                              {formatPricePerMillion(opt.price_completion)}
                            </span>
                          </td>

                          <td className="py-3 px-3 text-right text-gray-400">
                            {formatContextLength(opt.context_length)}
                          </td>

                          <td className="py-3 px-3 text-center">
                            {opt.is_free ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-950 text-purple-300 border border-purple-500/30">
                                100% Free
                              </span>
                            ) : isCheapest ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/30">
                                Best Value
                              </span>
                            ) : isExpensive ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-950/60 text-rose-300 border border-rose-500/30">
                                Higher Cost
                              </span>
                            ) : (
                              <span className="text-gray-500 text-[11px]">-</span>
                            )}
                          </td>

                          <td className="py-3 px-3 text-center">
                            <div className="flex items-center justify-center gap-1.5 font-sans">
                              <WatchButton modelId={opt.model_id} />
                              <Link
                                href={`/models/${encodeURIComponent(opt.model_id)}`}
                                className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 bg-cyan-950/40 hover:bg-cyan-900/50 px-2 py-1 rounded border border-cyan-800/40 transition-colors"
                              >
                                <span>Detail</span>
                                <ChevronRight className="w-3 h-3" />
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        ) : (
          <div className="p-12 text-center rounded-xl border border-gray-800 bg-[#111827]/40 text-gray-400">
            No multi-provider clusters detected yet. Poll models to populate arbitrage comparisons.
          </div>
        )}
      </div>
    </div>
  );
}
