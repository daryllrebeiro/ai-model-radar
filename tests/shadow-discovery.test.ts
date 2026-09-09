import { describe, it, expect } from 'vitest';
import {
  upsertShadowFinding,
  getShadowFindings,
  setShadowFindingStatus,
  getBudgetAlerts,
  upsertUsageProfile,
  createOrGetUser,
} from '@/lib/db/queries';
import { runShadowDiscovery } from '@/lib/shadow-discovery';
import { uniqueEmail, seedTeamWithGovernance } from './helpers';

describe('upsertShadowFinding', () => {
  it('creates an open finding and preserves first_seen on re-sighting', async () => {
    const email = uniqueEmail('shadow');
    const model = `ghost/${Date.now()}-a`;
    const { record: first, created: createdFirst } = await upsertShadowFinding({
      model_id: model,
      scope: 'personal',
      owner_email: email,
      estimated_monthly_usd: 10,
      reason: 'first sighting',
    });
    expect(createdFirst).toBe(true);
    expect(first.status).toBe('open');
    expect(first.first_seen).toBeTruthy();

    await new Promise((r) => setTimeout(r, 10));
    const { record: second, created: createdSecond } = await upsertShadowFinding({
      model_id: model,
      scope: 'personal',
      owner_email: email,
      estimated_monthly_usd: 42.5,
      reason: 'second sighting',
    });
    expect(createdSecond).toBe(false);
    expect(second.id).toBe(first.id);
    expect(new Date(second.first_seen || 0).getTime()).toBe(
      new Date(first.first_seen || 0).getTime()
    );
    expect(second.estimated_monthly_usd).toBe(42.5);
    expect(second.reason).toBe('second sighting');
  });

  it('never re-opens dismissed findings on repeat upserts', async () => {
    const email = uniqueEmail('shadow');
    const model = `ghost/${Date.now()}-b`;
    const { record: created } = await upsertShadowFinding({
      model_id: model,
      scope: 'personal',
      owner_email: email,
      estimated_monthly_usd: 5,
      reason: 'sighting',
    });
    await setShadowFindingStatus(Number(created.id), 'dismissed');
    const { record: again, created: createdAgain } = await upsertShadowFinding({
      model_id: model,
      scope: 'personal',
      owner_email: email,
      estimated_monthly_usd: 99,
      reason: 'sighting again',
    });
    expect(again.status).toBe('dismissed');
    expect(createdAgain).toBe(false);
    expect(again.estimated_monthly_usd).toBe(99);
  });

  it('upserts team-scope findings keyed by team_id', async () => {
    const { email, team } = await seedTeamWithGovernance('shadow');
    const teamId = Number((team as any).id);
    const model = `ghost/${Date.now()}-team`;
    const input = {
      model_id: model,
      scope: 'team' as const,
      team_id: teamId,
      owner_email: email,
      estimated_monthly_usd: 12,
      reason: 'team sighting',
    };
    const { record: first, created: createdFirst } = await upsertShadowFinding(input);
    expect(createdFirst).toBe(true);
    expect(first.scope).toBe('team');
    const { record: second, created: createdSecond } = await upsertShadowFinding({
      ...input,
      estimated_monthly_usd: 20,
    });
    expect(createdSecond).toBe(false);
    expect(second.id).toBe(first.id);
    expect(second.estimated_monthly_usd).toBe(20);

    const listed = await getShadowFindings({ teamId });
    expect(listed.some((f) => f.model_id === model)).toBe(true);
  });

  it('rejects team findings without a valid team_id', async () => {    await expect(
      upsertShadowFinding({
        model_id: 'ghost/x',
        scope: 'team',
        owner_email: uniqueEmail('shadow'),
        estimated_monthly_usd: 1,
        reason: 'x',
      })
    ).rejects.toThrow();
  });
});

describe('setShadowFindingStatus', () => {
  it('transitions open -> acknowledged and returns null for unknown ids', async () => {
    const email = uniqueEmail('shadow');
    const { record: created } = await upsertShadowFinding({
      model_id: `ghost/${Date.now()}-c`,
      scope: 'personal',
      owner_email: email,
      estimated_monthly_usd: 3,
      reason: 'sighting',
    });
    const updated = await setShadowFindingStatus(Number(created.id), 'acknowledged');
    expect(updated?.status).toBe('acknowledged');
    expect(await setShadowFindingStatus(999999999, 'dismissed')).toBeNull();
  });
});

describe('runShadowDiscovery', () => {
  it('discovers untracked usage, records one alert, and dedupes on re-run', async () => {
    const email = uniqueEmail('shadow');
    await createOrGetUser({ email });
    const untracked = `untracked-vendor/${Date.now()}-stealth-1`;
    await upsertUsageProfile({
      email,
      monthly_prompt_tokens: 1_000_000,
      monthly_comp_tokens: 500_000,
      primary_model_id: untracked,
    });

    const first = await runShadowDiscovery(email);
    const personal = first.scopes.find((s) => s.scope === 'personal');
    expect(personal?.findings.some((f) => f.model_id === untracked)).toBe(true);
    expect(first.total_new).toBeGreaterThanOrEqual(1);

    const alertsAfterFirst = await getBudgetAlerts({ sinceHours: 24, limit: 200 });
    const shadowAlerts = alertsAfterFirst.filter(
      (a) => a.alert_type === 'shadow_ai' && a.model_family === untracked
    );
    expect(shadowAlerts.length).toBe(1);

    const second = await runShadowDiscovery(email);
    expect(second.total_new).toBe(0);
    const alertsAfterSecond = await getBudgetAlerts({ sinceHours: 24, limit: 200 });
    expect(
      alertsAfterSecond.filter(
        (a) => a.alert_type === 'shadow_ai' && a.model_family === untracked
      ).length
    ).toBe(1);

    const listed = await getShadowFindings({ email, status: 'open' });
    expect(listed.some((f) => f.model_id === untracked)).toBe(true);
  });
});
