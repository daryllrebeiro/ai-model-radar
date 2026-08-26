'use client';

import React from 'react';
import { MarketStats } from '@/types/events';
import { TrendingDown, Sparkles, Gift, Cpu, Clock } from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils';

interface MarketStatsBannerProps {
  stats: MarketStats | null;
}

export function MarketStatsBanner({ stats }: MarketStatsBannerProps) {
  if (!stats) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-pulse">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 bg-gray-900/60 rounded-xl border border-gray-800" />
        ))}
      </div>
    );
  }

  const statItems = [
    {
      label: 'Tracked Models',
      value: stats.totalActiveModels.toLocaleString(),
      subtext: `across ${stats.totalProviders} providers`,
      icon: Cpu,
      color: 'text-cyan-400',
      bg: 'bg-cyan-500/10 border-cyan-500/20',
    },
    {
      label: 'Price Cuts (7d)',
      value: stats.priceDrops7d.toString(),
      subtext: `${stats.priceDrops24h} in the last 24h`,
      icon: TrendingDown,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10 border-emerald-500/20',
    },
    {
      label: 'Free Tier Models',
      value: stats.totalFreeModels.toString(),
      subtext: 'active at $0 / token',
      icon: Gift,
      color: 'text-purple-400',
      bg: 'bg-purple-500/10 border-purple-500/20',
    },
    {
      label: 'New Releases (7d)',
      value: stats.newModels7d.toString(),
      subtext: `last polled ${formatRelativeTime(stats.lastPolledAt)}`,
      icon: Sparkles,
      color: 'text-amber-400',
      bg: 'bg-amber-500/10 border-amber-500/20',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
      {statItems.map((item, idx) => {
        const Icon = item.icon;
        return (
          <div
            key={idx}
            className={`p-4 rounded-xl border ${item.bg} bg-[#111827]/70 backdrop-blur-sm transition-all hover:scale-[1.01]`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-400 tracking-wide uppercase">
                {item.label}
              </span>
              <Icon className={`w-4 h-4 ${item.color}`} />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-white tracking-tight">
                {item.value}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-gray-400 truncate">
              {item.subtext}
            </p>
          </div>
        );
      })}
    </div>
  );
}
