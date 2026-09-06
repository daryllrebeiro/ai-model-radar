'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Send, Link2, Loader2, Sparkles } from 'lucide-react';
import { FeatureGate } from '@/components/FeatureGate';
import type { AskAnswer, RadarCitation } from '@/types/ask';

interface AskClientProps {
  featureTier?: string;
}

const SUGGESTIONS = [
  'Which models are due for a price cut?',
  'What changed in the market recently?',
  'Which models are flagged end-of-life?',
  'Show me the cheapest same-family endpoints',
];

function CitationLink({ c }: { c: RadarCitation }) {
  return (
    <a
      key={c.id}
      href={c.url}
      target="_blank"
      rel="noopener noreferrer"
      title={c.title}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-gray-800/80 border border-gray-700 hover:border-sky-700 text-[11px] font-mono text-sky-400 transition-colors"
    >
      <Link2 className="w-2.5 h-2.5" />
      {c.type}:{c.model_id || c.id.split(':')[1] || ''}
    </a>
  );
}

export function AskClient({ featureTier = 'free' }: AskClientProps) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function ask(q: string) {
    if (q.trim().length < 3 || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `Request failed (HTTP ${res.status})`);
        setAnswer(null);
        return;
      }
      const data = await res.json();
      setAnswer(data.answer);
    } catch {
      setError('Network error — check your connection and retry.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <FeatureGate feature="ASK_RADAR" userTier={featureTier}>
      <div className="space-y-6">
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => {
                setQuestion(s);
                ask(s);
              }}
              className="px-3 py-1.5 rounded-full border border-gray-800 bg-[#111827]/80 text-xs text-gray-300 hover:border-sky-800 hover:text-sky-300 transition-colors text-left"
            >
              {s}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(question);
          }}
          className="flex gap-2"
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about prices, health, forecasts, EOL models, savings…"
            className="flex-1 rounded-xl border border-gray-700 bg-[#0B0F17] px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-600"
          />
          <button
            type="submit"
            disabled={loading || question.trim().length < 3}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Ask
          </button>
        </form>

        {error && (
          <div className="rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {answer && (
          <div className="rounded-2xl border border-gray-800 bg-[#111827]/80 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-sky-400" />
                <span className="text-xs font-mono uppercase tracking-wider text-gray-400">
                  {answer.intent.replace('_', ' ')}
                </span>
              </div>
              <span className="text-[11px] font-mono text-green-400">citations validated</span>
            </div>
            <div className="px-5 py-4">
              <pre className="whitespace-pre-wrap text-sm leading-relaxed text-gray-200 font-sans">{answer.answer}</pre>
              {answer.profile_required && (
                <p className="mt-3 text-xs text-gray-400">
                  Enable savings estimates by adding your usage profile on the{' '}
                  <Link href="/advisor" className="text-sky-400 hover:underline">
                    Migration Advisor
                  </Link>
                  .
                </p>
              )}
            </div>
            {answer.citations.length > 0 && (
              <div className="px-5 py-3 border-t border-gray-800 flex flex-wrap gap-2 items-center">
                <span className="text-[11px] font-mono uppercase tracking-wider text-gray-500">Sources</span>
                {answer.citations.map((c) => (
                  <CitationLink key={c.id} c={c} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </FeatureGate>
  );
}