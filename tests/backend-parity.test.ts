import { describe, it, expect } from 'vitest';
import {
  getModelCurrentList,
  getEvents,
  getBudgetRulesForUser,
  getUserByEmail,
  addToWatchlist,
  getUserWatchlist,
} from '../src/lib/db/queries';
import { seedTeamWithGovernance, seedCatalog } from './helpers';

/**
 * Cross-backend parity: the same seed must produce identical results from
 * both engines. Runs the read suite against the current backend, flips
 * DATABASE_URL to force the other engine, re-seeds identically, and compares.
 * This pins the dual-backend contract the whole codebase depends on.
 *
 * When the alternate backend is unreachable (local CI without Postgres),
 * the flip is skipped rather than failed — the current-engine assertions
 * below still execute.
 */
describe('Cross-backend parity (Postgres <=> local JSON)', () => {
  it('1. catalog, events, and governance reads agree across engines', async () => {
    const prefix = `parity.${Date.now()}.${Math.floor(Math.random() * 1e6)}`;

    const runSuite = async () => {
      // Deterministic seeds: both engine runs must see identical input.
      const ownerEmail = `${prefix}.owner@test.dev`;
      await seedTeamWithGovernance(prefix, ownerEmail);
      await seedCatalog(prefix);
      const gov = await seedTeamWithGovernance(`${prefix}.gov`, `${prefix}.gov.owner@test.dev`);
      const [list, events, rules] = await Promise.all([
        getModelCurrentList({ search: prefix, limit: 100 }),
        getEvents({ search: prefix, limit: 50 }),
        getBudgetRulesForUser(gov.email),
      ]);
      // Users + watchlists: same seed, both engines must agree.
      const seen = await getUserByEmail(gov.email);
      await addToWatchlist(seen!.id, `${prefix}/m0`);
      const watchlist = await getUserWatchlist(seen!.id);
      return {
        user: seen ? { email: seen.email, tier: seen.tier } : null,
        watchlist: [...watchlist].sort(),
        models: list.models
          .filter((m) => m.model_id.startsWith(prefix))
          .map((m) => ({
            model_id: m.model_id, provider: m.provider, name: m.name,
            price_prompt: m.price_prompt, is_free: m.is_free,
          }))
          .sort((a, b) => (a.model_id < b.model_id ? -1 : 1)),
        events: events.events.map((e) => ({
          model_id: e.model_id, event_type: e.event_type, pct_change: e.pct_change,
        })),
        eventTotal: events.total,
        rules: rules
          .filter((r) => r.name.startsWith(`${prefix}.gov`))
          .map((r) => ({
            name: r.name, scope: r.scope, monthly_budget_usd: r.monthly_budget_usd,
          })),
      };
    };

    const savedUrl = process.env.DATABASE_URL;
    const firstIsPostgres = (savedUrl || '').startsWith('postgres');
    const first = await runSuite();
    expect(first.models).toHaveLength(1);
    expect(first.events).toHaveLength(1);
    expect(first.rules).toHaveLength(2);

    // Flip engines and compare. Guard the flip: only attempt the alternate
    // backend if it is reachable.
    const tryFlip = async (): Promise<boolean> => {
      try {
        if (firstIsPostgres) {
          delete process.env.DATABASE_URL;
          return true;
        }
        const { Client } = await import('pg');
        const probe = new Client({
          connectionString: 'postgresql://postgres:postgres@localhost:5432/ai_model_radar_test',
          connectionTimeoutMillis: 2000,
        });
        await probe.connect();
        await probe.end();
        process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/ai_model_radar_test';
        return true;
      } catch {
        return false;
      }
    };

    try {
      if (await tryFlip()) {
        const second = await runSuite();
        expect(second).toEqual(first);
      } else {
        console.log('[parity] alternate backend unreachable, current-engine assertions stand');
      }
    } finally {
      if (savedUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = savedUrl;
    }
  });
});
