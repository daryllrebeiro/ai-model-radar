import { describe, it, expect } from 'vitest';
import {
  TABLE_MANIFEST,
  RESTORE_ORDER,
  SERIAL_TABLES,
  localStateKeys,
} from '../src/lib/db/tables';
import { EXPECTED_TABLES } from '../scripts/migrate';
import { getLocalState } from '../src/lib/db/client';
import fs from 'fs';
import path from 'path';

/** P2: the 6-touch table tax, enforced by machine instead of diligence. */
describe('table manifest is the single source of truth', () => {
  it('manifest pg set equals EXPECTED_TABLES (no silent additions)', () => {
    expect(new Set(TABLE_MANIFEST.map((t) => t.pg))).toEqual(new Set(EXPECTED_TABLES));
    expect(TABLE_MANIFEST).toHaveLength(EXPECTED_TABLES.length);
  });

  it('FK children sort after parents in restore order', () => {
    const pos = new Map(RESTORE_ORDER.map((t, i) => [t, i]));
    const pairs: Array<[string, string]> = [
      ['teams', 'team_members'],
      ['teams', 'team_watchlists'],
      ['teams', 'budget_rules'],
      ['budget_rules', 'budget_alerts'],
      ['budget_rules', 'migration_approvals'],
      ['migration_approvals', 'approval_votes'],
      ['users', 'user_watchlists'],
      ['users', 'usage_profiles'],
    ];
    for (const [parent, child] of pairs) {
      expect(pos.get(parent)).toBeLessThan(pos.get(child) as number);
    }
  });

  it('serial flags: stripe ids table is TEXT-keyed, everything else serial', () => {
    expect(SERIAL_TABLES.has('processed_stripe_event_ids')).toBe(false);
    for (const t of TABLE_MANIFEST) {
      expect(SERIAL_TABLES.has(t.pg)).toBe(t.serial);
    }
  });

  it('every manifest local key hydrates in the file backend', () => {
    const keys = new Set(Object.keys(getLocalState()));
    for (const k of localStateKeys()) {
      expect(keys.has(k)).toBe(true);
    }
  });

  it('backup/restore/migrate import the manifest (no table literals)', () => {
    for (const f of ['scripts/backup-db.ts', 'scripts/restore-db.ts', 'scripts/migrate.ts']) {
      const src = fs.readFileSync(path.join(process.cwd(), f), 'utf-8');
      expect(src).toContain('db/tables');
      // No hardcoded quoted table names outside comments/strings that are SQL.
      const literals = src.match(/^\s*'[a-z_]+',?\s*$/gm) || [];
      expect(literals).toEqual([]);
    }
  });
});
