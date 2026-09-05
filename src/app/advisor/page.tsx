import React from 'react';
import { getLatestSnapshotsMap } from '@/lib/db/queries';
import { getPageFeatureTier } from '@/lib/access-guard';
import { WorkloadCalculator } from '@/components/advisor/workload-calculator';
import { Calculator } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdvisorPage() {
  const snapshotsMap = await getLatestSnapshotsMap();
  const snapshots = Array.from(snapshotsMap.values());
  const featureTier = await getPageFeatureTier();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="border-b border-gray-800 pb-6">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-950/60 border border-emerald-800/50 text-emerald-400 text-xs font-mono mb-2">
          <Calculator className="w-3.5 h-3.5" />
          <span>PRODUCTION STACK &amp; COST ADVISOR</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          AI Model Stack Advisor
        </h1>
        <p className="mt-1.5 text-sm sm:text-base text-gray-400 max-w-2xl">
          Calculate precise monthly token costs and discover high-ROI model routing alternatives across frontier, cost-optimized, and free tiers based on live market pricing.
        </p>
      </div>

      {/* Interactive Calculator */}
      <section>
        <WorkloadCalculator initialSnapshots={snapshots} featureTier={featureTier} />
      </section>
    </div>
  );
}
