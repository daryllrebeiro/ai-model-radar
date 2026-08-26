'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { trackEvent } from '@/lib/analytics';

interface WatchlistContextType {
  watchedIds: Set<string>;
  watchedList: string[];
  isWatched: (modelId: string) => boolean;
  toggleWatch: (modelId: string) => void;
  addMultipleToWatchlist: (ids: string[]) => void;
  watchlistCount: number;
}

const WatchlistContext = createContext<WatchlistContextType>({
  watchedIds: new Set(),
  watchedList: [],
  isWatched: () => false,
  toggleWatch: () => {},
  addMultipleToWatchlist: () => {},
  watchlistCount: 0,
});

const STORAGE_KEY = 'ai_model_radar_watchlist';

export function WatchlistProvider({ children }: { children: React.ReactNode }) {
  const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set());
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setWatchedIds(new Set(parsed));
        }
      }
    } catch (e) {
      console.error('Failed to load watchlist from localStorage:', e);
    }
    setMounted(true);
  }, []);

  const persistWatchlist = (ids: Set<string>) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(ids)));
    } catch (e) {
      console.error('Failed to save watchlist:', e);
    }
  };

  const toggleWatch = (modelId: string) => {
    setWatchedIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) {
        next.delete(modelId);
        trackEvent('watchlist_remove', { modelId });
      } else {
        next.add(modelId);
        trackEvent('watchlist_add', { modelId });
      }
      persistWatchlist(next);
      return next;
    });
  };

  const addMultipleToWatchlist = (ids: string[]) => {
    setWatchedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        next.add(id);
      }
      persistWatchlist(next);
      trackEvent('watchlist_add_batch', { count: ids.length });
      return next;
    });
  };

  const isWatched = (modelId: string) => {
    return mounted && watchedIds.has(modelId);
  };

  return (
    <WatchlistContext.Provider
      value={{
        watchedIds,
        watchedList: mounted ? Array.from(watchedIds) : [],
        isWatched,
        toggleWatch,
        addMultipleToWatchlist,
        watchlistCount: watchedIds.size,
      }}
    >
      {children}
    </WatchlistContext.Provider>
  );
}

export function useWatchlist() {
  return useContext(WatchlistContext);
}
