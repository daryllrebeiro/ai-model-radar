'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Radio,
  Activity,
  Tag,
  Scale,
  Award,
  Calculator,
  AlertTriangle,
  GitBranch,
  Users,
  Bell,
  Code2,
  Rss,
  Star,
  Search,
} from 'lucide-react';
import { useWatchlist } from './watchlist/watchlist-context';
import { CommandSearchModal } from './CommandSearchModal';

export function Navbar() {
  const pathname = usePathname();
  const { watchlistCount } = useWatchlist();
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const mainNavItems = [
    { name: 'Feed', href: '/', icon: Activity },
    { name: 'Compare', href: '/compare', icon: Scale },
    { name: 'Deals', href: '/deals', icon: Tag },
    { name: 'Arbitrage', href: '/arbitrage', icon: Scale },
    { name: 'Benchmarks', href: '/benchmarks', icon: Award },
    { name: 'Advisor', href: '/advisor', icon: Calculator },
    { name: 'Signals', href: '/signals', icon: AlertTriangle },
    { name: 'Labs', href: '/labs', icon: GitBranch },
    { name: 'Community', href: '/community', icon: Users },
    { name: 'Alerts', href: '/alerts', icon: Bell },
    { name: 'API Docs', href: '/docs', icon: Code2 },
  ];

  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b border-gray-800/80 bg-[#0B0F17]/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Brand */}
          <div className="flex items-center gap-4 lg:gap-6">
            <Link href="/" className="flex items-center gap-2 group flex-shrink-0">
              <div className="relative flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500/20 to-emerald-500/20 border border-cyan-500/30 group-hover:border-cyan-400/60 transition-all duration-300">
                <Radio className="w-4 h-4 text-cyan-400 group-hover:scale-110 transition-transform duration-300" />
                <span className="absolute -top-1 -right-1 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-base tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-gray-100 to-gray-400">
                    AI Model Radar
                  </span>
                  <span className="text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-cyan-950/60 border border-cyan-800 text-cyan-400 font-semibold">
                    v4.0
                  </span>
                </div>
              </div>
            </Link>

            {/* Navigation Links */}
            <nav className="hidden xl:flex items-center gap-1 overflow-x-auto">
              {mainNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                      isActive
                        ? 'bg-gray-800 text-cyan-400 border border-gray-700'
                        : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{item.name}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-2">
            {/* Search Palette Button */}
            <button
              onClick={() => setSearchOpen(true)}
              aria-label="Search models and pages"
              className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-200 bg-gray-900/90 hover:bg-gray-800/80 border border-gray-800 px-2.5 py-1.5 rounded-lg transition-all font-mono"
            >
              <Search className="w-3.5 h-3.5 text-cyan-400" />
              <span className="hidden sm:inline text-[11px]">Search...</span>
              <kbd className="hidden sm:inline text-[10px] px-1 py-0.2 rounded bg-gray-800 border border-gray-700 text-gray-400">
                ⌘K
              </kbd>
            </button>

            {/* Watchlist Counter */}
            {watchlistCount > 0 && (
              <Link
                href="/?watchlist=true"
                className="flex items-center gap-1.5 text-xs font-mono text-amber-300 bg-amber-950/60 border border-amber-500/40 px-2 py-1 rounded-full hover:bg-amber-900/60 transition-all"
              >
                <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                <span>{watchlistCount}</span>
              </Link>
            )}

            {/* RSS Link */}
            <a
              href="/feed.xml"
              target="_blank"
              rel="noopener noreferrer"
              title="RSS Feed"
              className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 bg-amber-950/30 hover:bg-amber-900/40 border border-amber-800/50 px-2 py-1 rounded-lg transition-all"
            >
              <Rss className="w-3 h-3" />
              <span className="hidden sm:inline text-[11px] font-mono">RSS</span>
            </a>

            {/* Quick OpenRouter link */}
            <a
              href="https://openrouter.ai/models"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1 text-xs text-gray-300 hover:text-white bg-gray-800/80 hover:bg-gray-700/80 border border-gray-700 px-2.5 py-1 rounded-lg transition-all font-mono text-[11px]"
            >
              <span>OpenRouter</span>
            </a>
          </div>
        </div>
      </header>

      {/* Global Command Search Modal */}
      <CommandSearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
