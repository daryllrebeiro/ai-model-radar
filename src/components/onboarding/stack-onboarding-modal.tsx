'use client';

import React, { useState } from 'react';
import { useWatchlist } from '../watchlist/watchlist-context';
import { Layers, Check, X, Sparkles, ArrowRight } from 'lucide-react';
import { trackEvent } from '@/lib/analytics';

export const POPULAR_STACK_PRESETS = [
  { id: 'anthropic/claude-3-7-sonnet', name: 'Claude 3.7 Sonnet', provider: 'Anthropic', category: 'Reasoning & Coding' },
  { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'OpenAI', category: 'Flagship Multimodal' },
  { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', provider: 'DeepSeek', category: 'Open Weights Reasoning' },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', provider: 'DeepSeek', category: 'Cost-Effective General' },
  { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', provider: 'Meta', category: 'Open Frontier' },
  { id: 'qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B', provider: 'Qwen', category: 'Coding & Multilingual' },
  { id: 'anthropic/claude-3-5-haiku', name: 'Claude 3.5 Haiku', provider: 'Anthropic', category: 'Fast & Lightweight' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI', category: 'Low-Latency Economy' },
  { id: 'mistralai/mistral-large-2411', name: 'Mistral Large', provider: 'Mistral', category: 'Enterprise Reasoning' },
];

interface StackOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function StackOnboardingModal({ isOpen, onClose }: StackOnboardingModalProps) {
  const { watchedIds, addMultipleToWatchlist } = useWatchlist();
  const [selected, setSelected] = useState<string[]>(
    watchedIds.size > 0 ? Array.from(watchedIds) : ['anthropic/claude-3-7-sonnet', 'deepseek/deepseek-r1', 'openai/gpt-4o']
  );

  if (!isOpen) return null;

  const toggleSelect = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSave = () => {
    addMultipleToWatchlist(selected);
    trackEvent('onboarding_stack_saved', { count: selected.length });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in-50 duration-200">
      <div className="relative w-full max-w-2xl rounded-3xl border border-gray-700 bg-[#0B0F17] shadow-2xl p-6 sm:p-8 space-y-6 max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-xl text-gray-400 hover:text-white hover:bg-gray-800/80 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="space-y-2 text-left">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/80 border border-cyan-700/60 text-cyan-400 text-xs font-mono">
            <Layers className="w-3.5 h-3.5" />
            <span>PERSONALIZED RADAR ONBOARDING</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white">
            What models are in your stack?
          </h2>
          <p className="text-xs sm:text-sm text-gray-400 leading-relaxed">
            Select the models and APIs you use today. We&apos;ll automatically prioritize price drops, context expansions, and provider arbitrage for your stack.
          </p>
        </div>

        {/* Model Multi-Select Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          {POPULAR_STACK_PRESETS.map((preset) => {
            const isSelected = selected.includes(preset.id);
            return (
              <button
                key={preset.id}
                onClick={() => toggleSelect(preset.id)}
                type="button"
                className={`p-3.5 rounded-2xl border text-left transition-all flex items-start justify-between gap-3 ${
                  isSelected
                    ? 'bg-cyan-950/60 border-cyan-500 shadow-md shadow-cyan-950/50'
                    : 'bg-[#111827]/80 hover:bg-gray-800/60 border-gray-800'
                }`}
              >
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white truncate">{preset.name}</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-gray-800 text-gray-300">
                      {preset.provider}
                    </span>
                  </div>
                  <div className="text-[11px] text-gray-400 truncate font-mono">
                    {preset.category}
                  </div>
                </div>

                <div
                  className={`w-5 h-5 rounded-lg flex items-center justify-center shrink-0 border transition-all mt-0.5 ${
                    isSelected
                      ? 'bg-cyan-500 border-cyan-400 text-[#0B0F17]'
                      : 'border-gray-700 bg-gray-900 text-transparent'
                  }`}
                >
                  <Check className="w-3.5 h-3.5 stroke-[3]" />
                </div>
              </button>
            );
          })}
        </div>

        {/* Actions Footer */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-gray-800">
          <div className="text-xs font-mono text-gray-400">
            <strong className="text-cyan-400">{selected.length}</strong> models selected for your stack
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={onClose}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-gray-700 hover:bg-gray-800 text-xs font-semibold text-gray-300 transition-colors uppercase font-mono"
            >
              Skip
            </button>
            <button
              onClick={handleSave}
              className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-lg shadow-cyan-950"
            >
              <span>Save My Stack</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
