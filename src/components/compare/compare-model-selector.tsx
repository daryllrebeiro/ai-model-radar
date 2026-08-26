'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X, Search, Scale } from 'lucide-react';
import { useCompare } from './compare-context';

interface ModelOption {
  id: string;
  name: string;
  provider: string;
  pricePrompt: number | null;
  priceComp: number | null;
}

interface CompareModelSelectorProps {
  availableModels: ModelOption[];
  selectedIds: string[];
}

export function CompareModelSelector({
  availableModels,
  selectedIds,
}: CompareModelSelectorProps) {
  const router = useRouter();
  const { addModel, removeModel } = useCompare();
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const filtered = availableModels.filter(
    (m) =>
      !selectedIds.includes(m.id) &&
      (m.name.toLowerCase().includes(query.toLowerCase()) ||
        m.id.toLowerCase().includes(query.toLowerCase()) ||
        m.provider.toLowerCase().includes(query.toLowerCase()))
  );

  const handleSelect = (id: string) => {
    if (selectedIds.length >= 4) {
      alert('You can compare up to 4 models.');
      return;
    }
    const next = [...selectedIds, id];
    addModel(id);
    setQuery('');
    setIsOpen(false);
    router.push(`/compare?models=${encodeURIComponent(next.join(','))}`);
  };

  const handleRemove = (id: string) => {
    const next = selectedIds.filter((item) => item !== id);
    removeModel(id);
    if (next.length > 0) {
      router.push(`/compare?models=${encodeURIComponent(next.join(','))}`);
    } else {
      router.push('/compare');
    }
  };

  return (
    <div className="p-4 rounded-2xl border border-gray-800 bg-[#0B0F17]/90 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-mono text-gray-400 font-semibold uppercase">
            Active Comparison ({selectedIds.length}/4):
          </span>

          {selectedIds.length === 0 ? (
            <span className="text-xs font-mono text-gray-500 italic">No models selected</span>
          ) : (
            selectedIds.map((id) => (
              <span
                key={id}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-xl bg-cyan-950/70 border border-cyan-700/60 text-xs font-mono text-cyan-300"
              >
                <span>{id.split('/').pop() || id}</span>
                <button
                  onClick={() => handleRemove(id)}
                  className="p-0.5 text-cyan-400 hover:text-red-400 transition-colors"
                  title="Remove"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            ))
          )}
        </div>

        {selectedIds.length < 4 && (
          <div className="relative">
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="px-3 py-1.5 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 text-xs font-semibold text-gray-200 hover:text-white flex items-center gap-1.5 font-mono transition-colors"
            >
              <Plus className="w-3.5 h-3.5 text-cyan-400" />
              <span>Add Model</span>
            </button>

            {isOpen && (
              <div className="absolute right-0 mt-2 w-80 max-h-80 rounded-2xl bg-[#111827] border border-gray-700 shadow-2xl z-50 p-2 space-y-2 overflow-hidden animate-in fade-in-50 zoom-in-95">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search model name or provider..."
                    className="w-full pl-9 pr-3 py-2 text-xs bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500 font-mono"
                    autoFocus
                  />
                </div>

                <div className="max-h-60 overflow-y-auto space-y-1">
                  {filtered.length === 0 ? (
                    <div className="p-3 text-center text-xs text-gray-500 font-mono">
                      No matching models found
                    </div>
                  ) : (
                    filtered.slice(0, 15).map((m) => (
                      <button
                        key={m.id}
                        onClick={() => handleSelect(m.id)}
                        className="w-full text-left p-2 rounded-lg hover:bg-gray-800/80 transition-colors flex items-center justify-between text-xs font-mono"
                      >
                        <div className="truncate pr-2">
                          <div className="text-gray-200 font-bold truncate">{m.name}</div>
                          <div className="text-[10px] text-gray-400 truncate">{m.provider} • {m.id}</div>
                        </div>
                        <Plus className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
