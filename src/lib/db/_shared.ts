/**
 * Shared DB primitives for all db/* domain modules.
 * Split out of queries.ts (god-module remediation): chunked multi-row
 * INSERT helper plus the transaction-client shape. Table/column names are
 * always internal constants at call sites (never user input); only values
 * are bound as parameters. Chunk cap keeps parameter counts far below the
 * Postgres 65535 limit (1000 rows x <=10 cols).
 */
export const BULK_CHUNK_ROWS = 1000;

export type Queryable = { query: (sql: string, params: any[]) => Promise<any> };

/**
 * Audit follow-up (backend-divergence crash): node-pg returns TIMESTAMPTZ
 * as Date objects while the JSON backend stores ISO strings — but every
 * row type declares ISO strings. Normalize at the PG mapper boundary so
 * downstream code (`.slice`, string compare, JSON) behaves identically on
 * both backends. Fail-loud on garbage: a corrupt timestamp must surface,
 * not silently become "now".
 */
export function toIsoString(v: unknown): string {
  if (typeof v === 'string') return v;
  const t = v instanceof Date ? v.getTime() : new Date(v as any).getTime();
  if (!Number.isFinite(t)) throw new Error('Invalid timestamp value from database row.');
  return new Date(t).toISOString();
}

export async function bulkInsert(
  client: Queryable,
  table: string,
  columns: string[],
  rows: any[][]
): Promise<void> {
  for (let i = 0; i < rows.length; i += BULK_CHUNK_ROWS) {
    const batch = rows.slice(i, i + BULK_CHUNK_ROWS);
    const placeholders: string[] = [];
    const values: any[] = [];
    batch.forEach((row, bi) => {
      const base = bi * columns.length;
      placeholders.push(`(${row.map((_, ci) => `$${base + ci + 1}`).join(', ')})`);
      values.push(...row);
    });
    await client.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders.join(', ')}`,
      values
    );
  }
}
