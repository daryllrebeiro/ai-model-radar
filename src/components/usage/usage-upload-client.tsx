'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

export function UsageUploadForm() {
  const router = useRouter();
  const [csv, setCsv] = useState('');
  const [filename, setFilename] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFilename(f.name);
    setCsv(await f.text());
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/usage/imports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, csv }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || 'Upload failed.');
        return;
      }
      router.push(`/usage/${body.id}`);
      router.refresh();
    } catch {
      setError('Upload failed (network).');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="p-5 rounded-2xl border border-gray-800 bg-[#111827]/70 space-y-3">
      <h2 className="text-base font-bold text-white">Upload a usage export (CSV)</h2>
      <p className="text-xs text-gray-400 font-mono">
        Provider billing-dashboard CSV or OpenRouter usage export. Columns needed: model, prompt/input
        tokens, completion/output tokens, optional cost. Max 5,000 rows / 2MB. Private to your account —
        delete anytime; never shared without separate explicit consent.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={onFile}
        className="block w-full text-xs font-mono text-gray-300 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:bg-gray-800 file:text-gray-200 file:border file:border-gray-700"
      />
      <textarea
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        placeholder="…or paste CSV here (header + rows)"
        rows={6}
        className="w-full p-3 rounded-xl bg-gray-900 border border-gray-700 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500"
      />
      {error && <p className="text-xs font-mono text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy || csv.trim().length === 0}
        className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-semibold uppercase tracking-wider"
      >
        {busy ? 'Uploading…' : 'Upload & reconcile'}
      </button>
    </form>
  );
}
