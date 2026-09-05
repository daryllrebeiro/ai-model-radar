'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { ModelSnapshot } from '@/types/models';
import { WorkloadProfile, WorkloadTaskType } from '@/types/advisor';
import { AccessTier } from '@/lib/feature-flags';
import { calculateStackAdvice } from '@/lib/advisor';
import {
  CostScenario,
  normalizeScenario,
} from '@/lib/cost-model';
import {
  formatPricePerMillion,
  formatContextLength,
} from '@/lib/utils';
import {
  Sparkles,
  TrendingDown,
  ArrowRight,
  CheckCircle2,
  Gauge,
} from 'lucide-react';
import { WatchButton } from '../watchlist/watch-button';
import { FeatureGate } from '../FeatureGate';

interface WorkloadCalculatorProps {
  initialSnapshots: ModelSnapshot[];
  featureTier?: AccessTier | string;
}

export function WorkloadCalculator({ initialSnapshots, featureTier = 'free' }: WorkloadCalculatorProps) {
  const [promptTokensM, setPromptTokensM] = useState<number>(50); // 50M
  const [compTokensM, setCompTokensM] = useState<number>(10); // 10M
  const [requiredContext, setRequiredContext] = useState<number>(64000);
  const [taskType, setTaskType] = useState<WorkloadTaskType>('coding');
  const [cacheHitPct, setCacheHitPct] = useState<number>(0);
  const [batchDiscountPct, setBatchDiscountPct] = useState<number>(0);

  const workload: WorkloadProfile = useMemo(
    () => ({
      monthlyPromptTokens: promptTokensM * 1_000_000,
      monthlyCompTokens: compTokensM * 1_000_000,
      requiredContext,
      taskType,
    }),
    [promptTokensM, compTokensM, requiredContext, taskType]
  );

  const scenario: CostScenario = useMemo(
    () =>
      normalizeScenario({
        cacheHitRatio: cacheHitPct / 100,
        batchDiscount: batchDiscountPct / 100,
      }),
    [cacheHitPct, batchDiscountPct]
  );

  const isOptimizerActive = cacheHitPct > 0 || batchDiscountPct > 0;

  const advice = useMemo(() => {
    return calculateStackAdvice(workload, initialSnapshots, scenario);
  }, [workload, initialSnapshots, scenario]);

  const taskOptions: Array<{ id: WorkloadTaskType; label: string; desc: string }> = [
    { id: 'coding', label: 'Software & Agentic Coding', desc: 'Prioritizes SWE-bench and HumanEval capabilities' },
    { id: 'reasoning', label: 'Hard Scientific Reasoning', desc: 'Prioritizes GPQA Diamond & Math-500 precision' },
    { id: 'general', label: 'General Conversational Chatbot', desc: 'Balanced Chatbot Arena Elo and response speed' },
    { id: 'customer_support', label: 'High-Volume Customer Support', desc: 'Maximizes throughput and low latency' },
    { id: 'data_extraction', label: 'Large Context Document Extraction', desc: 'Requires large context window and exact recall' },
  ];

  return (
    <div className="space-y-8">
      {/* Interactive Controls Panel */}
      <div className="p-6 rounded-2xl border border-gray-800 bg-[#111827]/80 backdrop-blur-sm space-y-6">
        <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          Specify Your Monthly Production Workload
        </h2>

        {/* Task Selection Pills */}
        <div>
          <span className="text-xs font-mono text-gray-400 uppercase font-semibold block mb-2">
            Target Application Workload
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
            {taskOptions.map((t) => (
              <button
                key={t.id}
                onClick={() => setTaskType(t.id)}
                className={`p-3 rounded-xl border text-left transition-all ${
                  taskType === t.id
                    ? 'bg-cyan-950/80 border-cyan-500/50 text-white shadow-sm'
                    : 'bg-gray-900 border-gray-800 text-gray-400 hover:text-gray-200'
                }`}
              >
                <div className="text-xs font-bold font-sans">{t.label}</div>
                <div className="text-[10px] text-gray-400 mt-1 font-mono">{t.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Sliders Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-gray-800">
          {/* Monthly Prompt Volume */}
          <div>
            <div className="flex justify-between text-xs font-mono text-gray-300 mb-1">
              <span>Monthly Prompt Throughput</span>
              <span className="font-bold text-cyan-400">{promptTokensM}M Tokens / mo</span>
            </div>
            <input
              type="range"
              min="1"
              max="500"
              step="5"
              value={promptTokensM}
              onChange={(e) => setPromptTokensM(Number(e.target.value))}
              className="w-full accent-cyan-500"
            />
            <span className="text-[11px] text-gray-500 font-mono">
              {(promptTokensM * 1_000_000).toLocaleString()} input tokens
            </span>
          </div>

          {/* Monthly Completion Volume */}
          <div>
            <div className="flex justify-between text-xs font-mono text-gray-300 mb-1">
              <span>Monthly Output Throughput</span>
              <span className="font-bold text-emerald-400">{compTokensM}M Tokens / mo</span>
            </div>
            <input
              type="range"
              min="1"
              max="200"
              step="2"
              value={compTokensM}
              onChange={(e) => setCompTokensM(Number(e.target.value))}
              className="w-full accent-emerald-500"
            />
            <span className="text-[11px] text-gray-500 font-mono">
              {(compTokensM * 1_000_000).toLocaleString()} generated tokens
            </span>
          </div>

          {/* Minimum Context Window */}
          <div>
            <div className="flex justify-between text-xs font-mono text-gray-300 mb-1">
              <span>Required Context Window</span>
              <span className="font-bold text-purple-400">{formatContextLength(requiredContext)} Tokens</span>
            </div>
            <select
              value={requiredContext}
              onChange={(e) => setRequiredContext(Number(e.target.value))}
              className="w-full bg-gray-900 border border-gray-800 text-xs text-gray-200 rounded-lg p-2 focus:outline-none focus:border-cyan-500"
            >
              <option value="16000">16k Tokens (Standard Chat)</option>
              <option value="32000">32k Tokens</option>
              <option value="64000">64k Tokens (Multi-File Code)</option>
              <option value="128000">128k Tokens (Large Repo Context)</option>
              <option value="200000">200k Tokens (Frontier Long Context)</option>
              <option value="1048576">1M Tokens (Mega Multi-Modal Context)</option>
            </select>
            <span className="text-[11px] text-gray-500 font-mono">
              Filters out models with smaller context limits
            </span>
          </div>
        </div>

        {/* Cost Optimizer (Pro): cache-hit & batch-discount modeling */}
        <FeatureGate feature="COST_OPTIMIZER" userTier={featureTier}>
          <div className="pt-4 border-t border-gray-800">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-mono text-gray-300 uppercase font-semibold flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5 text-cyan-400" />
                Cost Optimizer — Effective Pricing
              </span>
              {isOptimizerActive && (
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-500/40 text-emerald-300">
                  OPTIMIZER ACTIVE
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Prompt Cache Hit Ratio */}
              <div>
                <div className="flex justify-between text-xs font-mono text-gray-300 mb-1">
                  <span>Prompt Cache Hit Ratio</span>
                  <span className="font-bold text-cyan-400">{cacheHitPct}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={cacheHitPct}
                  onChange={(e) => setCacheHitPct(Number(e.target.value))}
                  className="w-full accent-cyan-500"
                />
                <span className="text-[11px] text-gray-500 font-mono">
                  Cached input tokens billed at ~10% on most providers. High for RAG / agent frameworks.
                </span>
              </div>

              {/* Batch Discount */}
              <div>
                <div className="flex justify-between text-xs font-mono text-gray-300 mb-1">
                  <span>Batch API Discount</span>
                  <span className="font-bold text-emerald-400">{batchDiscountPct}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  step="5"
                  value={batchDiscountPct}
                  onChange={(e) => setBatchDiscountPct(Number(e.target.value))}
                  className="w-full accent-emerald-500"
                />
                <span className="text-[11px] text-gray-500 font-mono">
                  Up to 50% off via async batch endpoints (Anthropic / OpenAI / DeepSeek).
                </span>
              </div>
            </div>
            {isOptimizerActive && advice.effectiveMaxAnnualSavingsUsd !== undefined && (
              <p className="text-[11px] font-mono text-emerald-400 mt-3">
                Effective annual savings under this scenario:{' '}
                <strong>${advice.effectiveMaxAnnualSavingsUsd.toLocaleString()} / yr</strong>
                <span className="text-gray-500"> (projected with ±{Math.round((scenario.confidenceBand + (scenario.cacheHitRatio + scenario.batchDiscount) * 0.1) * 100)}% confidence band)</span>
              </p>
            )}
          </div>
        </FeatureGate>
      </div>

      {/* Savings Summary Banner */}
      {advice.maxAnnualSavingsUsd > 0 && (
        <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <TrendingDown className="w-5 h-5 text-emerald-400 flex-shrink-0" />
            <div>
              <div className="text-sm font-bold text-white">
                Potential Annual Infrastructure Savings: ${advice.maxAnnualSavingsUsd.toLocaleString()} / year
              </div>
              <p className="text-xs text-gray-400">
                By routing workload from frontier premium pricing to optimized value models with matching benchmark ratings.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Recommended 3-Tier Route Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {advice.recommendations.map((rec) => {
          const isBestValue = rec.tier === 'best_value';
          const isFree = rec.tier === 'free_tier';

          return (
            <div
              key={rec.tier}
              className={`rounded-2xl border p-6 flex flex-col justify-between space-y-6 relative transition-all ${
                isBestValue
                  ? 'border-emerald-500/50 bg-emerald-950/10 shadow-lg shadow-emerald-950/30 ring-1 ring-emerald-500/30'
                  : isFree
                  ? 'border-purple-500/30 bg-purple-950/10'
                  : 'border-gray-800 bg-[#111827]/70'
              }`}
            >
              {isBestValue && (
                <div className="absolute -top-3 left-6 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase bg-emerald-500 text-black">
                  Recommended Choice
                </div>
              )}

              <div className="space-y-4">
                {/* Header */}
                <div>
                  <span className="text-xs font-mono font-semibold uppercase text-gray-400 block">
                    {rec.tierLabel}
                  </span>
                  <h3 className="text-xl font-bold text-white mt-1">
                    {rec.model_name}
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs font-mono text-cyan-400 bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-800">
                      {rec.provider}
                    </span>
                    <span className="text-xs font-mono text-gray-400">
                      {formatContextLength(rec.context_length)} ctx
                    </span>
                  </div>
                </div>

                {/* Cost Projections */}
                <div className="p-4 rounded-xl border border-gray-800 bg-gray-950/70 space-y-1.5 font-mono">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-gray-400">Estimated Monthly Cost:</span>
                    <span className="text-xl font-bold text-white">
                      ${rec.monthly_cost_usd.toLocaleString()}
                    </span>
                  </div>
                  {isOptimizerActive && rec.effective_monthly_cost_usd !== undefined && (
                    <>
                      <div className="flex items-baseline justify-between text-xs text-emerald-400 font-bold pt-1 border-t border-gray-900">
                        <span>Effective (Cache + Batch):</span>
                        <span>${rec.effective_monthly_cost_usd.toLocaleString()}</span>
                      </div>
                      <div className="flex items-baseline justify-between text-[11px] text-gray-500 pt-1">
                        <span>Projected range (±15%):</span>
                        <span>
                          ${rec.monthly_cost_range_low?.toLocaleString()} – ${rec.monthly_cost_range_high?.toLocaleString()}
                        </span>
                      </div>
                    </>
                  )}
                  <div className="flex items-baseline justify-between text-xs text-gray-400 pt-1 border-t border-gray-900">
                    <span>Annual Cost:</span>
                    <span>
                      {isOptimizerActive && rec.effective_annual_cost_usd !== undefined
                        ? `$${rec.effective_annual_cost_usd.toLocaleString()} / yr`
                        : `$${rec.annual_cost_usd.toLocaleString()} / yr`}
                    </span>
                  </div>
                  {rec.annual_savings_vs_premium > 0 && (
                    <div className="flex items-baseline justify-between text-xs text-emerald-400 font-bold pt-1 border-t border-gray-900">
                      <span>Annual Savings:</span>
                      <span>
                        {isOptimizerActive && rec.effective_annual_savings_vs_premium !== undefined
                          ? `+$${rec.effective_annual_savings_vs_premium.toLocaleString()}`
                          : `+$${rec.annual_savings_vs_premium.toLocaleString()}`}
                      </span>
                    </div>
                  )}
                </div>

                {/* Pricing Rates */}
                <div className="grid grid-cols-2 gap-2 text-xs font-mono text-gray-300">
                  <div className="p-2 rounded bg-gray-900/60 border border-gray-800">
                    <span className="text-[10px] text-gray-500 block">Prompt Rate</span>
                    <span className="font-bold text-cyan-400">
                      {isOptimizerActive && rec.effective_prompt_per_1m !== undefined
                        ? `$${rec.effective_prompt_per_1m.toFixed(3)} / 1M`
                        : formatPricePerMillion(rec.prompt_per_1m / 1_000_000)}
                    </span>
                  </div>
                  <div className="p-2 rounded bg-gray-900/60 border border-gray-800">
                    <span className="text-[10px] text-gray-500 block">Completion Rate</span>
                    <span className="font-bold text-emerald-400">
                      {isOptimizerActive && rec.effective_comp_per_1m !== undefined
                        ? `$${rec.effective_comp_per_1m.toFixed(3)} / 1M`
                        : formatPricePerMillion(rec.comp_per_1m / 1_000_000)}
                    </span>
                  </div>
                </div>

                {/* Advantage & Benchmarks */}
                <div className="space-y-2 text-xs">
                  <div className="flex items-start gap-2 text-gray-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <span>{rec.key_advantage}</span>
                  </div>
                  <div className="p-2 rounded bg-gray-900 border border-gray-800 text-[11px] font-mono text-gray-400">
                    <strong className="text-gray-200">Verified Benchmark: </strong>
                    {rec.benchmark_score_highlight}
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <div className="pt-3 border-t border-gray-800 flex items-center justify-between">
                <WatchButton modelId={rec.model_id} />
                <Link
                  href={`/models/${encodeURIComponent(rec.model_id)}`}
                  className="inline-flex items-center gap-1 text-xs font-medium text-cyan-400 hover:text-cyan-300 bg-cyan-950/40 hover:bg-cyan-900/50 px-3 py-1.5 rounded-lg border border-cyan-800/40 transition-colors"
                >
                  <span>Model Details &amp; History</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
