import React from 'react';
import { ExportConnectorForm } from '@/components/exports/export-connector-form';

export const dynamic = 'force-dynamic';

export default function ExportsPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="space-y-2 border-b border-gray-800 pb-6">
        <span className="text-xs font-mono text-cyan-400">MEET TEAMS WHERE THEY LIVE</span>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white">Export Integrations</h1>
        <p className="text-xs sm:text-sm text-gray-400 max-w-2xl">
          Push price-change events into Datadog or Grafana, or sync the changelog feed into Notion
          or Airtable — over the same webhook-grade delivery with SSRF-guarded destinations. API keys
          are write-only and never displayed again. Run a connector on demand to push the latest events.
        </p>
      </div>
      <ExportConnectorForm />
      <p className="text-[11px] font-mono text-gray-500">
        Deliberately a small set of specific integrations, not a generic platform. Usage concentrates
        will show in connector run counts — invest where the runs are.
      </p>
    </div>
  );
}
