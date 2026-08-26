import { describe, it, expect } from 'vitest';
import { runMigrations } from '../scripts/migrate';

describe('Phase P4: Database Migration Runner', () => {
  it('1. Executes migrations idempotently and verifies expected tables', async () => {
    const result = await runMigrations();

    expect(result.success).toBe(true);
    expect(result.tablesCreated).toContain('model_snapshots');
    expect(result.tablesCreated).toContain('model_events');
    expect(result.tablesCreated).toContain('ingestion_runs');
    expect(result.tablesCreated).toContain('api_keys');
  });
});
