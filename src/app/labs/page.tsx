import React from 'react';
import { fetchLabActivity } from '@/lib/ingestion/github-labs';
import { GitBranch, GitCommit, Tag, ExternalLink, Code2, Clock } from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function LabsPage() {
  const activities = await fetchLabActivity();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="border-b border-gray-800 pb-6">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-cyan-950/60 border border-cyan-800/50 text-cyan-400 text-xs font-mono mb-2">
          <GitBranch className="w-3.5 h-3.5" />
          <span>RESEARCH LAB GITHUB ACTIVITY</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          AI Lab Repository Activity
        </h1>
        <p className="mt-1.5 text-sm sm:text-base text-gray-400 max-w-2xl">
          Verifiable GitHub commit diffs, repository releases, tokenizer updates, and configuration changes across OpenAI, Anthropic, Google DeepMind, DeepSeek, Meta, and Mistral.
        </p>
      </div>

      {/* Activity Timeline Stream */}
      <div className="space-y-4">
        {activities.map((item) => (
          <div
            key={item.id}
            className="group rounded-2xl border border-gray-800 bg-[#111827]/70 p-5 sm:p-6 hover:bg-gray-800/50 hover:border-gray-700 transition-all space-y-3"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-md text-xs font-mono font-bold bg-gray-800 text-cyan-300 border border-gray-700">
                  {item.org}/{item.repo}
                </span>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-gray-900 text-gray-400 border border-gray-800">
                  {item.event_type}
                </span>
              </div>

              <div className="flex items-center gap-3 text-xs font-mono text-gray-400">
                {item.commit_sha && (
                  <span className="flex items-center gap-1">
                    <GitCommit className="w-3.5 h-3.5 text-emerald-400" />
                    <code>{item.commit_sha}</code>
                  </span>
                )}
                <span>{formatRelativeTime(item.detected_at)}</span>
              </div>
            </div>

            <div>
              <h3 className="text-base font-bold text-white group-hover:text-cyan-300 transition-colors tracking-tight">
                {item.title}
              </h3>
              <p className="text-xs sm:text-sm text-gray-300 mt-1">
                {item.description}
              </p>
            </div>

            {/* Tags & Action */}
            <div className="pt-2 border-t border-gray-800/70 flex items-center justify-between">
              <div className="flex flex-wrap gap-1.5">
                {item.tags?.map((t) => (
                  <span
                    key={t}
                    className="text-[10px] font-mono text-gray-400 bg-gray-900 px-1.5 py-0.5 rounded border border-gray-800"
                  >
                    #{t}
                  </span>
                ))}
              </div>

              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-cyan-400 hover:text-cyan-300 bg-cyan-950/40 hover:bg-cyan-900/50 px-2.5 py-1 rounded border border-cyan-800/40 transition-colors"
              >
                <span>View on GitHub</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
