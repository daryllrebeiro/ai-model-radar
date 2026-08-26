import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getModelDetail } from '@/lib/db/queries';
import { PriceChart } from '@/components/models/price-chart';
import { ModelSpecs } from '@/components/models/model-specs';
import { EventCard } from '@/components/feed/event-card';
import { ArrowLeft, Cpu, Activity, History, LineChart } from 'lucide-react';

export const dynamic = 'force-dynamic';

interface ModelDetailPageProps {
  params: {
    id: string[];
  };
}

export default async function ModelDetailPage({ params }: ModelDetailPageProps) {
  const rawId = Array.isArray(params.id) ? params.id.join('/') : params.id;
  const modelId = decodeURIComponent(rawId);

  const data = await getModelDetail(modelId);

  if (!data || !data.current) {
    notFound();
  }

  const { current, snapshots, events } = data;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Back Link */}
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs font-mono text-gray-400 hover:text-cyan-400 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Live Feed</span>
        </Link>
      </div>

      {/* Model Header Title */}
      <div className="border-b border-gray-800 pb-6">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-cyan-950/80 border border-cyan-800/60 text-cyan-300">
            <Cpu className="w-3.5 h-3.5" />
            {current.provider}
          </span>
          {current.is_free && (
            <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-950/80 border border-emerald-500/40 text-emerald-300">
              100% Free Model
            </span>
          )}
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
          {current.name}
        </h1>
        <p className="text-xs sm:text-sm font-mono text-gray-400 mt-1">
          {current.model_id}
        </p>
      </div>

      {/* 1. Current Specifications Grid */}
      <section className="space-y-3">
        <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          Current Specifications
        </h2>
        <ModelSpecs model={current} />
      </section>

      {/* 2. Interactive Price History Chart */}
      <section className="p-5 sm:p-6 rounded-2xl border border-gray-800 bg-[#111827]/70 backdrop-blur-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
            <LineChart className="w-4 h-4 text-emerald-400" />
            Historical Pricing Trend ($ / 1M Tokens)
          </h2>
          <span className="text-xs font-mono text-gray-400">
            {snapshots.length} snapshots recorded
          </span>
        </div>
        <PriceChart snapshots={snapshots} />
      </section>

      {/* 3. Full Event Changelog for this Model */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
            <History className="w-4 h-4 text-amber-400" />
            Model Changelog & Events ({events.length})
          </h2>
        </div>

        {events.length > 0 ? (
          <div className="space-y-3">
            {events.map((e, idx) => (
              <EventCard key={e.id || `${e.model_id}-${e.detected_at}-${idx}`} event={e} />
            ))}
          </div>
        ) : (
          <div className="p-8 text-center rounded-xl border border-gray-800 bg-[#111827]/40 text-gray-400 text-sm">
            No specific market events recorded for this model yet.
          </div>
        )}
      </section>
    </div>
  );
}
