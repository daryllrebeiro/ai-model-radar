import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { buildRecommendations, maxMonthlySavingsForProfile } from '../src/lib/recommendation';
import { MarketSignal } from '../src/types/signals';
import { ModelSnapshot } from '../src/types/models';
import { createOrGetUser, createApiKey } from '../src/lib/db/queries';
import { generateApiKey } from '../src/lib/api-keys';
import { POST as recommendRoute } from '../src/app/api/v1/recommend/route';

function snap(modelId: string, provider: string, name: string, pricePrompt1m: number, priceComp1m: number): ModelSnapshot {
  return {
    model_id: modelId,
    provider,
    name,
    price_prompt: pricePrompt1m / 1_000_000,
    price_completion: priceComp1m / 1_000_000,
    context_length: 200000,
    modality: 'text->text',
    is_free: false,
    raw_json: {},
    polled_at: new Date().toISOString(),
  };
}

function signal(partial: Partial<MarketSignal>): MarketSignal {
  return {
    id: 'sig-test',
    signal_type: 'PRICE_DROP_EXPECTED',
    model_id: 'acme/cloud-3-opus',
    provider: 'acme',
    title: 'test',
    summary: 'test',
    evidence: { metric: 'm', current_value: 'c', baseline_value: 'b', deviation: 'd' },
    detected_at: new Date().toISOString(),
    severity: 'medium',
    strength: 18,
    ...partial,
  };
}

const PROFILE = {
  primary_model_id: 'acme/cloud-3-opus',
  monthly_prompt_tokens: 50_000_000,
  monthly_comp_tokens: 50_000_000,
};

const SNAPSHOTS: ModelSnapshot[] = [
  snap('acme/cloud-3-opus', 'Acme', 'Cloud 3 Opus', 3, 15),
  snap('acme/cloud-3-haiku', 'Acme', 'Cloud 3 Haiku', 1, 4),
  snap('acme/cloud-3-flash', 'Acme', 'Cloud 3 Flash', 0.5, 2),
];

const ARBITRAGE_SNAPSHOTS: ModelSnapshot[] = [
  snap('alpha/omni', 'Alpha', 'Alpha Omni', 5, 20),
  snap('beta/omni', 'Beta', 'Beta Omni', 1, 5),
];

describe('Phase 4 - MigrationSavings: recommendation engine', () => {
  it('1. Current monthly cost is exact; recommendations ranked by savings desc', () => {
    const report = buildRecommendations({ profile: PROFILE, snapshots: SNAPSHOTS });
    expect(report.primary_model.current_monthly_usd).toBe(900);

    const recs = report.recommendations;
    expect(recs.length).toBeGreaterThan(0);
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i - 1].monthly_savings_usd).toBeGreaterThanOrEqual(recs[i].monthly_savings_usd);
    }
    for (const r of recs) {
      expect(r.monthly_savings_usd).toBeGreaterThan(0);
      expect(r.annual_savings_usd).toBeGreaterThan(0);
    }
  });

  it('2. EOL signal for the primary model sets flag + risk factor', () => {
    const eol = signal({ signal_type: 'MODEL_EOL', id: 'sig-eol' });
    const report = buildRecommendations({ profile: PROFILE, snapshots: SNAPSHOTS, signals: [eol] });
    expect(report.flags.primary_eol).toBe(true);
    expect(report.recommendations[0]?.risk_factors.join(' ')).toContain('EOL');
  });

  it('3. Forecast on the primary model surfaces the waiting risk factor', () => {
    const forecast = signal({ signal_type: 'PRICE_DROP_EXPECTED', strength: 18 });
    const report = buildRecommendations({ profile: PROFILE, snapshots: SNAPSHOTS, signals: [forecast] });
    expect(report.flags.primary_forecast_drop).toBe(true);
    expect(report.recommendations[0]?.risk_factors.join(' ')).toContain('forecast to cut price');
  });

  it('4. Zero-volume profiles yield no recommendations', () => {
    const report = buildRecommendations({
      profile: { ...PROFILE, monthly_prompt_tokens: 0, monthly_comp_tokens: 0 },
      snapshots: SNAPSHOTS,
    });
    expect(report.best_switch).toBeNull();
    expect(report.recommendations).toHaveLength(0);
  });

  it('5. Cheaper same-family endpoint counts as $0-effort migration (arbitrage flag)', () => {
    const report = buildRecommendations({
      profile: { primary_model_id: 'alpha/omni', monthly_prompt_tokens: 10_000_000, monthly_comp_tokens: 10_000_000 },
      snapshots: ARBITRAGE_SNAPSHOTS,
    });
    expect(report.primary_model.current_monthly_usd).toBe(250);
    expect(report.flags.via_arbitrage).toBe(true);
    expect(report.best_switch).not.toBeNull();
    for (const r of report.recommendations) {
      expect(r.monthly_savings_usd).toBeGreaterThan(0);
    }
  });

  it('6. maxMonthlySavingsForProfile returns the single best switch', () => {
    const { monthly_savings_usd, best } = maxMonthlySavingsForProfile(PROFILE, SNAPSHOTS);
    expect(monthly_savings_usd).toBeGreaterThan(0);
    expect(best).not.toBeNull();
    expect(best!.monthly_savings_usd).toBe(monthly_savings_usd);
  });
});

describe('Phase 4 - MigrationSavings: /api/v1/recommend', () => {
  async function withKey() {
    const user = await createOrGetUser({ email: `recommend.${Date.now()}@test.dev`, tier: 'pro' });
    const { plaintextKey, keyRecord } = generateApiKey(user.email, 'production');
    await createApiKey(keyRecord);
    return plaintextKey;
  }

  it('7. Rejects unauthenticated requests', async () => {
    const res = await recommendRoute(new NextRequest('http://localhost/api/v1/recommend', { method: 'POST' }));
    expect(res.status).toBe(401);
  });

  it('8. Returns ranked recommendations for an inline profile', async () => {
    const key = await withKey();
    const res = await recommendRoute(
      new NextRequest('http://localhost/api/v1/recommend', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: PROFILE }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe('v1');
    expect(body.primary_model.current_monthly_usd).toBeGreaterThan(0);
    expect(Array.isArray(body.recommendations)).toBe(true);
    if (body.best_switch) {
      expect(body.best_switch.monthly_savings_usd).toBeGreaterThan(0);
    }
  });

  it('9. Persists the profile and reuses it on subsequent calls', async () => {
    const key = await withKey();
    const first = await recommendRoute(
      new NextRequest('http://localhost/api/v1/recommend', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: PROFILE }),
      })
    );
    expect(first.status).toBe(200);

    const second = await recommendRoute(
      new NextRequest('http://localhost/api/v1/recommend', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
    );
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body.primary_model.model_id).toBe('acme/cloud-3-opus');
  });

  it('10. Returns 400 when no profile exists and none is supplied', async () => {
    const user = await createOrGetUser({ email: `recommend.empty.${Date.now()}@test.dev`, tier: 'pro' });
    const { plaintextKey, keyRecord } = generateApiKey(user.email, 'production');
    await createApiKey(keyRecord);

    const res = await recommendRoute(
      new NextRequest('http://localhost/api/v1/recommend', {
        method: 'POST',
        headers: { Authorization: `Bearer ${plaintextKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(400);
  });
});
