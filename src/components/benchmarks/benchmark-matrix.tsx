'use client';

import React, { useState, useMemo } from 'react';
import { RawBenchmarkRecord, CustomBenchmarkWeights } from '@/types/benchmarks';
import { calculateClientPriorityScore } from '@/lib/benchmarks';
import {
  SlidersHorizontal,
  ExternalLink,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { WatchButton } from '../watchlist/watch-button';

interface BenchmarkMatrixProps {
  initialRecords: RawBenchmarkRecord[];
}

export function BenchmarkMatrix({ initialRecords }: BenchmarkMatrixProps) {
  const [records] = useState<RawBenchmarkRecord[]>(initialRecords);
  const [sortBy, setSortBy] = useState<string>('arena_elo');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [providerFilter, setProviderFilter] = useState<string>('All');
  const [showCustomDrawer, setShowCustomDrawer] = useState<boolean>(false);

  // User-defined priority weights (strictly browser-side)
  const [weights, setWeights] = useState<CustomBenchmarkWeights>({
    coding: 50,
    reasoning: 50,
    general: 50,
    math: 50,
    costEfficiency: 50,
  });

  const providers = useMemo(() => {
    const set = new Set<string>();
    records.forEach((r) => set.add(r.provider));
    return ['All', ...Array.from(set).sort()];
  }, [records]);

  // Compute records with custom priority scores
  const processedRecords = useMemo(() => {
    let list = records.map((r) => ({
      ...r,
      customScore: calculateClientPriorityScore(r, weights),
    }));

    if (providerFilter !== 'All') {
      list = list.filter((r) => r.provider === providerFilter);
    }

    list.sort((a, b) => {
      let aVal = (a as any)[sortBy] ?? 0;
      let bVal = (b as any)[sortBy] ?? 0;
      if (sortBy === 'price') {
        aVal = (a.pricing_prompt_1m || 0) + (a.pricing_comp_1m || 0);
        bVal = (b.pricing_prompt_1m || 0) + (b.pricing_comp_1m || 0);
      }
      return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
    });

    return list;
  }, [records, sortBy, sortOrder, providerFilter, weights]);

  const handleHeaderClick = (columnKey: string) => {
    if (sortBy === columnKey) {
      setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(columnKey);
      setSortOrder('desc');
    }
  };

  const resetWeights = () => {
    setWeights({
      coding: 50,
      reasoning: 50,
      general: 50,
      math: 50,
      costEfficiency: 50,
    });
  };

  return (
    <div className="space-y-6">
      {/* Controls Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#111827]/70 p-4 rounded-xl border border-gray-800">
        <div className="flex items-center gap-2">
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="bg-gray-900 border border-gray-800 text-xs text-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-500/60"
          >
            {providers.map((p) => (
              <option key={p} value={p}>
                {p === 'All' ? 'All Providers' : p}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCustomDrawer(!showCustomDrawer)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-all ${
              showCustomDrawer || sortBy === 'customScore'
                ? 'bg-cyan-950/80 border-cyan-500/50 text-cyan-300'
                : 'bg-gray-900 border-gray-800 text-gray-300 hover:text-white'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Customize My Workload Weights</span>
          </button>
        </div>
      </div>

      {/* Client-Side Custom Weighting Drawer */}
      {showCustomDrawer && (
        <div className="p-5 rounded-2xl border border-cyan-500/30 bg-cyan-950/20 backdrop-blur-md space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-bold text-white tracking-tight">
                Client-Side Workload Priority Tuning
              </h3>
            </div>
            <button
              onClick={resetWeights}
              className="flex items-center gap-1 text-[11px] font-mono text-gray-400 hover:text-gray-200"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          </div>
          <p className="text-xs text-gray-400">
            Per Principle #2, we do not publish subjective composite scores. Adjust these sliders to rank models based purely on your application needs (calculated in your browser).
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 pt-2">
            <div>
              <div className="flex justify-between text-xs font-mono text-gray-300 mb-1">
                <span>Coding (SWE-bench)</span>
                <span className="font-bold text-cyan-400">{weights.coding}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={weights.coding}
                onChange={(e) => {
                  setWeights({ ...weights, coding: Number(e.target.value) });
                  setSortBy('customScore');
                  setSortOrder('desc');
                }}
                className="w-full accent-cyan-500"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs font-mono text-gray-300 mb-1">
                <span>Reasoning (GPQA)</span>
                <span className="font-bold text-amber-400">{weights.reasoning}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={weights.reasoning}
                onChange={(e) => {
                  setWeights({ ...weights, reasoning: Number(e.target.value) });
                  setSortBy('customScore');
                  setSortOrder('desc');
                }}
                className="w-full accent-amber-500"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs font-mono text-gray-300 mb-1">
                <span>General (Chatbot Elo)</span>
                <span className="font-bold text-purple-400">{weights.general}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={weights.general}
                onChange={(e) => {
                  setWeights({ ...weights, general: Number(e.target.value) });
                  setSortBy('customScore');
                  setSortOrder('desc');
                }}
                className="w-full accent-purple-500"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs font-mono text-gray-300 mb-1">
                <span>Math &amp; Logic</span>
                <span className="font-bold text-emerald-400">{weights.math}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={weights.math}
                onChange={(e) => {
                  setWeights({ ...weights, math: Number(e.target.value) });
                  setSortBy('customScore');
                  setSortOrder('desc');
                }}
                className="w-full accent-emerald-500"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs font-mono text-gray-300 mb-1">
                <span>Cost Efficiency</span>
                <span className="font-bold text-rose-400">{weights.costEfficiency}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={weights.costEfficiency}
                onChange={(e) => {
                  setWeights({ ...weights, costEfficiency: Number(e.target.value) });
                  setSortBy('customScore');
                  setSortOrder('desc');
                }}
                className="w-full accent-rose-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* Benchmarks Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-800 bg-[#111827]/70">
        <table className="w-full text-left text-xs font-mono border-collapse">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900/80 text-gray-400 uppercase tracking-wider select-none">
              <th className="py-3 px-4 font-semibold">Model</th>
              <th
                onClick={() => handleHeaderClick('arena_elo')}
                className="py-3 px-3 font-semibold text-right cursor-pointer hover:text-white"
                title="LMSYS Chatbot Arena Elo Rating"
              >
                Chatbot Arena {sortBy === 'arena_elo' ? (sortOrder === 'desc' ? '▼' : '▲') : ''}
              </th>
              <th
                onClick={() => handleHeaderClick('swe_bench_verified')}
                className="py-3 px-3 font-semibold text-right cursor-pointer hover:text-white"
                title="SWE-bench Verified Solve Rate %"
              >
                SWE-bench {sortBy === 'swe_bench_verified' ? (sortOrder === 'desc' ? '▼' : '▲') : ''}
              </th>
              <th
                onClick={() => handleHeaderClick('humaneval')}
                className="py-3 px-3 font-semibold text-right cursor-pointer hover:text-white"
                title="HumanEval Pass@1 %"
              >
                HumanEval {sortBy === 'humaneval' ? (sortOrder === 'desc' ? '▼' : '▲') : ''}
              </th>
              <th
                onClick={() => handleHeaderClick('math_500')}
                className="py-3 px-3 font-semibold text-right cursor-pointer hover:text-white"
                title="MATH-500 Benchmark Score %"
              >
                MATH-500 {sortBy === 'math_500' ? (sortOrder === 'desc' ? '▼' : '▲') : ''}
              </th>
              <th
                onClick={() => handleHeaderClick('gpqa_diamond')}
                className="py-3 px-3 font-semibold text-right cursor-pointer hover:text-white"
                title="GPQA Diamond Reasoning %"
              >
                GPQA {sortBy === 'gpqa_diamond' ? (sortOrder === 'desc' ? '▼' : '▲') : ''}
              </th>
              <th
                onClick={() => handleHeaderClick('price')}
                className="py-3 px-3 font-semibold text-right cursor-pointer hover:text-white"
                title="Prompt & Completion $/1M Tokens"
              >
                Price ($/1M) {sortBy === 'price' ? (sortOrder === 'desc' ? '▼' : '▲') : ''}
              </th>
              {sortBy === 'customScore' && (
                <th className="py-3 px-3 font-semibold text-right text-cyan-400">
                  Custom Match
                </th>
              )}
              <th className="py-3 px-4 font-semibold text-center">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/60">
            {processedRecords.map((r) => (
              <tr key={r.model_id} className="hover:bg-gray-800/40 transition-colors">
                {/* Model Name & ID */}
                <td className="py-3 px-4 font-sans">
                  <div className="flex items-center gap-2">
                    <WatchButton modelId={r.model_id} />
                    <div>
                      <div className="font-semibold text-white text-sm">
                        {r.name}
                      </div>
                      <span className="text-[11px] font-mono text-gray-400 truncate block">
                        {r.model_id}
                      </span>
                    </div>
                  </div>
                </td>

                {/* Chatbot Arena Elo */}
                <td className="py-3 px-3 text-right">
                  <span className="font-bold text-purple-300">
                    {r.arena_elo || '-'}
                  </span>
                </td>

                {/* SWE-bench Verified */}
                <td className="py-3 px-3 text-right">
                  <span className="font-bold text-cyan-300">
                    {r.swe_bench_verified ? `${r.swe_bench_verified}%` : '-'}
                  </span>
                </td>

                {/* HumanEval */}
                <td className="py-3 px-3 text-right text-gray-200">
                  {r.humaneval ? `${r.humaneval}%` : '-'}
                </td>

                {/* MATH-500 */}
                <td className="py-3 px-3 text-right text-gray-200">
                  {r.math_500 ? `${r.math_500}%` : '-'}
                </td>

                {/* GPQA Diamond */}
                <td className="py-3 px-3 text-right text-gray-200">
                  {r.gpqa_diamond ? `${r.gpqa_diamond}%` : '-'}
                </td>

                {/* Price */}
                <td className="py-3 px-3 text-right">
                  <div className="font-bold text-emerald-400">
                    {r.pricing_prompt_1m === 0 ? 'Free' : `$${(r.pricing_prompt_1m || 0).toFixed(2)}`}
                  </div>
                  <div className="text-[10px] text-gray-400">
                    comp: ${(r.pricing_comp_1m || 0).toFixed(2)}
                  </div>
                </td>

                {/* Custom Score */}
                {sortBy === 'customScore' && (
                  <td className="py-3 px-3 text-right">
                    <span className="px-2 py-0.5 rounded bg-cyan-950/80 border border-cyan-500/40 text-cyan-300 font-bold">
                      {r.customScore}
                    </span>
                  </td>
                )}

                {/* Source Citation */}
                <td className="py-3 px-4 text-center">
                  <a
                    href={r.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Tested on ${r.tested_date} via ${r.source_name}`}
                    className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-cyan-400 bg-gray-900 px-2 py-1 rounded border border-gray-800 transition-colors"
                  >
                    <span>{(r.source_name || 'Report').split(' ')[0]}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
