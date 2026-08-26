'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ModelEvent } from '@/types/events';
import {
  getEventSummary,
  getEventTypeBadgeConfig,
  formatRelativeTime,
  formatExactDate,
} from '@/lib/utils';
import {
  TrendingDown,
  TrendingUp,
  Sparkles,
  Gift,
  LogOut,
  Maximize2,
  Trash2,
  ChevronRight,
  Copy,
  Check,
  Cpu,
} from 'lucide-react';
import { WatchButton } from '../watchlist/watch-button';

interface EventCardProps {
  event: ModelEvent;
}

export function EventCard({ event }: EventCardProps) {
  const [copied, setCopied] = useState(false);
  const badge = getEventTypeBadgeConfig(event.event_type);
  const summary = getEventSummary(event);

  const copyId = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(event.model_id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getEventIcon = () => {
    switch (event.event_type) {
      case 'NEW_MODEL':
        return <Sparkles className="w-4 h-4 text-cyan-400" />;
      case 'PRICE_CHANGE':
        return summary.isDrop ? (
          <TrendingDown className="w-4 h-4 text-emerald-400" />
        ) : (
          <TrendingUp className="w-4 h-4 text-rose-400" />
        );
      case 'BECAME_FREE':
        return <Gift className="w-4 h-4 text-purple-400" />;
      case 'LEFT_FREE':
        return <LogOut className="w-4 h-4 text-rose-400" />;
      case 'CONTEXT_CHANGED':
        return <Maximize2 className="w-4 h-4 text-amber-400" />;
      case 'MODEL_REMOVED':
        return <Trash2 className="w-4 h-4 text-gray-400" />;
    }
  };

  return (
    <div className="group relative rounded-xl border border-gray-800 bg-[#111827]/80 hover:bg-gray-800/60 transition-all duration-200 p-4 sm:p-5 hover:border-gray-700 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        {/* Left: Icon & Main details */}
        <div className="flex items-start gap-3.5 flex-1 min-w-0">
          <div className="mt-0.5 flex-shrink-0 w-9 h-9 rounded-lg bg-gray-900/90 border border-gray-800 flex items-center justify-center group-hover:scale-105 transition-transform">
            {getEventIcon()}
          </div>

          <div className="flex-1 min-w-0">
            {/* Badges & Meta */}
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-semibold border ${badge.badgeClass}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${badge.dotClass}`} />
                {badge.label}
              </span>

              {event.provider && (
                <span className="inline-flex items-center gap-1 text-[11px] font-mono text-gray-400 bg-gray-900/80 px-2 py-0.5 rounded border border-gray-800">
                  <Cpu className="w-3 h-3 text-gray-400" />
                  {event.provider}
                </span>
              )}

              {event.pct_change !== null && event.pct_change !== undefined && (
                <span
                  className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                    event.pct_change < 0
                      ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/30'
                      : 'bg-rose-950/80 text-rose-300 border border-rose-500/30'
                  }`}
                >
                  {event.pct_change < 0 ? '' : '+'}
                  {event.pct_change}%
                </span>
              )}
            </div>

            {/* Model Name & Title */}
            <h3 className="text-base font-semibold text-white tracking-tight group-hover:text-cyan-400 transition-colors">
              {summary.title}
            </h3>

            {/* Model ID Sub-row with copy button & watch button */}
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs font-mono text-gray-400 truncate">
                {event.model_id}
              </span>
              <button
                onClick={copyId}
                title="Copy Model ID"
                className="text-gray-500 hover:text-gray-300 p-0.5 rounded hover:bg-gray-800 transition-colors"
              >
                {copied ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            </div>

            {/* Event Specific Subtitle Description */}
            <p className="mt-2 text-sm text-gray-300 font-mono text-[13px] bg-gray-900/60 p-2.5 rounded-lg border border-gray-800/80">
              {summary.subtitle}
            </p>
          </div>
        </div>

        {/* Right: Timestamp & Action Link & Watch Button */}
        <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 self-end sm:self-start pt-2 sm:pt-0 border-t sm:border-t-0 border-gray-800 w-full sm:w-auto">
          <div className="flex items-center gap-2">
            <WatchButton modelId={event.model_id} />
            <span
              className="text-xs font-mono text-gray-400 block cursor-help"
              title={formatExactDate(event.detected_at)}
            >
              {formatRelativeTime(event.detected_at)}
            </span>
          </div>

          <Link
            href={`/models/${encodeURIComponent(event.model_id)}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-cyan-400 hover:text-cyan-300 bg-cyan-950/40 hover:bg-cyan-900/50 border border-cyan-800/50 px-2.5 py-1 rounded-lg transition-all"
          >
            <span>Model Details</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
