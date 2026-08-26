import React from 'react';
import { Shield, CheckCircle2, ExternalLink, Scale, FileText, Globe } from 'lucide-react';
import Link from 'next/link';

export default function TermsPage() {
  const sources = [
    {
      name: 'OpenRouter API',
      purpose: 'Model directory, prompt/completion token pricing, context lengths, and provider endpoints.',
      termsUrl: 'https://openrouter.ai/terms',
      policy: 'Data is polled and cached for historical diff derivation and market intelligence.',
    },
    {
      name: 'Hugging Face Hub API',
      purpose: 'Community model trending scores, monthly download counts, and likes metrics.',
      termsUrl: 'https://huggingface.co/terms-of-service',
      policy: 'Queried via public REST API with direct repository attribution and author links.',
    },
    {
      name: 'GitHub Public REST API',
      purpose: 'Research lab open-source repository releases, tokenizer updates, and commit diffs.',
      termsUrl: 'https://docs.github.com/en/site-policy/github-terms/github-terms-of-service',
      policy: 'Read-only queries authenticated via standard tokens under public API guidelines.',
    },
    {
      name: 'Evaluation Leaderboards & Technical Reports',
      purpose: 'Verified evaluation numbers (LMSYS Arena Elo, SWE-bench, HumanEval, MATH-500, GPQA).',
      termsUrl: 'https://chat.lmsys.org/',
      policy: 'Individual benchmark scores cite the tested date, publication source, and canonical research URL.',
    },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="border-b border-gray-800 pb-6">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-cyan-950/60 border border-cyan-800/50 text-cyan-400 text-xs font-mono mb-2">
          <Scale className="w-3.5 h-3.5" />
          <span>DATA COMPLIANCE &amp; ATTRIBUTION</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          Terms of Service &amp; Data Attribution
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-gray-400">
          AI Model Radar is an independent changelog and market intelligence aggregator. We maintain transparent upstream data attribution and fair use practices.
        </p>
      </div>

      {/* Upstream Sources & Redistribution Disclosures */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
          <Globe className="w-4 h-4 text-cyan-400" />
          Upstream Data Sources &amp; Licensing Compliance
        </h2>

        <div className="grid grid-cols-1 gap-4">
          {sources.map((s) => (
            <div
              key={s.name}
              className="p-5 rounded-2xl border border-gray-800 bg-[#111827]/70 space-y-2"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-white text-base">{s.name}</h3>
                <a
                  href={s.termsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 font-mono"
                >
                  <span>Terms Policy</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <p className="text-xs text-gray-300">
                <strong className="text-gray-400">Usage: </strong>
                {s.purpose}
              </p>
              <p className="text-xs text-gray-400 font-mono pt-1 border-t border-gray-800/60">
                {s.policy}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Developer API Fair Use Policy */}
      <div className="p-6 rounded-2xl border border-gray-800 bg-[#111827]/80 space-y-4">
        <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
          <Shield className="w-4 h-4 text-emerald-400" />
          Developer API Fair Use &amp; Tier Quotas
        </h2>

        <ul className="space-y-2 text-xs text-gray-300 font-sans">
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
            <span>
              <strong>Free Tier (60 req/min):</strong> Unauthenticated IP requests or basic developer access for non-commercial and prototyping purposes.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
            <span>
              <strong>Developer Tier (300 req/min):</strong> Authenticated developer keys for automated monitoring scripts and internal tooling.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
            <span>
              <strong>Production Tier (1,200 req/min):</strong> Enterprise keys with dedicated throughput for real-time model routing and arbitrage integrations.
            </span>
          </li>
        </ul>

        <div className="pt-3 border-t border-gray-800 flex justify-between items-center text-xs font-mono text-gray-400">
          <span>Need custom throughput or enterprise webhooks?</span>
          <Link href="/docs" className="text-cyan-400 hover:text-cyan-300">
            Read API Docs &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
}
