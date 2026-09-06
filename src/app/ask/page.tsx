import { AskClient } from '@/components/ask/ask-client';
import { getPageFeatureTier } from '@/lib/access-guard';

export const dynamic = 'force-dynamic';

export default async function AskPage() {
  const featureTier = await getPageFeatureTier();

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="border-b border-gray-800 pb-6">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-sky-950/60 border border-sky-800/50 text-sky-400 text-xs font-mono mb-2">
          <span>PRO · ASK THE RADAR</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          Ask the Radar
        </h1>
        <p className="mt-1.5 text-sm sm:text-base text-gray-400 max-w-2xl">
          Conversational copilot over every data set we track — snapshots, changelog events,
          market signals, price-drop forecasts and live endpoint probes. Every answer cites
          the exact records it was derived from.
        </p>
      </div>
      <AskClient featureTier={featureTier} />
    </div>
  );
}