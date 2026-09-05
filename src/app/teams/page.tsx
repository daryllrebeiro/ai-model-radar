import { TeamWorkspaces } from '@/components/teams/team-workspaces';
import { getPageFeatureTier } from '@/lib/access-guard';

export const dynamic = 'force-dynamic';

export default async function TeamsPage() {
  const featureTier = await getPageFeatureTier();

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="border-b border-gray-800 pb-6">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-cyan-950/60 border border-cyan-800/50 text-cyan-400 text-xs font-mono mb-2">
          <span>ENTERPRISE · TEAM WORKSPACES</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          Team Workspaces
        </h1>
        <p className="mt-1.5 text-sm sm:text-base text-gray-400 max-w-2xl">
          Shared model watchlists and members across your whole organization — one source of
          truth for the models your team depends on.
        </p>
      </div>
      <TeamWorkspaces featureTier={featureTier} />
    </div>
  );
}