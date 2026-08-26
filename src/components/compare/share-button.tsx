'use client';

import React, { useState } from 'react';
import { Share2, Check } from 'lucide-react';
import { trackEvent } from '@/lib/analytics';

export function ShareButton() {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      trackEvent('compare_share', { url: window.location.href });
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="px-3.5 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 text-xs font-semibold text-gray-200 hover:text-white uppercase tracking-wider transition-all flex items-center gap-1.5 font-mono"
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-emerald-400">Link Copied!</span>
        </>
      ) : (
        <>
          <Share2 className="w-3.5 h-3.5 text-cyan-400" />
          <span>Share Comparison</span>
        </>
      )}
    </button>
  );
}
