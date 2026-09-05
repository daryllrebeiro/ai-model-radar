import React from 'react';
import { fetchHuggingFaceTrending } from '@/lib/ingestion/huggingface';
import { Users, Download, Heart, Flame, ExternalLink, Sparkles } from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function CommunityPage() {
  const models = await fetchHuggingFaceTrending(60);

  // Group stats
  const totalDownloads = models.reduce((sum, m) => sum + (m.downloads || 0), 0);
  const totalLikes = models.reduce((sum, m) => sum + (m.likes || 0), 0);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="border-b border-gray-800 pb-6">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-amber-950/60 border border-amber-800/50 text-amber-400 text-xs font-mono mb-2">
          <Users className="w-3.5 h-3.5" />
          <span>HUGGING FACE COMMUNITY STREAM</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          Community &amp; Open Weights Radar
        </h1>
        <p className="mt-1.5 text-sm sm:text-base text-gray-400 max-w-2xl">
          Tracking new repository releases, download spikes, and trending open-weight models from the Hugging Face Hub. Kept visually separate from pricing diffs.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5">
          <div className="flex items-center justify-between text-amber-400">
            <span className="text-xs font-mono uppercase">Trending Repos</span>
            <Flame className="w-4 h-4" />
          </div>
          <div className="text-2xl font-bold font-mono text-white mt-1">
            {models.length} Repositories
          </div>
          <p className="text-xs text-gray-400 mt-0.5">ranked by Hugging Face trending algorithm</p>
        </div>

        <div className="p-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5">
          <div className="flex items-center justify-between text-cyan-400">
            <span className="text-xs font-mono uppercase">Monthly Downloads</span>
            <Download className="w-4 h-4" />
          </div>
          <div className="text-2xl font-bold font-mono text-cyan-300 mt-1">
            {(totalDownloads / 1_000_000).toFixed(1)}M+
          </div>
          <p className="text-xs text-gray-400 mt-0.5">across tracked community models</p>
        </div>

        <div className="p-4 rounded-xl border border-rose-500/20 bg-rose-500/5">
          <div className="flex items-center justify-between text-rose-400">
            <span className="text-xs font-mono uppercase">Community Stars</span>
            <Heart className="w-4 h-4" />
          </div>
          <div className="text-2xl font-bold font-mono text-rose-300 mt-1">
            {totalLikes.toLocaleString()} Likes
          </div>
          <p className="text-xs text-gray-400 mt-0.5">total repository upvotes</p>
        </div>
      </div>

      {/* Model Cards Grid */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-400" />
          Trending Open Source Model Repositories
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {models.map((m) => (
            <div
              key={m.id}
              className="group p-5 rounded-xl border border-gray-800 bg-[#111827]/70 hover:bg-gray-800/60 hover:border-amber-500/30 transition-all flex flex-col justify-between"
            >
              <div>
                {/* Author & Pipeline Badge */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-mono font-medium text-gray-300 bg-gray-800 px-2 py-0.5 rounded border border-gray-700">
                    {m.author}
                  </span>
                  {m.pipeline_tag && (
                    <span className="text-[11px] font-mono text-cyan-400 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800/50">
                      {m.pipeline_tag}
                    </span>
                  )}
                </div>

                {/* Name */}
                <h3 className="text-base font-bold text-white group-hover:text-amber-300 transition-colors tracking-tight line-clamp-1">
                  {m.name}
                </h3>
                <p className="text-xs font-mono text-gray-400 truncate mt-0.5">
                  {m.id}
                </p>

                {/* Metrics */}
                <div className="flex items-center gap-4 mt-3 text-xs font-mono text-gray-300">
                  <div className="flex items-center gap-1.5" title="Downloads">
                    <Download className="w-3.5 h-3.5 text-cyan-400" />
                    <span>{m.downloads >= 1000 ? `${(m.downloads / 1000).toFixed(0)}k` : m.downloads}</span>
                  </div>
                  <div className="flex items-center gap-1.5" title="Likes">
                    <Heart className="w-3.5 h-3.5 text-rose-400" />
                    <span>{m.likes.toLocaleString()}</span>
                  </div>
                  {m.trendingScore ? (
                    <div className="flex items-center gap-1.5" title="Trending Score">
                      <Flame className="w-3.5 h-3.5 text-amber-400" />
                      <span>{Number(m.trendingScore).toFixed(1)}</span>
                    </div>
                  ) : null}
                </div>

                {/* Tags */}
                {m.tags && m.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {m.tags.slice(0, 3).map((tag, idx) => (
                      <span
                        key={idx}
                        className="text-[10px] font-mono text-gray-400 bg-gray-900 px-1.5 py-0.5 rounded border border-gray-800"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Action / Link Footer */}
              <div className="mt-4 pt-3 border-t border-gray-800/80 flex items-center justify-between">
                <span className="text-[11px] font-mono text-gray-400">
                  Updated {formatRelativeTime(m.created_at)}
                </span>

                <a
                  href={`https://huggingface.co/${m.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-amber-400 hover:text-amber-300 bg-amber-950/40 hover:bg-amber-900/50 px-2.5 py-1 rounded border border-amber-800/40 transition-colors"
                >
                  <span>HF Hub</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
