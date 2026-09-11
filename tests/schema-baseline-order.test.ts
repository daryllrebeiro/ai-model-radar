import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Audit follow-up: fresh Postgres installs were broken because eval_runs
 * (FK to teams/users) was declared before those tables in schema.sql.
 * This pins dependency order so it cannot regress silently again.
 */
describe('schema.sql baseline is fresh-install safe', () => {
  it('no table references a table created later in the file', () => {
    const sql = fs.readFileSync(path.join(process.cwd(), 'src/lib/db/schema.sql'), 'utf-8');
    const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThan(20);
    const pos = new Map(tables.map((t, i) => [t, i]));
    const blocks = sql.split(/(?=CREATE TABLE IF NOT EXISTS \w+)/g);
    const violations: string[] = [];
    for (const b of blocks) {
      const name = (b.match(/CREATE TABLE IF NOT EXISTS (\w+)/) || [])[1] || '(head)';
      for (const m of b.matchAll(/REFERENCES (\w+)\s*\(/g)) {
        const target = m[1];
        if (!pos.has(target) || (name !== '(head)' && (pos.get(target) as number) >= (pos.get(name) as number))) {
          violations.push(`${name} -> ${target}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
