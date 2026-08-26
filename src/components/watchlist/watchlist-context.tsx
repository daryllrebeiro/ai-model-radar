'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

interface WatchlistContextType {
  watchedIds: Set<string>;
  isWatched: (modelId: string) => boolean;
  toggleWatch: (modelId: string) => void;
  watchlistCount: number;
}

const WatchlistContext = createContext<WatchlistContextType>({
  watchedIds: new Set(),
  isWatched: () => false,
  toggleWatch: () => {},
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

  const toggleWatch = (modelId: string) => {
    setWatchedIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) {
        next.delete(modelId);
      } else {
        next.add(modelId);
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch (e) {
        console.error('Failed to save watchlist:', e);
      }
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
        isWatched,
        toggleWatch,
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
