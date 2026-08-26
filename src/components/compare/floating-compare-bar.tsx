'use client';

import React from 'react';
import Link from 'next/link';
import { useCompare } from './compare-context';
import { Scale, X, ArrowRight, Trash2 } from 'lucide-react';

export function FloatingCompareBar() {
  const { selectedModels, removeModel, clearModels } = useCompare();

  if (selectedModels.length === 0) return null;

  const compareHref = `/compare?models=${encodeURIComponent(selectedModels.join(','))}`;

  return (
    <div className="fixed bottom-6 inset-x-0 z-50 flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3 p-3 sm:px-5 sm:py-3.5 rounded-2xl bg-[#0B0F17]/95 border border-cyan-500/50 shadow-2xl shadow-cyan-950/80 backdrop-blur-md max-w-2xl w-full justify-between animate-in slide-in-from-bottom-5 duration-200">
        <div className="flex items-center gap-2 overflow-x-auto py-1 max-w-[65%] sm:max-w-[70%]">
          <div className="flex items-center gap-1.5 text-cyan-400 text-xs font-semibold uppercase tracking-wider shrink-0 pr-1">
            <Scale className="w-4 h-4" />
            <span className="hidden sm:inline">Compare</span>
            <span className="font-mono">({selectedModels.length}/4)</span>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto">
            {selectedModels.map((id) => (
              <span
                key={id}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gray-800/90 border border-gray-700 text-xs text-gray-200 font-mono shrink-0"
              >
                <span className="max-w-[120px] truncate">{id.split('/').pop() || id}</span>
                <button
                  onClick={() => removeModel(id)}
                  className="text-gray-400 hover:text-red-400 transition-colors p-0.5"
                  title="Remove from comparison"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={clearModels}
            className="p-2 rounded-xl text-gray-400 hover:text-gray-200 hover:bg-gray-800/60 transition-colors text-xs flex items-center gap-1"
            title="Clear all"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Clear</span>
          </button>

          <Link
            href={compareHref}
            className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-md shadow-cyan-950"
          >
            <span>Compare Now</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
