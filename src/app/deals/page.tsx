import React from 'react';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { getDealsData, getUsageProfileByEmail, getModelCurrentList } from '@/lib/db/queries';
import { FreeModelsGrid } from '@/components/deals/free-models-grid';
import { PriceDropsTable } from '@/components/deals/price-drops-table';
import { maxMonthlySavingsForProfile } from '@/lib/recommendation';
import { getPageFeatureTier } from '@/lib/access-guard';
import { hasAccess } from '@/lib/feature-flags';
import { Tag, TrendingUp } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function DealsPage() {
  const dealsData = await getDealsData();

  let savingsBanner: {
    monthly_usd: number;
    model_name: string;
    model_id: string;
    compare_url: string;
  } | null = null;

  const featureTier = await getPageFeatureTier();
  if (hasAccess(featureTier, 'MIGRATION')) {
    try {
      const session = await getServerSession(authOptions);
      if (session?.user?.email) {
        const profile = await getUsageProfileByEmail(session.user.email);
        if (profile) {
          const { models: currentModels } = await getModelCurrentList({ limit: 500 });
          const { best } = maxMonthlySavingsForProfile(
            {
              primary_model_id: profile.primary_model_id,
              monthly_prompt_tokens: profile.monthly_prompt_tokens,
              monthly_comp_tokens: profile.monthly_comp_tokens,
              cache_hit_ratio: profile.cache_hit_ratio,
              batch_discount: profile.batch_discount,
            },
            currentModels
          );
          if (best && best.monthly_savings_usd > 0) {
            savingsBanner = {
              monthly_usd: best.monthly_savings_usd,
              model_name: best.model_name,
              model_id: best.model_id,
              compare_url: best.compare_url,
            };
          }
        }
      }
    } catch {
      // session/profile unavailable — hide the badge
    }
  }

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

      {/* MigrationSavings badge for the signed-in workload */}
      {savingsBanner && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl border border-emerald-800/50 bg-emerald-950/20 backdrop-blur-sm">
          <div className="flex items-start gap-3">
            <TrendingUp className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
            <div>
              <div className="text-sm font-semibold text-emerald-300">
                Your workload could save ${savingsBanner.monthly_usd.toLocaleString()} / month
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                Based on your saved usage profile — switching to <strong className="text-gray-200">{savingsBanner.model_name}</strong> is the cheapest verified alternative right now.
              </p>
            </div>
          </div>
          <a
            href={savingsBanner.compare_url}
            className="shrink-0 text-xs font-mono px-3 py-2 rounded-lg border border-emerald-700/60 text-emerald-300 hover:bg-emerald-900/40 transition-colors"
          >
            Compare Options →
          </a>
        </div>
      )}

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