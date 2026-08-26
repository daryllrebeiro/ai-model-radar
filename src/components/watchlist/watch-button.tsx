'use client';

import React from 'react';
import { useWatchlist } from './watchlist-context';
import { Bookmark, Star } from 'lucide-react';

interface WatchButtonProps {
  modelId: string;
  className?: string;
  showText?: boolean;
}

export function WatchButton({ modelId, className = '', showText = false }: WatchButtonProps) {
  const { isWatched, toggleWatch } = useWatchlist();
  const watched = isWatched(modelId);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggleWatch(modelId);
  };

  return (
    <button
      onClick={handleClick}
      title={watched ? 'Remove from Watchlist' : 'Add to Watchlist'}
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all ${
        watched
          ? 'bg-amber-950/80 text-amber-300 border border-amber-500/40 shadow-sm shadow-amber-500/20'
          : 'bg-gray-900/80 text-gray-400 hover:text-gray-200 hover:bg-gray-800 border border-gray-800'
      } ${className}`}
    >
      <Star className={`w-3.5 h-3.5 ${watched ? 'fill-amber-400 text-amber-400' : 'text-gray-400'}`} />
      {showText && <span>{watched ? 'Watching' : 'Watch'}</span>}
    </button>
  );
}
