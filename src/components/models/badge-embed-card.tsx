'use client';

import React, { useState } from 'react';
import { Copy, Check, Code2, ExternalLink } from 'lucide-react';
import { trackEvent } from '@/lib/analytics';

interface BadgeEmbedCardProps {
  modelId: string;
  modelName: string;
}

export function BadgeEmbedCard({ modelId, modelName }: BadgeEmbedCardProps) {
  const [copied, setCopied] = useState(false);
  const badgeUrl = `https://ai-model-radar.com/badge/${encodeURIComponent(modelId)}/price.svg`;
  const linkUrl = `https://ai-model-radar.com/models/${encodeURIComponent(modelId)}`;
  const markdownSnippet = `[![${modelName} Pricing](${badgeUrl})](${linkUrl})`;

  const handleCopy = () => {
    navigator.clipboard.writeText(markdownSnippet);
    setCopied(true);
    trackEvent('badge_copy_snippet', { modelId });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-4 sm:p-5 rounded-2xl border border-gray-800 bg-[#111827]/70 backdrop-blur-sm space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-mono font-semibold text-gray-300">
          <Code2 className="w-4 h-4 text-cyan-400" />
          <span>Embed Live Price Badge (README.md / Docs)</span>
        </div>
        <div className="shrink-0">
          {/* Real-time Badge Preview */}
          <img
            src={`/badge/${encodeURIComponent(modelId)}/price.svg`}
            alt={`${modelName} Badge Preview`}
            className="h-5 rounded"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 bg-gray-950/80 p-2.5 rounded-xl border border-gray-800">
        <code className="text-xs font-mono text-cyan-300 truncate flex-1 select-all">
          {markdownSnippet}
        </code>
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs font-mono text-gray-200 transition-colors shrink-0"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
