import React from 'react';
import Link from 'next/link';
import { CompoundRuleBuilder } from '@/components/alerts/compound-rule-builder';

export const dynamic = 'force-dynamic';

export default function CompoundAlertsPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="space-y-2 border-b border-gray-800 pb-6">
        <div className="flex items-center gap-2 text-xs font-mono">
          <Link href="/alerts" className="text-gray-400 hover:text-gray-200">← Alerts</Link>
          <span className="text-gray-600">/</span>
          <span className="text-cyan-400">Compound rules</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white">Compound Alert Rules</h1>
        <p className="text-xs sm:text-sm text-gray-400 max-w-2xl">
          AND/OR rules across category, price-drop %, context length, provider, and event type —
          evaluated against the live event stream. Webhook rules deliver on test; email-channel rules
          ride the daily/weekly digest. Use the per-rule test endpoint to preview matches before relying
          on a rule.
        </p>
      </div>
      <CompoundRuleBuilder />
      <p className="text-[11px] font-mono text-gray-500">
        Success metric for this feature: share of rules using more than one condition. Single-condition
        needs are better served by the basic alert rules on <Link href="/alerts" className="text-cyan-400 hover:underline">/alerts</Link>.
      </p>
    </div>
  );
}
