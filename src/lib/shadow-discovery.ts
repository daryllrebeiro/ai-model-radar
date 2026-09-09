/**
 * Shadow-AI Discovery runner: persists undocumented-model spend findings per
 * scope and emits deduplicated `shadow_ai` budget alerts.
 *
 * Runs on demand (POST /api/v1/governance/shadow-ai) and opportunistically
 * from the Radar Router when an API caller names a model outside the
 * tracked catalog. Dismissed/acknowledged findings are never re-opened —
 * repeat sightings only refresh last_seen + the spend estimate.
 */

import {
  getLatestSnapshotsMap,
  getUsageProfileByEmail,
  getTeamMembers,
  getTeamsForUser,
  getBudgetAlerts,
  recordBudgetAlert,
  upsertShadowFinding,
} from '@/lib/db/queries';
import {
  collectUsageFromProfiles,
  detectShadowAI,
} from '@/lib/governance';
import type { ShadowAiRecord, UsageByModel } from '@/types/governance';

export interface DiscoveryScopeResult {
  scope: 'personal' | 'team';
  team_id: number | null;
  findings: ShadowAiRecord[];
  new_findings: number;
}

export interface DiscoveryRunResult {
  ran_at: string;
  scopes: DiscoveryScopeResult[];
  total_findings: number;
  total_new: number;
}

async function personalUsage(email: string): Promise<UsageByModel[]> {
  const profile = await getUsageProfileByEmail(email);
  return profile ? collectUsageFromProfiles([profile]) : [];
}

async function teamUsage(teamId: number): Promise<UsageByModel[]> {
  const members = await getTeamMembers(teamId);
  const profiles = [];
  for (const m of members) {
    const p = await getUsageProfileByEmail(m.member_email);
    if (p) profiles.push(p);
  }
  return collectUsageFromProfiles(profiles);
}

export async function runShadowDiscovery(
  email: string,
  approvedModelIds: string[] = []
): Promise<DiscoveryRunResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const snapshots = Array.from((await getLatestSnapshotsMap()).values());
  const recentAlerts = await getBudgetAlerts({ sinceHours: 24, limit: 200 });

  const scopes: Array<{ scope: 'personal' | 'team'; team_id: number | null; usage: UsageByModel[] }> = [
    { scope: 'personal', team_id: null, usage: await personalUsage(normalizedEmail) },
  ];
  const teams = await getTeamsForUser(normalizedEmail);
  for (const t of teams) {
    scopes.push({ scope: 'team', team_id: t.id, usage: await teamUsage(t.id) });
  }

  const results: DiscoveryScopeResult[] = [];
  for (const s of scopes) {
    const detected = detectShadowAI(s.usage, snapshots, approvedModelIds);
    const findings: ShadowAiRecord[] = [];
    let newCount = 0;
    for (const d of detected) {
      const { record: row, created } = await upsertShadowFinding({
        model_id: d.model_id,
        scope: s.scope,
        team_id: s.team_id,
        owner_email: normalizedEmail,
        estimated_monthly_usd: d.estimated_monthly_usd,
        reason: d.reason,
      });
      findings.push(row);
      if (created) newCount += 1;

      if (created || row.status === 'open') {
        const dup = recentAlerts.some(
          (a) => a.alert_type === 'shadow_ai' && a.model_family === d.model_id
        );
        if (!dup) {
          const alert = await recordBudgetAlert({
            model_family: d.model_id,
            projected_monthly_usd: d.estimated_monthly_usd,
            budget_usd: 0,
            pct_used: 0,
            alert_type: 'shadow_ai',
            message: `Shadow AI: ${d.reason} (model ${d.model_id}, ~$${d.estimated_monthly_usd}/mo)`,
          });
          recentAlerts.push(alert);
        }
      }
    }
    results.push({
      scope: s.scope,
      team_id: s.team_id,
      findings,
      new_findings: newCount,
    });
  }

  return {
    ran_at: new Date().toISOString(),
    scopes: results,
    total_findings: results.reduce((n, r) => n + r.findings.length, 0),
    total_new: results.reduce((n, r) => n + r.new_findings, 0),
  };
}
