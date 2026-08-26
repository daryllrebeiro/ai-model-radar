'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { ModelEvent, EventType } from '@/types/events';
import { FilterBar } from './filter-bar';
import { EventCard } from './event-card';
import { extractProvider } from '@/lib/utils';
import { Radio, AlertCircle } from 'lucide-react';
import { useWatchlist } from '../watchlist/watchlist-context';

interface EventFeedProps {
  initialEvents: ModelEvent[];
}

export function EventFeed({ initialEvents }: EventFeedProps) {
  const searchParams = useSearchParams();
  const { isWatched } = useWatchlist();

  const [events, setEvents] = useState<ModelEvent[]>(initialEvents);
  const [selectedType, setSelectedType] = useState<EventType | 'ALL'>('ALL');
  const [selectedProvider, setSelectedProvider] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [freeOnly, setFreeOnly] = useState<boolean>(false);
  const [watchedOnly, setWatchedOnly] = useState<boolean>(false);
  const [page, setPage] = useState<number>(1);
  const PAGE_SIZE = 20;

  // Read URL query parameter on load if ?watchlist=true
  useEffect(() => {
    if (searchParams.get('watchlist') === 'true') {
      setWatchedOnly(true);
    }
  }, [searchParams]);

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

      // 4. Watched Only
      if (watchedOnly && !isWatched(e.model_id)) {
        return false;
      }

      // 5. Search Query
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
  }, [events, selectedType, selectedProvider, freeOnly, watchedOnly, searchQuery, isWatched]);

  const paginatedEvents = useMemo(() => {
    return filteredEvents.slice(0, page * PAGE_SIZE);
  }, [filteredEvents, page]);

  const hasMore = paginatedEvents.length < filteredEvents.length;

  const loadMore = () => {
    setPage((prev) => prev + 1);
  };

  return (
    <div className="space-y-6">
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
        watchedOnly={watchedOnly}
        onToggleWatchedOnly={() => {
          setWatchedOnly((w) => !w);
          setPage(1);
        }}
        providers={providers}
      />

      {/* Feed Stats / Filter Count Header */}
      <div className="flex items-center justify-between text-xs text-gray-400 font-mono px-1">
        <div className="flex items-center gap-2">
          <Radio className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
          <span>
            Showing <strong className="text-white">{paginatedEvents.length}</strong> of{' '}
            <strong className="text-white">{filteredEvents.length}</strong> events
          </span>
        </div>
        {(selectedType !== 'ALL' || selectedProvider !== 'All' || freeOnly || watchedOnly || searchQuery) && (
          <button
            onClick={() => {
              setSelectedType('ALL');
              setSelectedProvider('All');
              setFreeOnly(false);
              setWatchedOnly(false);
              setSearchQuery('');
              setPage(1);
            }}
            className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Event Cards Stream */}
      {paginatedEvents.length > 0 ? (
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
            {watchedOnly
              ? 'You have not starred any models yet or no events match your watched models. Click the star icon on any card to add models to your watchlist!'
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
    </div>
  );
}
