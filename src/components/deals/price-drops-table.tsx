'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { PriceDropDeal } from '@/types/events';
import {
  formatPricePerMillion,
  formatRelativeTime,
  formatExactDate,
} from '@/lib/utils';
import { TrendingDown, ChevronRight, Cpu } from 'lucide-react';

interface PriceDropsTableProps {
  drops7d: PriceDropDeal[];
  drops30d: PriceDropDeal[];
}

export function PriceDropsTable({ drops7d, drops30d }: PriceDropsTableProps) {
  const [timeframe, setTimeframe] = useState<'7d' | '30d'>('7d');
  const activeDrops = timeframe === '7d' ? drops7d : drops30d;

  return (
    <div className="space-y-4">
      {/* Header & Timeframe Switcher */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <TrendingDown className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">
              Biggest Price Drops Leaderboard
            </h2>
            <p className="text-xs text-gray-400">
              Ranked by largest percentage price cut across all providers
            </p>
          </div>
        </div>

        {/* 7d vs 30d Toggle */}
        <div className="flex items-center bg-gray-900 border border-gray-800 rounded-lg p-1">
          <button
            onClick={() => setTimeframe('7d')}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
              timeframe === '7d'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Last 7 Days ({drops7d.length})
          </button>
          <button
            onClick={() => setTimeframe('30d')}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
              timeframe === '30d'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Last 30 Days ({drops30d.length})
          </button>
        </div>
      </div>

      {/* Table */}
      {activeDrops.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-gray-800 bg-[#111827]/70">
          <table className="w-full text-left border-collapse text-xs font-mono">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/80 text-gray-400 uppercase tracking-wider">
                <th className="py-3 px-4 font-semibold">Model & Provider</th>
                <th className="py-3 px-4 font-semibold text-right">Prompt Price Cut</th>
                <th className="py-3 px-4 font-semibold text-right">Completion Price Cut</th>
                <th className="py-3 px-4 font-semibold text-right">Discount</th>
                <th className="py-3 px-4 font-semibold text-right">Detected</th>
                <th className="py-3 px-4 font-semibold text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60">
              {activeDrops.map((drop, idx) => {
                const is100Pct = drop.pct_change <= -100;
                return (
                  <tr
                    key={`${drop.model_id}-${drop.detected_at}-${idx}`}
                    className="hover:bg-gray-800/40 transition-colors"
                  >
                    {/* Model Name & ID */}
                    <td className="py-3 px-4 font-sans">
                      <div className="font-semibold text-white text-sm">
                        {drop.model_name}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-800">
                          {drop.provider}
                        </span>
                        <span className="text-[11px] font-mono text-gray-400 truncate max-w-[200px]">
                          {drop.model_id}
                        </span>
                      </div>
                    </td>

                    {/* Prompt Price */}
                    <td className="py-3 px-4 text-right">
                      <div className="text-gray-400 line-through text-[11px]">
                        {formatPricePerMillion(drop.old_prompt)}
                      </div>
                      <div className="text-emerald-400 font-bold">
                        {formatPricePerMillion(drop.new_prompt)}
                      </div>
                    </td>

                    {/* Completion Price */}
                    <td className="py-3 px-4 text-right">
                      <div className="text-gray-400 line-through text-[11px]">
                        {formatPricePerMillion(drop.old_completion)}
                      </div>
                      <div className="text-emerald-400 font-bold">
                        {formatPricePerMillion(drop.new_completion)}
                      </div>
                    </td>

                    {/* Discount Badge */}
                    <td className="py-3 px-4 text-right">
                      <span className="inline-block px-2 py-1 rounded bg-emerald-950/90 border border-emerald-500/40 text-emerald-300 font-bold text-xs">
                        {is100Pct ? '100% FREE' : `${Math.abs(drop.pct_change).toFixed(1)}% OFF`}
                      </span>
                    </td>

                    {/* Detected */}
                    <td className="py-3 px-4 text-right text-gray-400">
                      <span title={formatExactDate(drop.detected_at)}>
                        {formatRelativeTime(drop.detected_at)}
                      </span>
                    </td>

                    {/* Action Link */}
                    <td className="py-3 px-4 text-center">
                      <Link
                        href={`/models/${encodeURIComponent(drop.model_id)}`}
                        className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 bg-cyan-950/50 hover:bg-cyan-900/60 px-2.5 py-1 rounded-md border border-cyan-800/40 transition-colors font-sans"
                      >
                        <span>History</span>
                        <ChevronRight className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-8 text-center rounded-xl border border-gray-800 bg-[#111827]/40 text-gray-400 text-sm">
          No price drops recorded in the selected window yet.
        </div>
      )}
    </div>
  );
}
