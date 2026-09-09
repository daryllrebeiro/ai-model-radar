import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { buildShowbackReport, spendForWorkload } from '@/lib/showback';
import type { ModelSnapshot } from '@/types/models';
import {
  createOrGetUser,
  createApiKey,
  createTeam,
  addTeamMember,
  upsertUsageProfile,
} from '@/lib/db/queries';
import { generateApiKey } from '@/lib/api-keys';
import { GET as showbackRoute } from '@/app/api/v1/governance/showback/route';

function snap(modelId: string, prompt: number, comp: number): ModelSnapshot {
  return {
    model_id: modelId,
    provider: 'SbCo',
    name: modelId,
    price_prompt: prompt,
    price_completion: comp,
    context_length: 64000,
    modality: 'text->text',
    is_free: false,
    raw_json: {},
    polled_at: new Date().toISOString(),
  };
}

const SNAPS = [snap('sb/a', 0.000001, 0.000004)]; // $1 / $4 per 1M

describe('spendForWorkload', () => {
  it('prices tokens at catalog rates', () => {
    // 2M prompt x $1 + 1M comp x $4 = $6
    expect(
      spendForWorkload(
        { monthly_prompt_tokens: 2_000_000, monthly_comp_tokens: 1_000_000, primary_model_id: 'sb/a' },
        SNAPS
      )
    ).toBe(6);
  });

  it('returns 0 without a primary model and floors negatives', () => {
    expect(
      spendForWorkload({ monthly_prompt_tokens: 100, monthly_comp_tokens: 100, primary_model_id: '  ' }, SNAPS)
    ).toBe(0);
    expect(
      spendForWorkload({ monthly_prompt_tokens: -5, monthly_comp_tokens: -5, primary_model_id: 'sb/a' }, SNAPS)
    ).toBe(0);
  });

  it('falls back to default prices for untracked models', () => {
    const untracked = spendForWorkload(
      { monthly_prompt_tokens: 1_000_000, monthly_comp_tokens: 0, primary_model_id: 'ghost/x' },
      SNAPS
    );
    expect(untracked).toBeGreaterThan(0);
  });
});

describe('buildShowbackReport', () => {
  it('splits spend by member with shares summing to ~100', () => {
    const report = buildShowbackReport(
      7,
      [
        { email: 'a@t.dev', monthly_prompt_tokens: 2_000_000, monthly_comp_tokens: 0, primary_model_id: 'sb/a' },
        { email: 'b@t.dev', monthly_prompt_tokens: 0, monthly_comp_tokens: 250_000, primary_model_id: 'sb/a' },
        { email: 'c@t.dev', monthly_prompt_tokens: 0, monthly_comp_tokens: 0, primary_model_id: '' },
      ],
      SNAPS
    );
    expect(report.team_id).toBe(7);
    expect(report.member_count).toBe(3);
    expect(report.members_with_usage).toBe(2);
    expect(report.total_projected_monthly_usd).toBe(3); // 2 + 1 + 0
    expect(report.members[0].email).toBe('a@t.dev'); // sorted desc
    const shares = report.members.reduce((s, m) => s + m.share_pct, 0);
    expect(shares).toBeGreaterThanOrEqual(99.9);
    expect(shares).toBeLessThanOrEqual(100.1);
  });

  it('handles zero total without NaN shares', () => {
    const report = buildShowbackReport(
      8,
      [{ email: 'z@t.dev', monthly_prompt_tokens: 0, monthly_comp_tokens: 0, primary_model_id: '' }],
      SNAPS
    );
    expect(report.total_projected_monthly_usd).toBe(0);
    expect(report.members[0].share_pct).toBe(0);
  });
});

describe('showback route', () => {
  async function keyFor(email: string): Promise<string> {
    await createOrGetUser({ email });
    const { plaintextKey, keyRecord } = generateApiKey(email, 'production');
    await createApiKey(keyRecord);
    return plaintextKey;
  }

  it('attributes team spend per member; outsiders get 404', async () => {
    const stamp = Date.now();
    const owner = `showback.owner.${stamp}@test.dev`;
    const member = `showback.m.${stamp}@test.dev`;
    const outsider = `showback.out.${stamp}@test.dev`;
    const ownerKey = await keyFor(owner);
    const outsiderKey = await keyFor(outsider);
    await createOrGetUser({ email: member });
    const team = await createTeam(`showback team ${stamp}`, owner);
    const teamId = Number((team as any).id);
    await addTeamMember(teamId, member, 'member');
    await upsertUsageProfile({
      email: owner,
      monthly_prompt_tokens: 1_000_000,
      monthly_comp_tokens: 0,
      primary_model_id: 'sb-model-not-in-catalog',
    });
    await upsertUsageProfile({
      email: member,
      monthly_prompt_tokens: 0,
      monthly_comp_tokens: 0,
      primary_model_id: '',
    });

    const res = await showbackRoute(
      new NextRequest(`http://localhost/api/v1/governance/showback?team_id=${teamId}`, {
        headers: { Authorization: `Bearer ${ownerKey}` },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.team_id).toBe(teamId);
    expect(body.member_count).toBe(2);
    expect(body.members).toHaveLength(2);
    expect(body.total_projected_monthly_usd).toBeGreaterThan(0);

    const denied = await showbackRoute(
      new NextRequest(`http://localhost/api/v1/governance/showback?team_id=${teamId}`, {
        headers: { Authorization: `Bearer ${outsiderKey}` },
      })
    );
    expect(denied.status).toBe(404);

    const bad = await showbackRoute(
      new NextRequest('http://localhost/api/v1/governance/showback', {
        headers: { Authorization: `Bearer ${ownerKey}` },
      })
    );
    expect(bad.status).toBe(400);
  });
});
