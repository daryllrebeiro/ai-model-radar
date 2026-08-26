import React from 'react';
import { Shield, Lock, Database, Eye, Trash2, Mail } from 'lucide-react';
import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy — AI Model Radar',
  description: 'Our privacy commitments, GDPR/CCPA data rights, and third-party data processing disclosures.',
};

export default function PrivacyPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-10">
      {/* Header */}
      <div className="border-b border-gray-800 pb-8 space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/60 border border-cyan-800/50 text-cyan-400 text-xs font-mono">
          <Shield className="w-3.5 h-3.5" />
          <span>DATA PRIVACY &amp; COMPLIANCE</span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight">
          Privacy Policy &amp; Data Rights
        </h1>
        <p className="text-sm sm:text-base text-gray-400">
          Last updated: August 25, 2026 &bull; Compliant with GDPR (EU) and CCPA/CPRA (California).
        </p>
      </div>

      {/* Highlights Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-5 rounded-2xl border border-gray-800 bg-[#111827]/70 space-y-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-950/80 border border-emerald-800/80 flex items-center justify-center text-emerald-400">
            <Lock className="w-4 h-4" />
          </div>
          <h2 className="text-base font-bold text-white">Zero Tracking Cookies</h2>
          <p className="text-xs text-gray-400">
            We do not use tracking pixels, advertising cookies, or cross-site fingerprinting.
          </p>
        </div>

        <div className="p-5 rounded-2xl border border-gray-800 bg-[#111827]/70 space-y-2">
          <div className="w-8 h-8 rounded-lg bg-cyan-950/80 border border-cyan-800/80 flex items-center justify-center text-cyan-400">
            <Eye className="w-4 h-4" />
          </div>
          <h2 className="text-base font-bold text-white">Full Data Portability</h2>
          <p className="text-xs text-gray-400">
            Export all your registered API keys, alert rules, and watchlists at any time as JSON.
          </p>
        </div>

        <div className="p-5 rounded-2xl border border-gray-800 bg-[#111827]/70 space-y-2">
          <div className="w-8 h-8 rounded-lg bg-rose-950/80 border border-rose-800/80 flex items-center justify-center text-rose-400">
            <Trash2 className="w-4 h-4" />
          </div>
          <h2 className="text-base font-bold text-white">Right to Erasure</h2>
          <p className="text-xs text-gray-400">
            One-click permanent account deletion with complete purging across all database tables.
          </p>
        </div>
      </div>

      {/* Policy Details */}
      <div className="space-y-8 text-sm text-gray-300 leading-relaxed font-sans">
        <section className="space-y-3">
          <h2 className="text-xl font-bold text-white">1. Information We Collect</h2>
          <p>
            AI Model Radar collects only the minimal data necessary to provide model tracking and API services:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-gray-400">
            <li><strong>Account &amp; Alert Subscriptions:</strong> Your email address when registering for API keys, email digests, or Stripe billing.</li>
            <li><strong>Rate Limiting &amp; Abuse Prevention:</strong> IP addresses and API key prefixes are temporarily hashed in distributed Redis to enforce fair-use rate limits.</li>
            <li><strong>Public Model Metadata:</strong> We ingest and aggregate publicly accessible AI pricing, context limits, and git commit history from OpenRouter, GitHub, and Hugging Face.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-white">2. Third-Party Sub-Processors</h2>
          <p>
            We partner strictly with certified sub-processors under standard contractual clauses:
          </p>
          <div className="rounded-xl border border-gray-800 overflow-hidden font-mono text-xs">
            <table className="w-full text-left">
              <thead className="bg-gray-900/80 text-gray-400 border-b border-gray-800">
                <tr>
                  <th className="py-2.5 px-4">Provider</th>
                  <th className="py-2.5 px-4">Purpose</th>
                  <th className="py-2.5 px-4">Location</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                <tr>
                  <td className="py-2.5 px-4 text-cyan-400">Stripe, Inc.</td>
                  <td className="py-2.5 px-4">Payment &amp; Subscription Processing</td>
                  <td className="py-2.5 px-4 text-gray-400">United States / Global</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-4 text-cyan-400">Resend, Inc.</td>
                  <td className="py-2.5 px-4">Transactional &amp; Digest Email Delivery</td>
                  <td className="py-2.5 px-4 text-gray-400">United States</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-4 text-cyan-400">Upstash, Inc.</td>
                  <td className="py-2.5 px-4">Serverless Redis Distributed Rate Limiting</td>
                  <td className="py-2.5 px-4 text-gray-400">United States / EU</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-white">3. Your Rights &amp; Self-Service Tools</h2>
          <p>
            Under GDPR and CCPA, you have full control over your data:
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link
              href="/api/user/export"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-900 border border-gray-700 hover:border-cyan-500 text-xs font-mono text-cyan-400 transition-colors"
            >
              <Database className="w-3.5 h-3.5" />
              Download My Data (JSON)
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-900 border border-gray-700 hover:border-cyan-500 text-xs font-mono text-gray-300 transition-colors"
            >
              <Mail className="w-3.5 h-3.5" />
              Contact Privacy Officer
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
