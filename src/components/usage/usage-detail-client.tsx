'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export function UsageDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/usage/imports/${encodeURIComponent(id)}`)
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) setError(b.error || 'Not found.');
        else setData(b);
      })
      .catch(() => setError('Network error.'));
  }, [id]);

  async function onDelete() {
    if (!confirm('Permanently delete this usage import? This cannot be undone.')) return;
    const res = await fetch(`/api/usage/imports/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok) {
      router.push('/usage');
      router.refresh();
    } else {
      setError('Delete failed.');
    }
  }

  if (error) return <p className="text-sm font-mono text-red-400">{error}</p>;
  if (!data) return <p className="text-sm font-mono text-gray-400">Loading reconciliation…</p>;

  const rec = data.reconciliation;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 pb-4">
        <div>
          <h1 className="text-xl font-bold text-white">{data.import.filename || `Import #${data.import.id}`}</h1>
          <p className="text-xs font-mono text-gray-400">
            {data.import.row_count} models · actual ${data.reconciliation.total_actual_usd.toFixed(2)}
            {' → '}alt ${data.reconciliation.total_alt_usd.toFixed(2)}
            {' · '}potential savings ${data.reconciliation.total_savings_usd.toFixed(2)}/mo
          </p>
        </div>
        <button
          onClick={onDelete}
          className="px-3 py-1.5 rounded-xl bg-red-950/60 border border-red-800/60 text-red-300 text-xs font-mono hover:bg-red-900/60"
        >
          Delete permanently
        </button>
      </div>
      {rec.estimates_present && (
        <p className="text-[11px] font-mono text-amber-300/80">
          Some figures are estimated from current catalog prices (upload had no cost column, or no
          comparable alternative was found) — treated as indicative, not exact.
        </p>
      )}
      <div className="rounded-2xl border border-gray-800 overflow-hidden">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="bg-gray-900/60 text-gray-400 uppercase text-[10px]">
              <th className="text-left p-3">Model</th>
              <th className="text-right p-3">Tokens in/out</th>
              <th className="text-right p-3">You spent</th>
              <th className="text-right p-3">Alternative</th>
              <th className="text-right p-3">Would cost</th>
              <th className="text-right p-3">Save/mo</th>
            </tr>
          </thead>
          <tbody>
            {rec.rows.map((r: any) => (
              <tr key={r.model_id} className="border-t border-gray-800/60 text-gray-200">
                <td className="p-3">
                  {r.model_id}
                  {r.actual_estimated && <span className="text-amber-400"> *</span>}
                </td>
                <td className="p-3 text-right text-gray-400">
                  {r.prompt_tokens.toLocaleString()} / {r.completion_tokens.toLocaleString()}
                </td>
                <td className="p-3 text-right font-bold">${r.actual_spend_usd.toFixed(2)}</td>
                <td className="p-3 text-right text-cyan-300">{r.alt_model_id || '—'}</td>
                <td className="p-3 text-right">{r.alt_spend_usd !== null ? `$${r.alt_spend_usd.toFixed(2)}` : '—'}</td>
                <td className="p-3 text-right font-bold text-emerald-400">
                  {(r.savings_usd || 0) > 0 ? `$${r.savings_usd.toFixed(2)}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
