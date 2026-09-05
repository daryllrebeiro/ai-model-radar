'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { ModelEvent, EventType } from '@/types/events';
import { FilterBar } from './filter-bar';
import { EventCard } from './event-card';
import { extractProvider } from '@/lib/utils';
import { Radio, AlertCircle, Layers, Globe, Settings, Plus, Sparkles } from 'lucide-react';
import { useWatchlist } from '../watchlist/watchlist-context';
import { StackOnboardingModal, POPULAR_STACK_PRESETS } from '../onboarding/stack-onboarding-modal';
import { trackEvent } from '@/lib/analytics';

interface EventFeedProps {
  initialEvents: ModelEvent[];
}

export function EventFeed({ initialEvents }: EventFeedProps) {
  const searchParams = useSearchParams();
  const { isWatched, watchlistCount, addMultipleToWatchlist } = useWatchlist();

  const [activeTab, setActiveTab] = useState<'stack' | 'global'>('global');
  const [hasInitializedTab, setHasInitializedTab] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);

  const [events] = useState<ModelEvent[]>(initialEvents);
  const [selectedType, setSelectedType] = useState<EventType | 'ALL'>('ALL');
  const [selectedProvider, setSelectedProvider] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [freeOnly, setFreeOnly] = useState<boolean>(false);
  const [page, setPage] = useState<number>(1);
  const PAGE_SIZE = 20;

  // Set default tab on initial mount based on watchlist status
  useEffect(() => {
    if (!hasInitializedTab) {
      if (searchParams.get('tab') === 'stack' || searchParams.get('watchlist') === 'true') {
        setActiveTab('stack');
      } else if (watchlistCount > 0) {
        setActiveTab('stack');
      }
      setHasInitializedTab(true);
    }
  }, [watchlistCount, searchParams, hasInitializedTab]);

  // Extract distinct providers for the dropdown
  const providers = useMemo(() => {
    const set = new Set<string>();
    for (const e of initialEvents) {
      if (e.provider) set.add(e.provider);
      else set.add(extractProvider(e.model_id));
    }
    return Array.from(set).sort();
  }, [initialEvents]);

  // Client-side filtering for fast responsive UI
  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      // 0. Active Tab (My Stack vs Global)
      if (activeTab === 'stack' && !isWatched(e.model_id)) {
        return false;
      }

      // 1. Event Type
      if (selectedType !== 'ALL' && e.event_type !== selectedType) {
        return false;
      }

      // 2. Provider
      if (selectedProvider !== 'All') {
        const prov = e.provider || extractProvider(e.model_id);
        if (prov.toLowerCase() !== selectedProvider.toLowerCase()) {
          return false;
        }
      }

      // 3. Free Only
      if (freeOnly) {
        const isFreeEvent =
          e.event_type === 'BECAME_FREE' ||
          (e.new_value && e.new_value.is_free === true);
        if (!isFreeEvent) return false;
      }

      // 4. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesId = e.model_id.toLowerCase().includes(q);
        const matchesName = e.model_name?.toLowerCase().includes(q);
        const matchesProvider = e.provider?.toLowerCase().includes(q);
        if (!matchesId && !matchesName && !matchesProvider) {
          return false;
        }
      }

      return true;
    });
  }, [events, activeTab, selectedType, selectedProvider, freeOnly, searchQuery, isWatched]);

  const paginatedEvents = useMemo(() => {
    return filteredEvents.slice(0, page * PAGE_SIZE);
  }, [filteredEvents, page]);

  const hasMore = paginatedEvents.length < filteredEvents.length;

  const loadMore = () => {
    setPage((prev) => prev + 1);
  };

  const handleQuickAdd = (modelId: string) => {
    addMultipleToWatchlist([modelId]);
  };

  return (
    <div className="space-y-6">
      {/* Top Feed Mode Switcher (My Stack vs Global Feed) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-2 bg-[#111827]/70 backdrop-blur-md rounded-2xl border border-gray-800">
        <div className="flex items-center gap-1.5 p-1 bg-gray-950/80 rounded-xl border border-gray-800/80 w-full sm:w-auto">
          <button
            onClick={() => {
              setActiveTab('stack');
              setPage(1);
              trackEvent('tab_change', { tab: 'stack' });
            }}
            className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-mono font-semibold transition-all ${
              activeTab === 'stack'
                ? 'bg-cyan-600 text-white shadow-md shadow-cyan-950'
                : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>My Stack</span>
            {watchlistCount > 0 && (
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                activeTab === 'stack' ? 'bg-cyan-950 text-cyan-200' : 'bg-gray-800 text-gray-400'
              }`}>
                {watchlistCount}
              </span>
            )}
          </button>

          <button
            onClick={() => {
              setActiveTab('global');
              setPage(1);
              trackEvent('tab_change', { tab: 'global' });
            }}
            className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-mono font-semibold transition-all ${
              activeTab === 'global'
                ? 'bg-cyan-600 text-white shadow-md shadow-cyan-950'
                : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Global Feed</span>
          </button>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-2 px-2">
          {activeTab === 'stack' && (
            <button
              onClick={() => setIsOnboardingOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-700 bg-gray-900/80 hover:bg-gray-800 text-xs font-mono text-cyan-400 hover:text-cyan-300 transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Customize Stack</span>
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <FilterBar
        selectedType={selectedType}
        onSelectType={(t) => {
          setSelectedType(t);
          setPage(1);
        }}
        selectedProvider={selectedProvider}
        onSelectProvider={(p) => {
          setSelectedProvider(p);
          setPage(1);
        }}
        searchQuery={searchQuery}
        onSearchChange={(q) => {
          setSearchQuery(q);
          setPage(1);
        }}
        freeOnly={freeOnly}
        onToggleFreeOnly={() => {
          setFreeOnly((f) => !f);
          setPage(1);
        }}
        watchedOnly={false}
        onToggleWatchedOnly={() => {}}
        providers={providers}
      />

      {/* Feed Stats / Filter Count Header */}
      <div className="flex items-center justify-between text-xs text-gray-400 font-mono px-1">
        <div className="flex items-center gap-2">
          <Radio className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
          <span>
            {activeTab === 'stack' ? 'My Stack Feed: ' : 'Global Market Feed: '}
            Showing <strong className="text-white">{paginatedEvents.length}</strong> of{' '}
            <strong className="text-white">{filteredEvents.length}</strong> events
          </span>
        </div>
        {(selectedType !== 'ALL' || selectedProvider !== 'All' || freeOnly || searchQuery) && (
          <button
            onClick={() => {
              setSelectedType('ALL');
              setSelectedProvider('All');
              setFreeOnly(false);
              setSearchQuery('');
              setPage(1);
            }}
            className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Empty State for My Stack with 0 items */}
      {activeTab === 'stack' && watchlistCount === 0 ? (
        <div className="p-8 sm:p-10 text-center rounded-3xl border border-gray-800 bg-[#111827]/70 backdrop-blur-sm space-y-5">
          <div className="w-12 h-12 rounded-2xl bg-cyan-950/80 border border-cyan-700/60 flex items-center justify-center mx-auto text-cyan-400">
            <Layers className="w-6 h-6" />
          </div>
          <div className="space-y-2 max-w-md mx-auto">
            <h3 className="text-xl font-bold text-white tracking-tight">
              Personalize Your AI Stack
            </h3>
            <p className="text-xs sm:text-sm text-gray-400 leading-relaxed">
              Track the exact models and providers you use in production. We&apos;ll monitor price drops, context increases, and outages for your stack.
            </p>
          </div>

          {/* Quick-add popular models */}
          <div className="pt-2">
            <div className="text-[11px] font-mono uppercase tracking-wider text-gray-400 mb-3">
              Quick Pick Models to Track
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 max-w-xl mx-auto">
              {POPULAR_STACK_PRESETS.slice(0, 6).map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => handleQuickAdd(preset.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-700 bg-gray-900/90 hover:bg-cyan-950/60 hover:border-cyan-500/60 text-xs font-mono text-gray-200 hover:text-cyan-300 transition-all"
                >
                  <Plus className="w-3 h-3 text-cyan-400" />
                  <span>{preset.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-gray-800/80 flex justify-center">
            <button
              onClick={() => setIsOnboardingOpen(true)}
              className="px-6 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-mono font-semibold uppercase tracking-wider transition-all shadow-md shadow-cyan-950 flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              <span>Open Stack Setup Modal</span>
            </button>
          </div>
        </div>
      ) : paginatedEvents.length > 0 ? (
        /* Event Cards Stream */
        <div className="space-y-3">
          {paginatedEvents.map((event, idx) => (
            <EventCard key={event.id || `${event.model_id}-${event.detected_at}-${idx}`} event={event} />
          ))}
        </div>
      ) : (
        <div className="p-12 text-center rounded-2xl border border-gray-800 bg-[#111827]/40">
          <AlertCircle className="w-8 h-8 text-gray-500 mx-auto mb-3" />
          <h4 className="text-base font-semibold text-gray-200">No matching market events</h4>
          <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
            {activeTab === 'stack'
              ? 'No recent market changes detected for your selected stack models. Switch to Global Feed or add more models to your stack!'
              : 'Try adjusting your search terms or filter criteria to see older model events.'}
          </p>
        </div>
      )}

      {/* Load More Button */}
      {hasMore && (
        <div className="text-center pt-2">
          <button
            onClick={loadMore}
            className="px-6 py-2.5 rounded-xl text-xs font-semibold uppercase tracking-wider bg-gray-900 hover:bg-gray-800 border border-gray-700 text-gray-200 hover:text-white transition-all shadow-sm"
          >
            Load More Events ({filteredEvents.length - paginatedEvents.length} remaining)
          </button>
        </div>
      )}

      {/* Stack Onboarding Modal */}
      <StackOnboardingModal
        isOpen={isOnboardingOpen}
        onClose={() => setIsOnboardingOpen(false)}
      />
    </div>
  );
}
