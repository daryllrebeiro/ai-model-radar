import { GovernanceClient } from '@/components/governance/governance-client';
import { getPageFeatureTier } from '@/lib/access-guard';

export const dynamic = 'force-dynamic';

export default async function GovernancePage() {
  const featureTier = await getPageFeatureTier();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="border-b border-gray-800 pb-6">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-violet-950/60 border border-violet-800/50 text-violet-400 text-xs font-mono mb-2">
          <span>ENTERPRISE · USAGE GOVERNANCE</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          Budget Governance &amp; Shadow-AI Detection
        </h1>
        <p className="mt-1.5 text-sm sm:text-base text-gray-400 max-w-2xl">
          Per-team guardrails over the usage engine: projected spend, threshold alerts,
          undocumented-endpoint detection, and an approval workflow for migration switches.
        </p>
      </div>
      <GovernanceClient featureTier={featureTier} />
    </div>
  );
}