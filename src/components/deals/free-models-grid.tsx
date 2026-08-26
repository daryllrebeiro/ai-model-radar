'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ModelCurrent } from '@/types/models';
import { formatContextLength, formatRelativeTime } from '@/lib/utils';
import { Gift, Cpu, ChevronRight, Maximize2, Layers } from 'lucide-react';

interface FreeModelsGridProps {
  models: ModelCurrent[];
}

export function FreeModelsGrid({ models }: FreeModelsGridProps) {
  const [search, setSearch] = useState('');

  const filtered = models.filter((m) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      m.name.toLowerCase().includes(q) ||
      m.model_id.toLowerCase().includes(q) ||
      m.provider.toLowerCase().includes(q)
    );
  });

  if (models.length === 0) {
    return (
      <div className="p-8 text-center rounded-xl border border-gray-800 bg-[#111827]/40 text-gray-400 text-sm">
        No 100% free models currently tracked.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-purple-500/10 border border-purple-500/20">
            <Gift className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">
              100% Free AI Models Radar
            </h2>
            <p className="text-xs text-gray-400">
              Active models on OpenRouter with $0.00 prompt & completion rates
            </p>
          </div>
        </div>

        <input
          type="text"
          placeholder="Filter free models..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500/50"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((m) => (
          <div
            key={m.model_id}
            className="group p-4 rounded-xl border border-gray-800 bg-[#111827]/70 hover:bg-gray-800/60 hover:border-purple-500/30 transition-all flex flex-col justify-between"
          >
            <div>
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="text-[11px] font-mono font-medium text-purple-300 bg-purple-950/80 px-2 py-0.5 rounded border border-purple-500/30">
                  {m.provider}
                </span>
                <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/20">
                  $0.00 Free
                </span>
              </div>

              <h3 className="text-sm font-semibold text-white group-hover:text-purple-300 transition-colors">
                {m.name}
              </h3>
              <p className="text-xs font-mono text-gray-400 truncate mt-0.5">
                {m.model_id}
              </p>

              <div className="flex items-center gap-3 mt-3 text-xs text-gray-400 font-mono">
                <span className="flex items-center gap-1">
                  <Maximize2 className="w-3 h-3 text-amber-400" />
                  {formatContextLength(m.context_length)} ctx
                </span>
                <span className="flex items-center gap-1">
                  <Layers className="w-3 h-3 text-cyan-400" />
                  {m.modality || 'text'}
                </span>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-gray-800/80 flex items-center justify-between">
              <span className="text-[11px] font-mono text-gray-400">
                Polled {formatRelativeTime(m.polled_at)}
              </span>
              <Link
                href={`/models/${encodeURIComponent(m.model_id)}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-purple-400 hover:text-purple-300 transition-colors"
              >
                <span>Details</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
