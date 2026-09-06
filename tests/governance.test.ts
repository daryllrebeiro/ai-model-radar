import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { ModelSnapshot } from '../src/types/models';
import {
  collectUsageFromProfiles,
  projectUsageByModelFamily,
  evaluateBudgetRule,
  detectShadowAI,
  switchRequiresApproval,
} from '../src/lib/governance';
import {
  createBudgetRule,
  getBudgetRulesForUser,
  getBudgetRulesForTeam,
  getAllBudgetRules,
  recordBudgetAlert,
  getBudgetAlerts,
  createMigrationApproval,
  getMigrationApprovals,
  decideMigrationApproval,
  createOrGetUser,
  createApiKey,
  insertSnapshots,
  upsertUsageProfile,
} from '../src/lib/db/queries';
import { generateApiKey } from '../src/lib/api-keys';
import { BudgetRule } from '../src/types/governance';
import { GET as rulesRoute, POST as postRulesRoute } from '../src/app/api/v1/governance/rules/route';
import { GET as statusRoute } from '../src/app/api/v1/governance/status/route';
import { POST as postApprovalRoute } from '../src/app/api/v1/governance/approvals/route';
import { POST as decideApprovalRoute } from '../src/app/api/v1/governance/approvals/[id]/route';

function snap(modelId: string, provider: string, isFree = false): ModelSnapshot {
  return {
    model_id: modelId,
    provider,
    name: modelId,
    price_prompt: 0.000001,
    price_completion: 0.000004,
    context_length: 200000,
    modality: 'text->text',
    is_free: isFree,
    raw_json: {},
    polled_at: new Date().toISOString(),
  };
}

function rule(overrides: Partial<BudgetRule> = {}): BudgetRule {
  return {
    id: 1,
    name: 'Monthly inference',
    scope: 'personal',
    team_id: null,
    owner_email: 'owner@test.dev',
    monthly_budget_usd: 1000,
    alert_threshold_pct: 0.8,
    approval_required: false,
    notify_email: null,
    active: true,
    ...overrides,
  };
}

describe('Phase 5 - Budget governance: engine', () => {
  it('1. collectUsageFromProfiles extracts workload volumes per model', () => {
    const usage = collectUsageFromProfiles([
      { primary_model_id: 'acme/a-1', monthly_prompt_tokens: 500000, monthly_comp_tokens: 250000 },
      { primary_model_id: '  ', monthly_prompt_tokens: 100, monthly_comp_tokens: 100 },
      { primary_model_id: 'acme/b-1', monthly_prompt_tokens: 0, monthly_comp_tokens: 0 },
    ]);
    // blank ids are dropped; zero-volume profiles are kept as declared workloads
    expect(usage).toHaveLength(2);
    expect(usage[0]).toEqual({ model_id: 'acme/a-1', monthly_prompt_tokens: 500000, monthly_comp_tokens: 250000 });
    expect(usage.some((u) => u.model_id === 'acme/b-1')).toBe(true);
  });

  it('2. projectUsageByModelFamily rolls up spend per family at snapshot prices', () => {
    const snapshots = [snap('acme/a-v1', 'Acme'), snap('acme/a-v2', 'Acme')];
    const usage = [
      { model_id: 'acme/a-v1', monthly_prompt_tokens: 2_000_000, monthly_comp_tokens: 1_000_000 },
      { model_id: 'acme/a-v2', monthly_prompt_tokens: 1_000_000, monthly_comp_tokens: 500_000 },
      { model_id: 'other/x-v3', monthly_prompt_tokens: 0, monthly_comp_tokens: 1_000_000 },
    ];
    const families = projectUsageByModelFamily(usage, snapshots);
    // acme/a: v1 = 2M prompt*1 + 1M comp*4 = 2+4 = 6; v2 = 1M*1 + 0.5M*4 = 1+2 = 3 → family total 9
    // other/x: 'other/x-v3' untracked → fallback $3 prompt / $15 comp → 0 prompt + 1M comp*15 = 15
    const acme = families.find((f) => f.family === 'acme/a');
    const other = families.find((f) => f.family === 'other/x');
    expect(acme).toBeDefined();
    expect(acme!.monthly_usd).toBe(9);
    expect(acme!.models).toContain('acme/a-v1');
    expect(other).toBeDefined();
    expect(other!.monthly_usd).toBe(15);
  });

  it('3. evaluateBudgetRule returns ok with no alert under the threshold', () => {
    const ev = evaluateBudgetRule(rule(), [
      { model_id: 'acme/a-1', monthly_prompt_tokens: 100_000, monthly_comp_tokens: 50_000 },
    ], [snap('acme/a-1', 'Acme')]);
    expect(ev.status).toBe('ok');
    expect(ev.pct_used).toBeLessThan(0.8);
    expect(ev.new_alert).toBeNull();
  });

  it('4. Crossed threshold classifies approaching and emits a threshold alert', () => {
    const ev = evaluateBudgetRule(rule({ monthly_budget_usd: 10, alert_threshold_pct: 0.8 }), [
      { model_id: 'acme/a-1', monthly_prompt_tokens: 10_000_000, monthly_comp_tokens: 2_000_000 },
    ], [snap('acme/a-1', 'Acme')]);
    // spend = 10M/1M*1 + 2M/1M*4 = 10 + 8 = 18 vs budget 10 → 1.8 → over (not approaching)
    expect(ev.status).toBe('over');
  });

  it('5. spend above budget classifies over with an over_budget alert', () => {
    const ev = evaluateBudgetRule(rule({ monthly_budget_usd: 12, alert_threshold_pct: 0.8 }), [
      { model_id: 'acme/a-1', monthly_prompt_tokens: 2_000_000, monthly_comp_tokens: 2_000_000 },
    ], [snap('acme/a-1', 'Acme')]);
    // spend = 2 + 8 = 10 of 12 → 0.83 → approaching
    expect(ev.status).toBe('approaching');
    expect(ev.new_alert!.alert_type).toBe('threshold');
    expect(ev.new_alert!.message).toContain('approaching');

    const over = evaluateBudgetRule(rule({ monthly_budget_usd: 8 }), [
      { model_id: 'acme/a-1', monthly_prompt_tokens: 2_000_000, monthly_comp_tokens: 2_000_000 },
    ], [snap('acme/a-1', 'Acme')]);
    expect(over.status).toBe('over');
    expect(over.new_alert!.alert_type).toBe('over_budget');
  });

  it('6. detectShadowAI flags untracked endpoints and honors an approved list', () => {
    const snapshots = [snap('acme/tracked', 'Acme')];
    const usage = [
      { model_id: 'acme/tracked', monthly_prompt_tokens: 1_000_000, monthly_comp_tokens: 0 },
      { model_id: 'ghost/internal', monthly_prompt_tokens: 2_000_000, monthly_comp_tokens: 1_000_000 },
    ];
    const findings = detectShadowAI(usage, snapshots);
    expect(findings.map((f) => f.model_id)).toEqual(['ghost/internal']);
    // untracked → fallback $3/$15 per 1M: 2M prompt*3 + 1M comp*15 = 6 + 15 = 21
    expect(findings[0].estimated_monthly_usd).toBe(21);

    const approved = detectShadowAI(usage, snapshots, ['ghost/internal']);
    expect(approved).toHaveLength(0);
  });

  it('7. switchRequiresApproval gates transitions when an over-budget rule requires approval', () => {
    const ev = evaluateBudgetRule(
      rule({ approval_required: true, monthly_budget_usd: 5 }),
      [{ model_id: 'acme/a-1', monthly_prompt_tokens: 10_000_000, monthly_comp_tokens: 2_000_000 }],
      [snap('acme/a-1', 'Acme')]
    );
    expect(ev.status).toBe('over');

    const gated = switchRequiresApproval([ev], 'acme/a-1');
    expect(gated).not.toBeNull();

    const notGated = switchRequiresApproval([ev], 'other/b-2');
    expect(notGated).toBeNull();

    const ok = evaluateBudgetRule(rule({ approval_required: true, monthly_budget_usd: 9999 }), [], []);
    expect(switchRequiresApproval([ok])).toBeNull();
  });
});

describe('Phase 5 - Budget governance: persistence', () => {
  const EX = `gov.persist.${Date.now()}`;

  it('8. createBudgetRule + scope queries round-trip personal and team rules', async () => {
    const personal = await createBudgetRule({
      name: 'Personal cap',
      scope: 'personal',
      owner_email: EX,
      monthly_budget_usd: 500,
      alert_threshold_pct: 0.9,
      approval_required: true,
    });
    expect(personal.id).toBeTruthy();
    expect(personal.monthly_budget_usd).toBe(500);
    expect(personal.approval_required).toBe(true);

    const owned = await getBudgetRulesForUser(EX);
    expect(owned.some((r) => r.id === personal.id)).toBe(true);

    const stranger = await getBudgetRulesForUser('someone.else@test.dev');
    expect(stranger.some((r) => r.id === personal.id)).toBe(false);
  });

  it('9. getBudgetRulesForTeam scopes team rules and getAllBudgetRules scans all', async () => {
    const teamRule = await createBudgetRule({
      name: 'Team cap',
      scope: 'team',
      team_id: 424242,
      owner_email: EX,
      monthly_budget_usd: 800,
    });
    const byTeam = await getBudgetRulesForTeam(424242);
    expect(byTeam.some((r) => r.id === teamRule.id)).toBe(true);
    const all = await getAllBudgetRules();
    expect(all.some((r) => r.id === teamRule.id)).toBe(true);
  });

  it('10. recordBudgetAlert + getBudgetAlerts round-trip with alert-type and recency filters', async () => {
    await recordBudgetAlert({
      rule_id: 1,
      model_family: 'acme',
      projected_monthly_usd: 1200,
      budget_usd: 1000,
      pct_used: 1.2,
      alert_type: 'over_budget',
      message: 'over',
    });
    const alerts = await getBudgetAlerts({ limit: 5 });
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].alert_type).toBe('over_budget');

    const recentOnly = await getBudgetAlerts({ sinceHours: 24, limit: 5 });
    expect(recentOnly.length).toBeGreaterThan(0);
  });

  it('11. Migration approval workflow: create → pending → decide → resolved', async () => {
    const created = await createMigrationApproval({
      rule_id: 1,
      team_id: null,
      from_model_id: 'acme/a-1',
      to_model_id: 'beta/z-9',
      monthly_savings_usd: 42.5,
      requested_by: EX,
    });
    expect(created.status).toBe('pending');

    const pending = await getMigrationApprovals({ status: 'pending' });
    expect(pending.some((a) => a.id === created.id)).toBe(true);

    const decided = await decideMigrationApproval(created.id!, 'approved', 'admin@test.dev');
    expect(decided!.status).toBe('approved');
    expect(decided!.reviewed_by).toBe('admin@test.dev');

    const after = await getMigrationApprovals({ status: 'pending' });
    expect(after.some((a) => a.id === created.id)).toBe(false);
  });
});

describe('Phase 5 - Budget governance: API (v1)', () => {
  async function withKey() {
    const user = await createOrGetUser({ email: `gov.api.${Date.now()}@test.dev` });
    const { plaintextKey, keyRecord } = generateApiKey(user.email, 'production');
    await createApiKey(keyRecord);
    return { key: plaintextKey, email: user.email };
  }

  it('12. Rules route rejects unauthenticated requests', async () => {
    const res = await rulesRoute(new NextRequest('http://localhost/api/v1/governance/rules'));
    expect(res.status).toBe(401);
  });

  it('13. POST rules creates a personal rule and GET lists it for the owner', async () => {
    const { key } = await withKey();
    const post = await postRulesRoute(
      new NextRequest('http://localhost/api/v1/governance/rules', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'API-created cap',
          scope: 'personal',
          monthly_budget_usd: 750,
          approval_required: true,
        }),
      })
    );
    expect(post.status).toBe(201);
    const created = await post.json();
    expect(created.rule.scope).toBe('personal');
    expect(created.rule.monthly_budget_usd).toBe(750);

    const get = await rulesRoute(
      new NextRequest('http://localhost/api/v1/governance/rules', {
        headers: { Authorization: `Bearer ${key}` },
      })
    );
    expect(get.status).toBe(200);
    const listed = await get.json();
    expect(listed.rules.some((r: any) => r.id === created.rule.id)).toBe(true);
  });

  it('14. POST rules rejects invalid budgets and team-scope for non-members', async () => {
    const { key } = await withKey();
    const bad = await postRulesRoute(
      new NextRequest('http://localhost/api/v1/governance/rules', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'personal', monthly_budget_usd: -5 }),
      })
    );
    expect(bad.status).toBe(400);

    const teamBad = await postRulesRoute(
      new NextRequest('http://localhost/api/v1/governance/rules', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'team', team_id: 999999, monthly_budget_usd: 100 }),
      })
    );
    expect(teamBad.status).toBe(403);
  });

  it('15. Status route returns a full governance report for an authenticated user', async () => {
    const { key, email } = await withKey();
    await insertSnapshots([snap('gov-tracked/model', 'Acme')]);
    await upsertUsageProfile({
      email,
      monthly_prompt_tokens: 5_000_000,
      monthly_comp_tokens: 2_000_000,
      primary_model_id: 'gov-tracked/model',
    });

    const post = await postRulesRoute(
      new NextRequest('http://localhost/api/v1/governance/rules', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Status cap', scope: 'personal', monthly_budget_usd: 5000 }),
      })
    );
    expect(post.status).toBe(201);

    const res = await statusRoute(
      new NextRequest('http://localhost/api/v1/governance/status', {
        headers: { Authorization: `Bearer ${key}` },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.rules)).toBe(true);
    expect(body.rules.length).toBeGreaterThanOrEqual(1);
    const rule = body.rules[0];
    expect(typeof rule.projected_monthly_usd).toBe('number');
    expect(typeof rule.pct_used).toBe('number');
    expect(['ok', 'approaching', 'over']).toContain(rule.status);
    expect(Array.isArray(body.shadow_ai)).toBe(true);
    expect(Array.isArray(body.pending_approvals)).toBe(true);
    expect(Array.isArray(body.recent_alerts)).toBe(true);
    expect(typeof body.total_budget_usd).toBe('number');
  });

  it('16. Approval routes: create pending request then approve as the rule owner', async () => {
    const { key, email } = await withKey();
    const post = await postRulesRoute(
      new NextRequest('http://localhost/api/v1/governance/rules', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Approval cap',
          scope: 'personal',
          monthly_budget_usd: 100,
          approval_required: true,
        }),
      })
    );
    const { rule } = await post.json();

    const req = await postApprovalRoute(
      new NextRequest('http://localhost/api/v1/governance/approvals', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rule_id: rule.id,
          from_model_id: 'acme/a-1',
          to_model_id: 'beta/z-9',
          monthly_savings_usd: 12,
        }),
      })
    );
    expect(req.status).toBe(201);
    const approval = (await req.json()).approval;
    expect(approval.status).toBe('pending');

    const decided = await decideApprovalRoute(
      new NextRequest(`http://localhost/api/v1/governance/approvals/${approval.id}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approved' }),
      }),
      { params: { id: String(approval.id) } }
    );
    expect(decided.status).toBe(200);
    const body = await decided.json();
    expect(body.approval.status).toBe('approved');
    expect(body.approval.reviewed_by).toBe(email);
  });
});