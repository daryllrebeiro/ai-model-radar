'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

const FIELDS = [
  { value: 'category', label: 'Category / family (e.g. coding, llama)', ops: ['contains', 'eq'], placeholder: 'llama' },
  { value: 'price_drop_pct', label: 'Price drop ≥ %', ops: ['gte', 'lte', 'eq'], placeholder: '15' },
  { value: 'context_min', label: 'Context ≥ tokens', ops: ['gte'], placeholder: '100000' },
  { value: 'provider', label: 'Provider', ops: ['eq', 'contains'], placeholder: 'Anthropic' },
  { value: 'event_type', label: 'Event type', ops: ['eq'], placeholder: 'PRICE_CHANGE' },
];

interface Cond {
  field: string;
  op: string;
  value: string;
}

export function CompoundRuleBuilder() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [logic, setLogic] = useState<'and' | 'or'>('and');
  const [conds, setConds] = useState<Cond[]>([{ field: 'price_drop_pct', op: 'gte', value: '15' }]);
  const [channel, setChannel] = useState<'webhook' | 'email'>('webhook');
  const [destination, setDestination] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function setCond(i: number, patch: Partial<Cond>) {
    setConds((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const conditions = conds.map((c) => ({
        field: c.field,
        op: c.op,
        value: c.field === 'price_drop_pct' || c.field === 'context_min' ? Number(c.value) : c.value,
      }));
      const res = await fetch('/api/alerts/compound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, logic, conditions, channel, destination }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error + (body.details ? `: ${JSON.stringify(body.details)}` : ''));
        return;
      }
      router.refresh();
    } catch {
      setError('Network error.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="p-5 rounded-2xl border border-gray-800 bg-[#111827]/70 space-y-4">
      <h2 className="text-base font-bold text-white">New compound rule</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Rule name (e.g. cheap coding models)"
          className="p-2.5 rounded-xl bg-gray-900 border border-gray-700 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500"
        />
        <select
          value={logic}
          onChange={(e) => setLogic(e.target.value as 'and' | 'or')}
          className="p-2.5 rounded-xl bg-gray-900 border border-gray-700 text-xs font-mono text-white"
        >
          <option value="and">Match ALL conditions (AND)</option>
          <option value="or">Match ANY condition (OR)</option>
        </select>
      </div>
      {conds.map((c, i) => {
        const field = FIELDS.find((f) => f.value === c.field)!;
        return (
          <div key={i} className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-center">
            <select
              value={c.field}
              onChange={(e) => {
                const f = FIELDS.find((f) => f.value === e.target.value)!;
                setCond(i, { field: f.value, op: f.ops[0], value: '' });
              }}
              className="p-2.5 rounded-xl bg-gray-900 border border-gray-700 text-xs font-mono text-white"
            >
              {FIELDS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
            <select
              value={c.op}
              onChange={(e) => setCond(i, { op: e.target.value })}
              className="p-2.5 rounded-xl bg-gray-900 border border-gray-700 text-xs font-mono text-white"
            >
              {field.ops.map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
            <input
              value={c.value}
              onChange={(e) => setCond(i, { value: e.target.value })}
              placeholder={field.placeholder}
              className="p-2.5 rounded-xl bg-gray-900 border border-gray-700 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500"
            />
            <button
              type="button"
              onClick={() => setConds((prev) => prev.filter((_, j) => j !== i))}
              disabled={conds.length <= 1}
              className="text-xs font-mono text-red-400 hover:text-red-300 disabled:opacity-30"
            >
              Remove
            </button>
          </div>
        );
      })}
      {conds.length < 10 && (
        <button
          type="button"
          onClick={() => setConds((prev) => [...prev, { field: 'provider', op: 'eq', value: '' }])}
          className="text-xs font-mono text-cyan-400 hover:underline"
        >
          + Add condition (fixed set only — no scripting)
        </button>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <select
          value={channel}
          onChange={(e) => setChannel(e.target.value as 'webhook' | 'email')}
          className="p-2.5 rounded-xl bg-gray-900 border border-gray-700 text-xs font-mono text-white"
        >
          <option value="webhook">Webhook (existing delivery)</option>
          <option value="email">Email digest channel</option>
        </select>
        <input
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder={channel === 'email' ? 'you@team.com' : 'https://…'}
          className="p-2.5 rounded-xl bg-gray-900 border border-gray-700 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500"
        />
      </div>
      {error && <p className="text-xs font-mono text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-semibold uppercase tracking-wider"
      >
        {busy ? 'Saving…' : 'Save rule'}
      </button>
    </form>
  );
}
