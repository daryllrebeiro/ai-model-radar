'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

const TYPES = [
  { value: 'datadog', label: 'Datadog — price-change events (needs API key)', dest: 'Datadog events URL (blank = default US endpoint)' },
  { value: 'grafana', label: 'Grafana — annotations (needs instance URL + token)', dest: 'Grafana base URL, e.g. https://grafana.example.com' },
  { value: 'notion', label: 'Notion — changelog sync (needs database ID + token)', dest: 'Notion database ID' },
  { value: 'airtable', label: 'Airtable — deal feed (needs records endpoint + token)', dest: 'Records endpoint URL (https://api.airtable.com/v0/{base}/{table})' },
];

export function ExportConnectorForm() {
  const router = useRouter();
  const [type, setType] = useState('datadog');
  const [name, setName] = useState('');
  const [destinationUrl, setDestinationUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      const res = await fetch('/api/exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type, destination_url: destinationUrl, secret: secret || undefined }),
      });
      const body = await res.json();
      setMsg(res.ok ? `Connector #${body.connector.id} registered.` : body.error || 'Failed.');
      if (res.ok) router.refresh();
    } catch {
      setMsg('Network error.');
    } finally {
      setBusy(false);
    }
  }

  const input =
    'p-2.5 rounded-xl bg-gray-900 border border-gray-700 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500';

  return (
    <form onSubmit={onSubmit} className="p-5 rounded-2xl border border-gray-800 bg-[#111827]/70 space-y-3">
      <h2 className="text-base font-bold text-white">New export connector</h2>
      <select value={type} onChange={(e) => setType(e.target.value)} className={`${input} w-full`}>
        {TYPES.map((t) => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. prod-datadog)" required className={`${input} w-full`} />
      <input
        value={destinationUrl}
        onChange={(e) => setDestinationUrl(e.target.value)}
        placeholder={TYPES.find((t) => t.value === type)!.dest}
        className={`${input} w-full`}
      />
      <input
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        placeholder="API key / token (write-only — never shown again)"
        type="password"
        autoComplete="off"
        className={`${input} w-full`}
      />
      {msg && <p className="text-xs font-mono text-cyan-300">{msg}</p>}
      <button
        type="submit"
        disabled={busy}
        className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-semibold uppercase tracking-wider"
      >
        {busy ? 'Saving…' : 'Register connector'}
      </button>
    </form>
  );
}
