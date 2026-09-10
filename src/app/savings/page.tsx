import React from 'react';
import Link from 'next/link';
import { listApprovedCaseStudies } from '@/lib/db/queries';
import { ShareForm } from '@/components/savings/share-form';

export const dynamic = 'force-dynamic';

export default async function SavingsPage() {
  const studies = await listApprovedCaseStudies(50).catch(() => []);
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="space-y-2 border-b border-gray-800 pb-6">
        <span className="text-xs font-mono text-cyan-400">COMMUNITY-PROVEN SAVINGS</span>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white">Migration Savings Leaderboard</h1>
        <p className="text-xs sm:text-sm text-gray-400 max-w-2xl">
          Real migrations teams opted in to share — each entry individually consented and
          moderator-approved. Nothing here is published automatically.
        </p>
      </div>

      {studies.length === 0 ? (
        <div className="p-10 rounded-3xl border border-gray-800 bg-[#111827]/40 text-center space-y-3">
          <p className="text-sm text-gray-300 font-semibold">No approved case studies yet.</p>
          <p className="text-xs text-gray-400 font-mono max-w-lg mx-auto">
            Reconciled real savings on <Link href="/usage" className="text-cyan-400 hover:underline">/usage</Link>?
            Share it below — sharing is a separate explicit opt-in per submission.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {studies.map((s) => (
            <article key={s.id} className="p-5 rounded-2xl border border-gray-800 bg-[#111827]/70 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-emerald-400 font-mono">
                  ${Number(s.savings_usd_per_month).toFixed(2)}/mo saved
                </span>
                {s.period_label && (
                  <span className="text-[10px] font-mono text-gray-400">{s.period_label}</span>
                )}
              </div>
              <p className="text-xs font-mono text-gray-300">
                {s.from_model_id} <span className="text-gray-500">→</span> {s.to_model_id}
              </p>
              {s.team_name && <p className="text-xs text-gray-400">{s.team_name}</p>}
              {s.story && <p className="text-xs text-gray-400 leading-relaxed">{s.story}</p>}
              <Link
                href={`/compare?models=${encodeURIComponent(`${s.from_model_id},${s.to_model_id}`)}`}
                className="inline-block text-[11px] font-mono text-cyan-400 hover:underline"
              >
                Compare these models →
              </Link>
            </article>
          ))}
        </div>
      )}

      <section className="p-5 rounded-2xl border border-gray-800 bg-[#0B0F17]/90 space-y-3">
        <h2 className="text-base font-bold text-white">Share your migration (opt-in)</h2>
        <p className="text-[11px] font-mono text-gray-400">
          Submissions enter a moderation queue and appear publicly only after approval. You can take
          down your entry at any time. Private usage history is never shared — this form is the
          separate, explicit consent.
        </p>
        <ShareForm />
      </section>
    </div>
  );
}
