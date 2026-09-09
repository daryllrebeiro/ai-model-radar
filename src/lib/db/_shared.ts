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
