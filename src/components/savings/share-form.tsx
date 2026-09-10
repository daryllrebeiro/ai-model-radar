'use client';

import React, { useState } from 'react';

export function ShareForm() {
  const [form, setForm] = useState({
    team_name: '',
    from_model_id: '',
    to_model_id: '',
    savings_usd_per_month: '',
    period_label: '',
    story: '',
  });
  const [consent, setConsent] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      const res = await fetch('/api/savings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, consent }),
      });
      const body = await res.json();
      setMsg(res.ok ? body.message : body.error || 'Submission failed.');
    } catch {
      setMsg('Network error.');
    } finally {
      setBusy(false);
    }
  }

  const input =
    'p-2.5 rounded-xl bg-gray-900 border border-gray-700 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500';

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <input value={form.team_name} onChange={(e) => setForm({ ...form, team_name: e.target.value })} placeholder="Team name (optional)" className={input} />
      <input value={form.period_label} onChange={(e) => setForm({ ...form, period_label: e.target.value })} placeholder="Period (e.g. March 2026)" className={input} />
      <input value={form.from_model_id} onChange={(e) => setForm({ ...form, from_model_id: e.target.value })} placeholder="From model id *" required className={input} />
      <input value={form.to_model_id} onChange={(e) => setForm({ ...form, to_model_id: e.target.value })} placeholder="To model id *" required className={input} />
      <input value={form.savings_usd_per_month} onChange={(e) => setForm({ ...form, savings_usd_per_month: e.target.value })} placeholder="Saved $/month *" required inputMode="decimal" className={input} />
      <input value={form.story} onChange={(e) => setForm({ ...form, story: e.target.value })} placeholder="One-line story (optional)" className={`${input} sm:col-span-2`} />
      <label className="sm:col-span-2 flex items-start gap-2 text-[11px] font-mono text-gray-300">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
        <span>I explicitly consent to publishing this migration outcome publicly, and I understand a moderator reviews it first and I can take it down anytime.</span>
      </label>
      {msg && <p className="sm:col-span-2 text-xs font-mono text-cyan-300">{msg}</p>}
      <button
        type="submit"
        disabled={busy || !consent}
        className="sm:col-span-2 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-semibold uppercase tracking-wider"
      >
        {busy ? 'Submitting…' : 'Submit for moderation'}
      </button>
    </form>
  );
}
