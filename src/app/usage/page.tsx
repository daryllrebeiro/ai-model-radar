import React from 'react';
import Link from 'next/link';
import { UsageUploadForm } from '@/components/usage/usage-upload-client';

export const dynamic = 'force-dynamic';

export default function UsagePage() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="space-y-2 border-b border-gray-800 pb-6">
        <span className="text-xs font-mono text-cyan-400">REAL SPEND, RECONCILED</span>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white">Usage Import & Spend Reconciliation</h1>
        <p className="text-xs sm:text-sm text-gray-400 max-w-2xl">
          Upload a month of real provider usage and see what it actually cost — and what comparable
          alternatives would have cost. Upload-based only; no billing-account connections in this version.
        </p>
      </div>
      <UsageUploadForm />
      <p className="text-[11px] font-mono text-gray-500">
        Your history lives under your account only. Open an import to see its reconciliation, or delete it
        permanently at any time. Private usage is never published — sharing a result publicly requires a
        separate explicit opt-in per submission (see <Link href="/savings" className="text-cyan-400 hover:underline">/savings</Link>).
      </p>
    </div>
  );
}
