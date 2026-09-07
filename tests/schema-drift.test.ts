import { describe, it, expect } from 'vitest';
import { runMigrations } from '../scripts/migrate';
import { isPostgres, getPgPool } from '../src/lib/db/client';
import { insertSnapshots, getLatestSnapshotsMap, getEvents } from '../src/lib/db/queries';

const EXPECTED_TABLES = [
  'model_snapshots',
  'model_events',
  'ingestion_runs',
  'api_keys',
  'digest_deliveries',
  'users',
  'user_watchlists',
  'alert_rules',
];

describe('P11.2: Schema & Migration Integrity', () => {
  it('runMigrations succeeds and returns all expected table names', async () => {
    const result = await runMigrations();
    expect(result.success).toBe(true);
    for (const table of EXPECTED_TABLES) {
      expect(result.tablesCreated).toContain(table);
    }
  });

  it('runMigrations is idempotent — second run succeeds without error', async () => {
    const first = await runMigrations();
    expect(first.success).toBe(true);

    const second = await runMigrations();
    expect(second.success).toBe(true);
    expect(second.tablesCreated).toEqual(first.tablesCreated);
  });

  if (isPostgres()) {
    it('model_current emits exactly one row per model on polled_at ties', async () => {
      // Regression: the old MAX(polled_at) self-join duplicated a model row
      // whenever two snapshots shared the same polled_at. Seed a tie and assert
      // the view + getLatestSnapshotsMap + getEvents all collapse to one row.
      const pool = getPgPool();
      const stamp = `${Date.now()}.${Math.floor(Math.random() * 1e6)}`;
      const modelId = `tie/${stamp}`;
      const tied = new Date('2026-03-15T12:00:00.000Z').toISOString();
      await insertSnapshots([
        { model_id: modelId, provider: 'TieCo', name: 'Tie Model A', price_prompt: 1, price_completion: 2, context_length: 1000, modality: 'text->text', is_free: false, raw_json: {}, polled_at: tied } as any,
        { model_id: modelId, provider: 'TieCo', name: 'Tie Model B', price_prompt: 3, price_completion: 4, context_length: 2000, modality: 'text->text', is_free: false, raw_json: {}, polled_at: tied } as any,
      ]);

      const viewRows = await pool.query(
        `SELECT model_id, COUNT(*) AS n FROM model_current WHERE model_id = $1 GROUP BY model_id`,
        [modelId]
      );
      expect(viewRows.rows.length).toBe(1);
      expect(Number(viewRows.rows[0].n)).toBe(1);

      const map = await getLatestSnapshotsMap();
      expect(map.has(modelId)).toBe(true);

      // Highest id wins the tie (deterministic, matches ORDER BY id DESC).
      const latest = map.get(modelId)!;
      expect(latest.name).toBe('Tie Model B');

      const feed = await getEvents({ search: stamp, limit: 10 });
      expect(feed.events.filter((e) => e.model_id === modelId).length).toBeLessThanOrEqual(1);

      await pool.query(`DELETE FROM model_snapshots WHERE model_id = $1`, [modelId]);
    });

    it('all expected tables exist in Postgres information_schema', async () => {
      const pool = getPgPool();
      const res = await pool.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      `);
      const existing = new Set(res.rows.map((r: any) => r.table_name));
      for (const table of EXPECTED_TABLES) {
        expect(existing.has(table)).toBe(true);
      }
    });

    it('schema_migrations table exists and tracks applied versions', async () => {
      const pool = getPgPool();
      const res = await pool.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'schema_migrations'
      `);
      expect(res.rows.length).toBe(1);
    });

    it('model_current view exists', async () => {
      const pool = getPgPool();
      const res = await pool.query(`
        SELECT viewname FROM pg_views
        WHERE schemaname = 'public' AND viewname = 'model_current'
      `);
      expect(res.rows.length).toBe(1);
    });

    it('users table has expected columns', async () => {
      const pool = getPgPool();
      const res = await pool.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users'
        ORDER BY ordinal_position
      `);
      const columns = res.rows.map((r: any) => r.column_name);
      expect(columns).toContain('id');
      expect(columns).toContain('email');
      expect(columns).toContain('role');
      expect(columns).toContain('tier');
      expect(columns).toContain('stripe_customer_id');
      expect(columns).toContain('stripe_subscription_id');
      expect(columns).toContain('created_at');
      expect(columns).toContain('updated_at');
    });

    it('alert_rules table has expected columns', async () => {
      const pool = getPgPool();
      const res = await pool.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'alert_rules'
        ORDER BY ordinal_position
      `);
      const columns = res.rows.map((r: any) => r.column_name);
      expect(columns).toContain('id');
      expect(columns).toContain('type');
      expect(columns).toContain('destination');
      expect(columns).toContain('active');
      expect(columns).toContain('min_price_drop_pct');
      expect(columns).toContain('created_at');
    });

    it('user_watchlists has foreign key to users', async () => {
      const pool = getPgPool();
      const res = await pool.query(`
        SELECT
          tc.constraint_name,
          kcu.column_name,
          ccu.table_name AS foreign_table_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_name = ccu.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_name = 'user_watchlists'
      `);
      expect(res.rows.length).toBeGreaterThanOrEqual(1);
      const fkColumns = res.rows.map((r: any) => r.column_name);
      expect(fkColumns).toContain('user_id');
    });
  }
});
