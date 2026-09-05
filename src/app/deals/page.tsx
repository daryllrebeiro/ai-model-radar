import React from 'react';
import { getDealsData } from '@/lib/db/queries';
import { FreeModelsGrid } from '@/components/deals/free-models-grid';
import { PriceDropsTable } from '@/components/deals/price-drops-table';
import { Tag } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function DealsPage() {
  const dealsData = await getDealsData();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
      {/* Header */}
      <div className="border-b border-gray-800 pb-6">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-950/60 border border-emerald-800/50 text-emerald-400 text-xs font-mono mb-2">
          <Tag className="w-3.5 h-3.5" />
          <span>DEALS & ZERO-COST HUB</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          AI Model Deals & Free Tiers
        </h1>
        <p className="mt-1.5 text-sm sm:text-base text-gray-400 max-w-2xl">
          Discover the top price drops across LLMs and explore all actively available 100% free models.
        </p>
      </div>

      {/* Section 1: Biggest Price Drops Leaderboard */}
      <section>
        <PriceDropsTable
          drops7d={dealsData.topDrops7d}
          drops30d={dealsData.topDrops30d}
        />
      </section>

      {/* Section 2: 100% Free Models Grid */}
      <section className="pt-4 border-t border-gray-800">
        <FreeModelsGrid models={dealsData.freeModels} />
      </section>
    </div>
  );
}
