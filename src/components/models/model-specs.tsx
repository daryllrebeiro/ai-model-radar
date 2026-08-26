import React from 'react';
import { ModelSnapshot } from '@/types/models';
import {
  formatPricePerMillion,
  formatContextLength,
  formatRelativeTime,
  formatExactDate,
} from '@/lib/utils';
import { Cpu, DollarSign, Maximize2, Layers, ExternalLink, Calendar } from 'lucide-react';
import { WatchButton } from '../watchlist/watch-button';

interface ModelSpecsProps {
  model: ModelSnapshot;
}

export function ModelSpecs({ model }: ModelSpecsProps) {
  const specs = [
    {
      label: 'Prompt Price',
      value: formatPricePerMillion(model.price_prompt),
      subtext: model.price_prompt !== null ? `$${model.price_prompt.toFixed(8)} / token` : 'Unknown',
      icon: DollarSign,
      color: 'text-cyan-400',
      bg: 'bg-cyan-500/10 border-cyan-500/20',
    },
    {
      label: 'Completion Price',
      value: formatPricePerMillion(model.price_completion),
      subtext: model.price_completion !== null ? `$${model.price_completion.toFixed(8)} / token` : 'Unknown',
      icon: DollarSign,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10 border-emerald-500/20',
    },
    {
      label: 'Context Window',
      value: formatContextLength(model.context_length),
      subtext: model.context_length ? `${model.context_length.toLocaleString()} tokens` : 'Not specified',
      icon: Maximize2,
      color: 'text-amber-400',
      bg: 'bg-amber-500/10 border-amber-500/20',
    },
    {
      label: 'Modality',
      value: model.modality || 'text->text',
      subtext: 'Input / Output architecture',
      icon: Layers,
      color: 'text-purple-400',
      bg: 'bg-purple-500/10 border-purple-500/20',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Spec Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        {specs.map((s, idx) => {
          const Icon = s.icon;
          return (
            <div
              key={idx}
              className={`p-4 rounded-xl border ${s.bg} bg-[#111827]/80 backdrop-blur-sm`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {s.label}
                </span>
                <Icon className={`w-4 h-4 ${s.color}`} />
              </div>
              <div className="mt-2 text-xl font-bold font-mono text-white">
                {s.value}
              </div>
              <p className="mt-1 text-[11px] text-gray-400 truncate">
                {s.subtext}
              </p>
            </div>
          );
        })}
      </div>

      {/* Action / Link Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-xl border border-gray-800 bg-[#111827]/60">
        <div className="flex items-center gap-2 text-xs text-gray-400 font-mono">
          <Calendar className="w-4 h-4 text-gray-500" />
          <span>Last snapshot recorded: {formatExactDate(model.polled_at)} ({formatRelativeTime(model.polled_at)})</span>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <WatchButton modelId={model.model_id} showText={true} className="py-2 px-3" />
          <a
            href={`https://openrouter.ai/${model.model_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs transition-colors"
          >
            <span>View on OpenRouter</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
