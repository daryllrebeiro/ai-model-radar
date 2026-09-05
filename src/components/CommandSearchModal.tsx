'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Search, ArrowRight, X, Layers, Cpu } from 'lucide-react';
import { trackEvent } from '@/lib/analytics';

interface SearchResult {
  id: string;
  name: string;
  category: 'model' | 'page';
  url: string;
  subtitle?: string;
  badge?: string;
}

const STATIC_PAGES: SearchResult[] = [
  { id: 'feed', name: 'Live Intelligence Feed', category: 'page', url: '/', subtitle: 'Real-time price changes & context updates' },
  { id: 'deals', name: 'Free & Budget Models', category: 'page', url: '/deals', subtitle: 'Zero-cost inference & top discounted models' },
  { id: 'arbitrage', name: 'Price Arbitrage Engine', category: 'page', url: '/arbitrage', subtitle: 'Same model across different provider endpoints' },
  { id: 'benchmarks', name: 'Benchmark Leaderboard', category: 'page', url: '/benchmarks', subtitle: 'MMLU, HumanEval, and LMSYS Elo standings' },
  { id: 'advisor', name: 'Cost Optimization Advisor', category: 'page', url: '/advisor', subtitle: 'Calculate savings by switching model tiers' },
  { id: 'signals', name: 'Market Outliers & MAD Anomalies', category: 'page', url: '/signals', subtitle: 'Statistical deviation price detector' },
  { id: 'labs', name: 'Lab Commit Activity', category: 'page', url: '/labs', subtitle: 'GitHub commits across top AI research labs' },
  { id: 'community', name: 'Community Insights & Radar', category: 'page', url: '/community', subtitle: 'Community trending models and feedback' },
  { id: 'alerts', name: 'Custom Alert Rules', category: 'page', url: '/alerts', subtitle: 'Configure webhooks and email digests' },
  { id: 'docs', name: 'Developer API Docs', category: 'page', url: '/docs', subtitle: 'REST API v1 reference & authentication' },
  { id: 'contact', name: 'Contact & Engineering Support', category: 'page', url: '/contact', subtitle: 'Technical support and vulnerability reports' },
  { id: 'privacy', name: 'Privacy Policy (GDPR)', category: 'page', url: '/privacy', subtitle: 'Data rights and sub-processor disclosures' },
];

export function CommandSearchModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>(STATIC_PAGES);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      trackEvent('search_modal_opened');
    } else {
      setQuery('');
      setResults(STATIC_PAGES);
      setSelectedIndex(0);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!query.trim()) {
      setResults(STATIC_PAGES);
      return;
    }

    const q = query.toLowerCase();
    const pageMatches = STATIC_PAGES.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.subtitle && p.subtitle.toLowerCase().includes(q))
    );

    // Fetch dynamic model matches
    const controller = new AbortController();
    setLoading(true);

    fetch(`/api/v1/models?limit=100`, { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => {
        if (data.data && Array.isArray(data.data)) {
          const modelMatches: SearchResult[] = data.data
            .filter((m: any) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
            .slice(0, 8)
            .map((m: any) => ({
              id: m.id,
              name: m.name || m.id,
              category: 'model' as const,
              url: `/models/${m.id}`,
              subtitle: `Context: ${(m.context_length || 0).toLocaleString()} tokens | Prompt: $${m.pricing_prompt}/M`,
              badge: m.id.split('/')[0],
            }));

          setResults([...pageMatches, ...modelMatches]);
          setSelectedIndex(0);
        }
      })
      .catch(() => {
        setResults(pageMatches);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [query]);

  const handleSelect = (item: SearchResult) => {
    trackEvent('search_result_selected', { itemId: item.id, category: item.category });
    router.push(item.url);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, results.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + results.length) % Math.max(1, results.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) {
        handleSelect(results[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search models and pages"
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-[#0F172A] border border-gray-800 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center px-4 py-3.5 border-b border-gray-800 gap-3">
          <Search className="w-5 h-5 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search models, pricing, providers, benchmarks, or pages..."
            className="flex-1 bg-transparent text-white placeholder-gray-500 text-sm focus:outline-none font-mono"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="text-gray-500 hover:text-gray-300"
              aria-label="Clear search query"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
            ESC
          </span>
        </div>

        <div className="max-h-[380px] overflow-y-auto p-2 space-y-1">
          {results.length === 0 ? (
            <div className="text-center py-12 text-gray-500 text-xs font-mono">
              {loading ? 'Searching model catalog...' : `No results found for "${query}"`}
            </div>
          ) : (
            results.map((item, index) => {
              const isSelected = index === selectedIndex;
              return (
                <div
                  key={`${item.category}-${item.id}`}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-cyan-950/60 border border-cyan-800/60 text-white'
                      : 'hover:bg-gray-800/50 text-gray-300 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`p-1.5 rounded-lg ${
                        item.category === 'model'
                          ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/50'
                          : 'bg-cyan-950/60 text-cyan-400 border border-cyan-800/50'
                      }`}
                    >
                      {item.category === 'model' ? <Cpu className="w-4 h-4" /> : <Layers className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold truncate text-white">{item.name}</span>
                        {item.badge && (
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-gray-800 text-cyan-400 border border-gray-700">
                            {item.badge}
                          </span>
                        )}
                      </div>
                      {item.subtitle && (
                        <p className="text-xs text-gray-400 truncate mt-0.5">{item.subtitle}</p>
                      )}
                    </div>
                  </div>
                  <ArrowRight
                    className={`w-4 h-4 flex-shrink-0 transition-transform ${
                      isSelected ? 'text-cyan-400 translate-x-0.5' : 'text-gray-600 opacity-0'
                    }`}
                  />
                </div>
              );
            })
          )}
        </div>

        <div className="px-4 py-2.5 bg-[#0B0F17] border-t border-gray-800/80 flex items-center justify-between text-[11px] text-gray-500 font-mono">
          <div className="flex items-center gap-3">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
          </div>
          <span>Instant Command Palette</span>
        </div>
      </div>
    </div>
  );
}
