import React from 'react';
import Link from 'next/link';
import { getModelDetail, getModelCurrentList } from '@/lib/db/queries';
import { RAW_BENCHMARK_DATA } from '@/lib/benchmarks';
import { computeArbitrageOpportunities } from '@/lib/arbitrage';
import { PriceChart } from '@/components/models/price-chart';
import { CompareButton } from '@/components/compare/compare-button';
import { Scale, ArrowLeft, Share2, Check, Sparkles, AlertCircle, ExternalLink, Zap } from 'lucide-react';
import { ShareButton } from '@/components/compare/share-button';
import { CompareModelSelector } from '@/components/compare/compare-model-selector';

export const dynamic = 'force-dynamic';

interface ComparePageProps {
  searchParams: {
    models?: string;
  };
}

export default async function ComparePage({ searchParams }: ComparePageProps) {
  const modelIdsParam = searchParams.models || '';
  const requestedIds = modelIdsParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 4);

  // Fetch all available models for the selector
  const { models: allModels } = await getModelCurrentList({ limit: 100 });
  const arbitrageList = computeArbitrageOpportunities(allModels);

  // Fetch details for requested models
  const modelDetails = await Promise.all(
    requestedIds.map(async (id) => {
      const detail = await getModelDetail(id);
      const benchmark = RAW_BENCHMARK_DATA.find(
        (b) =>
          b.model_id.toLowerCase() === id.toLowerCase() ||
          id.toLowerCase().includes(b.model_id.toLowerCase()) ||
          b.name.toLowerCase().includes(id.toLowerCase())
      );
      const arbitrage = arbitrageList.find((a) =>
        a.all_options.some((opt) => opt.model_id.toLowerCase() === id.toLowerCase())
      );

      return {
        id,
        current: detail?.current || null,
        snapshots: detail?.snapshots || [],
        events: detail?.events || [],
        benchmark: benchmark || null,
        arbitrage: arbitrage || null,
      };
    })
  );

  const activeModels = modelDetails.filter((m) => m.current !== null || m.benchmark !== null);

  const presets = [
    {
      title: 'Frontier Reasoning Titans',
      models: ['anthropic/claude-3-7-sonnet', 'openai/gpt-4o', 'deepseek/deepseek-r1'],
    },
    {
      title: 'Open Weights Champions',
      models: ['meta-llama/llama-3.3-70b-instruct', 'qwen/qwen-2.5-72b-instruct', 'mistralai/mistral-large-2411'],
    },
    {
      title: 'Cost-Effective Workhorses',
      models: ['deepseek/deepseek-chat', 'openai/gpt-4o-mini', 'anthropic/claude-3-5-haiku'],
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-800 pb-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="text-xs font-mono text-gray-400 hover:text-gray-200 flex items-center gap-1 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Radar</span>
            </Link>
            <span className="text-gray-600">/</span>
            <span className="text-xs font-mono text-cyan-400">Model Comparator</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white flex items-center gap-3">
            <Scale className="w-7 h-7 text-cyan-400" />
            <span>Side-by-Side Model Comparator</span>
          </h1>
          <p className="text-xs sm:text-sm text-gray-400 max-w-2xl">
            Objective, factual comparison across real-time API pricing, context limits, provider arbitrage, and verified evaluation scores. No synthesized composite rankings.
          </p>
        </div>

        {activeModels.length > 0 && (
          <div className="flex items-center gap-3">
            <ShareButton />
          </div>
        )}
      </div>

      {/* Model Selector Bar */}
      <CompareModelSelector
        availableModels={allModels.map((m) => ({
          id: m.model_id,
          name: m.name,
          provider: m.provider,
          pricePrompt: m.price_prompt,
          priceComp: m.price_completion,
        }))}
        selectedIds={requestedIds}
      />

      {/* Comparison Matrix or Empty State */}
      {activeModels.length === 0 ? (
        <div className="p-10 rounded-3xl border border-gray-800 bg-[#111827]/40 text-center space-y-6 max-w-3xl mx-auto my-12">
          <div className="w-12 h-12 rounded-2xl bg-cyan-950/80 border border-cyan-700/60 text-cyan-400 flex items-center justify-center mx-auto">
            <Scale className="w-6 h-6" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold text-white">Select 2 to 4 Models to Compare</h3>
            <p className="text-xs sm:text-sm text-gray-400 max-w-lg mx-auto">
              Choose models using the selector above or pick one of the curated comparison presets below.
            </p>
          </div>

          {/* Quick Presets */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 text-left">
            {presets.map((preset) => (
              <Link
                key={preset.title}
                href={`/compare?models=${encodeURIComponent(preset.models.join(','))}`}
                className="p-4 rounded-xl border border-gray-800 bg-[#0B0F17] hover:border-cyan-500/50 hover:bg-gray-900/60 transition-all space-y-2 group"
              >
                <div className="text-xs font-semibold text-white group-hover:text-cyan-400 flex items-center justify-between">
                  <span>{preset.title}</span>
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <div className="space-y-1">
                  {preset.models.map((m) => (
                    <div key={m} className="text-[11px] font-mono text-gray-400 truncate">
                      • {m.split('/').pop()}
                    </div>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Comparison Grid */}
          <div
            className={`grid grid-cols-1 md:grid-cols-${Math.min(activeModels.length, 4)} gap-6`}
            style={{
              gridTemplateColumns: `repeat(${Math.min(activeModels.length, 4)}, minmax(0, 1fr))`,
            }}
          >
            {activeModels.map((item) => {
              const name = item.current?.name || item.benchmark?.name || item.id;
              const provider = item.current?.provider || item.benchmark?.provider || 'Unknown';
              const pricePrompt = item.current?.price_prompt ?? item.benchmark?.pricing_prompt_1m;
              const priceComp = item.current?.price_completion ?? item.benchmark?.pricing_comp_1m;
              const contextLength = item.current?.context_length;
              const isFree = item.current?.is_free || (pricePrompt === 0 && priceComp === 0);

              return (
                <div
                  key={item.id}
                  className="rounded-2xl border border-gray-800 bg-[#111827]/70 p-6 space-y-6 flex flex-col justify-between"
                >
                  {/* Card Header */}
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="px-2.5 py-1 rounded-md bg-gray-800 text-[11px] font-mono text-gray-300 font-semibold uppercase">
                        {provider}
                      </span>
                      <CompareButton modelId={item.id} variant="icon" />
                    </div>

                    <div>
                      <Link
                        href={`/models/${item.id}`}
                        className="text-lg font-bold text-white hover:text-cyan-400 transition-colors leading-snug line-clamp-2"
                      >
                        {name}
                      </Link>
                      <div className="text-[11px] font-mono text-gray-400 truncate mt-0.5">
                        {item.id}
                      </div>
                    </div>
                  </div>

                  {/* Pricing Matrix */}
                  <div className="space-y-3 border-t border-gray-800/80 pt-4">
                    <div className="text-xs font-mono text-gray-400 uppercase font-semibold">
                      API Pricing (per 1M Tokens)
                    </div>

                    <div className="grid grid-cols-2 gap-2 bg-[#0B0F17] p-3 rounded-xl border border-gray-800/60 font-mono text-xs">
                      <div>
                        <div className="text-gray-400 text-[10px]">PROMPT</div>
                        <div className="text-white font-bold text-sm mt-0.5">
                          {isFree ? (
                            <span className="text-emerald-400 font-extrabold">FREE</span>
                          ) : pricePrompt !== null && pricePrompt !== undefined ? (
                            `$${pricePrompt.toFixed(pricePrompt < 0.1 ? 4 : 2)}`
                          ) : (
                            '—'
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-gray-400 text-[10px]">COMPLETION</div>
                        <div className="text-white font-bold text-sm mt-0.5">
                          {isFree ? (
                            <span className="text-emerald-400 font-extrabold">FREE</span>
                          ) : priceComp !== null && priceComp !== undefined ? (
                            `$${priceComp.toFixed(priceComp < 0.1 ? 4 : 2)}`
                          ) : (
                            '—'
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Context & Modality Specs */}
                  <div className="space-y-2 border-t border-gray-800/80 pt-4 text-xs font-mono">
                    <div className="flex justify-between py-1 border-b border-gray-800/40">
                      <span className="text-gray-400">Context Window</span>
                      <span className="text-gray-200 font-bold">
                        {contextLength ? `${Math.round(contextLength / 1024)}k tokens` : '128k tokens'}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-gray-800/40">
                      <span className="text-gray-400">Modality</span>
                      <span className="text-gray-200">{item.current?.modality || 'Text + Multimodal'}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-gray-800/40">
                      <span className="text-gray-400">Cheapest Host</span>
                      <span className="text-cyan-400 font-bold">
                        {item.arbitrage
                          ? `${item.arbitrage.cheapest_option.provider} (${item.arbitrage.max_prompt_savings_pct.toFixed(0)}% lower)`
                          : provider}
                      </span>
                    </div>
                  </div>

                  {/* Sourced Benchmark Standings */}
                  <div className="space-y-3 border-t border-gray-800/80 pt-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-gray-400 uppercase font-semibold">
                        Sourced Benchmarks
                      </span>
                      {item.benchmark && (
                        <span className="text-[10px] font-mono text-gray-400">
                          Tested {item.benchmark.tested_date}
                        </span>
                      )}
                    </div>

                    {item.benchmark ? (
                      <div className="space-y-1.5 text-xs font-mono bg-[#0B0F17] p-3 rounded-xl border border-gray-800/60">
                        {item.benchmark.arena_elo && (
                          <div className="flex justify-between">
                            <span className="text-gray-400">LMSYS Arena Elo</span>
                            <span className="text-amber-400 font-bold">{item.benchmark.arena_elo}</span>
                          </div>
                        )}
                        {item.benchmark.humaneval && (
                          <div className="flex justify-between">
                            <span className="text-gray-400">HumanEval (Coding)</span>
                            <span className="text-emerald-400 font-bold">{item.benchmark.humaneval}%</span>
                          </div>
                        )}
                        {item.benchmark.math_500 && (
                          <div className="flex justify-between">
                            <span className="text-gray-400">MATH-500 (Reasoning)</span>
                            <span className="text-cyan-400 font-bold">{item.benchmark.math_500}%</span>
                          </div>
                        )}
                        {item.benchmark.mmlu_pro && (
                          <div className="flex justify-between">
                            <span className="text-gray-400">MMLU-Pro</span>
                            <span className="text-purple-400 font-bold">{item.benchmark.mmlu_pro}%</span>
                          </div>
                        )}
                        <div className="pt-1.5 mt-1 border-t border-gray-800/50 text-[10px] text-gray-400 truncate flex items-center justify-between">
                          <span>Src: {item.benchmark.source_name}</span>
                          <a
                            href={item.benchmark.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-cyan-400 hover:underline flex items-center gap-0.5"
                          >
                            <span>Verify</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 rounded-xl bg-gray-900/40 border border-gray-800 text-center text-xs text-gray-400 font-mono">
                        Awaiting official evaluation report
                      </div>
                    )}
                  </div>

                  {/* Historical Pricing Sparkline */}
                  {item.snapshots.length > 1 && (
                    <div className="space-y-2 border-t border-gray-800/80 pt-4">
                      <div className="text-[11px] font-mono text-gray-400">
                        Price History ({item.snapshots.length} snapshots)
                      </div>
                      <div className="h-32">
                        <PriceChart snapshots={item.snapshots} />
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="pt-2">
                    <Link
                      href={`/models/${item.id}`}
                      className="block w-full py-2 text-center rounded-lg bg-gray-800 hover:bg-gray-700 text-xs font-semibold text-white uppercase tracking-wider transition-colors font-mono"
                    >
                      View Full Profile
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
