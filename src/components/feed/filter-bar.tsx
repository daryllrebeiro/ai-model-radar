'use client';

import React from 'react';
import { EventType } from '@/types/events';
import { Search, Sparkles, TrendingDown, Gift, LogOut, Maximize2, Trash2, Filter, Star } from 'lucide-react';
import { useWatchlist } from '../watchlist/watchlist-context';

interface FilterBarProps {
  selectedType: EventType | 'ALL';
  onSelectType: (type: EventType | 'ALL') => void;
  selectedProvider: string;
  onSelectProvider: (provider: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  freeOnly: boolean;
  onToggleFreeOnly: () => void;
  watchedOnly: boolean;
  onToggleWatchedOnly: () => void;
  providers: string[];
}

export function FilterBar({
  selectedType,
  onSelectType,
  selectedProvider,
  onSelectProvider,
  searchQuery,
  onSearchChange,
  freeOnly,
  onToggleFreeOnly,
  watchedOnly,
  onToggleWatchedOnly,
  providers,
}: FilterBarProps) {
  const { watchlistCount } = useWatchlist();

  const eventTypes: Array<{
    type: EventType | 'ALL';
    label: string;
    icon: React.ElementType;
    color: string;
  }> = [
    { type: 'ALL', label: 'All Events', icon: Filter, color: 'text-gray-300' },
    { type: 'PRICE_CHANGE', label: 'Price Changes', icon: TrendingDown, color: 'text-emerald-400' },
    { type: 'BECAME_FREE', label: 'Became Free', icon: Gift, color: 'text-purple-400' },
    { type: 'NEW_MODEL', label: 'New Models', icon: Sparkles, color: 'text-cyan-400' },
    { type: 'CONTEXT_CHANGED', label: 'Context Diffs', icon: Maximize2, color: 'text-amber-400' },
    { type: 'LEFT_FREE', label: 'Left Free', icon: LogOut, color: 'text-rose-400' },
    { type: 'MODEL_REMOVED', label: 'Delisted', icon: Trash2, color: 'text-gray-400' },
  ];

  return (
    <div className="space-y-4">
      {/* Search & Provider Row */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by model name, provider (e.g. Claude, DeepSeek, OpenAI)..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full bg-gray-900/90 border border-gray-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/30 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded bg-gray-800"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          {/* Provider Dropdown */}
          <select
            value={selectedProvider}
            onChange={(e) => onSelectProvider(e.target.value)}
            className="bg-gray-900/90 border border-gray-800 text-sm text-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-cyan-500/60 transition-colors"
          >
            <option value="All">All Providers</option>
            {providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          {/* Watched Toggle */}
          <button
            onClick={onToggleWatchedOnly}
            className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
              watchedOnly
                ? 'bg-amber-950/80 border-amber-500/50 text-amber-300 shadow-sm shadow-amber-500/20'
                : 'bg-gray-900/90 border-gray-800 text-gray-400 hover:text-gray-200 hover:border-gray-700'
            }`}
          >
            <Star className={`w-4 h-4 ${watchedOnly ? 'fill-amber-400 text-amber-400' : ''}`} />
            <span className="whitespace-nowrap">Watched ({watchlistCount})</span>
          </button>

          {/* Free Only Toggle */}
          <button
            onClick={onToggleFreeOnly}
            className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
              freeOnly
                ? 'bg-purple-950/70 border-purple-500/50 text-purple-300 shadow-sm shadow-purple-500/20'
                : 'bg-gray-900/90 border-gray-800 text-gray-400 hover:text-gray-200 hover:border-gray-700'
            }`}
          >
            <Gift className="w-4 h-4" />
            <span className="whitespace-nowrap">Free Only</span>
          </button>
        </div>
      </div>

      {/* Event Type Filter Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs">
        {eventTypes.map((item) => {
          const Icon = item.icon;
          const isSelected = selectedType === item.type;
          return (
            <button
              key={item.type}
              onClick={() => onSelectType(item.type)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-medium whitespace-nowrap transition-all ${
                isSelected
                  ? 'bg-gray-800 border-cyan-500/50 text-white shadow-sm shadow-cyan-500/10'
                  : 'bg-gray-900/60 border-gray-800/80 text-gray-400 hover:text-gray-200 hover:bg-gray-800/40'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${item.color}`} />
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
