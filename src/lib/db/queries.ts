import { ModelSnapshot } from '@/types/models';
import { ModelEvent, EventFilterParams } from '@/types/events';
import { Team, TeamMember, TeamRole, TeamDetail } from '@/types/teams';
import { BudgetRule, BudgetRuleScope, BudgetAlertRecord, MigrationApproval, ShadowAiRecord, ShadowFindingStatus } from '@/types/governance';
import { isPostgres, getPgPool, getLocalState, saveLocalState } from './client';
import { EndpointTelemetry } from '@/types/telemetry';
import { extractProvider } from '../utils';
import { encodeCursor, decodeCursor } from '../pagination';

/**
 * Chunked multi-row INSERT: one round trip per batch instead of one per row.
 * Table/column names are always internal constants at call sites (never user
 * input); only values are bound as parameters. Chunk cap keeps parameter
 * counts far below the Postgres 65535 limit (1000 rows × ≤10 cols).
 */
const BULK_CHUNK_ROWS = 1000;

type Queryable = { query: (sql: string, params: any[]) => Promise<any> };

export { bulkInsert };
export type { Queryable };

async function bulkInsert(
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

/**
 * Bulk insert snapshots
 */
export async function insertSnapshots(snapshots: ModelSnapshot[]): Promise<void> {
  if (snapshots.length === 0) return;

  if (isPostgres()) {
    const pool = getPgPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await bulkInsert(
        client,
        'model_snapshots',
        ['model_id', 'provider', 'name', 'price_prompt', 'price_completion', 'context_length', 'modality', 'is_free', 'raw_json', 'polled_at'],
        snapshots.map((s) => [
          s.model_id,
          s.provider,
          s.name,
          s.price_prompt,
          s.price_completion,
          s.context_length,
          s.modality,
          s.is_free,
          JSON.stringify(s.raw_json),
          s.polled_at,
        ])
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else {
    const state = getLocalState();
    let idCounter = state.snapshots.length;
    for (const s of snapshots) {
      idCounter++;
      state.snapshots.push({
        ...s,
        id: idCounter,
      });
    }
    saveLocalState(state);
  }
}

/**
 * Bulk insert model events
 */
export async function insertEvents(events: ModelEvent[]): Promise<void> {
  if (events.length === 0) return;

  if (isPostgres()) {
    const pool = getPgPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await bulkInsert(
        client,
        'model_events',
        ['model_id', 'event_type', 'old_value', 'new_value', 'pct_change', 'source', 'detected_at'],
        events.map((e) => [
          e.model_id,
          e.event_type,
          e.old_value ? JSON.stringify(e.old_value) : null,
          e.new_value ? JSON.stringify(e.new_value) : null,
          e.pct_change,
          e.source,
          e.detected_at,
        ])
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else {
    const state = getLocalState();
    let idCounter = state.events.length;
    for (const e of events) {
      idCounter++;
      state.events.push({
        ...e,
        id: idCounter,
      });
    }
    saveLocalState(state);
  }
}

import { getUserByEmail } from './users';
import type { UserRecord } from './users';
export {
  getLatestSnapshotsMap,
  getKnownModelIds,
  getModelCurrentList,
  getModelDetail,
  HISTORY_RANGE_MS,
  isHistoryRange,
  getModelPriceHistory,
  getDealsData,
  getMarketStats,
} from './catalog';
export type { HistoryRange } from './catalog';

/**
 * Bounded Postgres implementation of getEvents. All predicates, ordering, and
 * the page window execute in SQL; Node receives at most limit+1 rows.
 * Keyset cursor (detected_at, id) is stable under concurrent inserts, unlike
 * OFFSET. Pass cursor for infinite scroll, offset for legacy callers.
 */
async function getEventsBounded(opts: {
  eventTypes: string[];
  provider?: string;
  isFree?: boolean;
  search?: string;
  limit: number;
  offset: number;
  startDate?: string;
  endDate?: string;
  cursor?: string;
}): Promise<{ events: ModelEvent[]; total: number; hasMore: boolean; nextCursor?: string }> {
  const pool = getPgPool();
  const whereClauses: string[] = ['1=1'];
  const sqlParams: any[] = [];
  let p = 1;

  if (opts.eventTypes.length > 0) {
    whereClauses.push(`e.event_type = ANY($${p++})`);
    sqlParams.push(opts.eventTypes);
  }
  if (opts.startDate) {
    whereClauses.push(`e.detected_at >= $${p++}`);
    sqlParams.push(opts.startDate);
  }
  if (opts.endDate) {
    whereClauses.push(`e.detected_at <= $${p++}`);
    sqlParams.push(opts.endDate);
  }
  if (opts.provider && opts.provider !== 'All') {
    // Metadata arrives via the current-state join; match it case-insensitively.
    whereClauses.push(`LOWER(COALESCE(c.provider, '')) = LOWER($${p++})`);
    sqlParams.push(opts.provider);
  }
  if (opts.isFree) {
    whereClauses.push(
      `(e.event_type = 'BECAME_FREE' OR (e.new_value IS NOT NULL AND e.new_value->>'is_free' = 'true'))`
    );
  }
  if (opts.search) {
    // Escape LIKE metacharacters so user input can't widen the match.
    const escaped = opts.search.replace(/([%_\\])/g, '\\$1');
    const pattern = `%${escaped}%`;
    whereClauses.push(
      `(e.model_id ILIKE $${p} ESCAPE '\\' OR COALESCE(c.name, e.model_id) ILIKE $${p} ESCAPE '\\' OR COALESCE(c.provider, '') ILIKE $${p} ESCAPE '\\')`
    );
    sqlParams.push(pattern);
    p++;
  }

  let cursorTime: string | null = null;
  let cursorId: number | null = null;
  if (opts.cursor) {
    const decoded = decodeCursor(opts.cursor);
    if (decoded && decoded.detected_at && typeof decoded.id === 'number') {
      cursorTime = decoded.detected_at;
      cursorId = decoded.id;
      // Row comparison matches the DESC ordering: later pages sort strictly below.
      whereClauses.push(`(e.detected_at, e.id) < ($${p++}, $${p++})`);
      sqlParams.push(cursorTime, cursorId);
    }
  }

  const safeLimit = Math.min(500, Math.max(1, Math.floor(opts.limit || 50)));
  const safeOffset = opts.cursor ? 0 : Math.max(0, Math.floor(opts.offset || 0));

  // +1 probe row determines hasMore without a second query; COUNT(*) OVER()
  // reports the filtered total in the same round trip.
  const querySql = `
    SELECT
      e.id, e.model_id, e.event_type, e.old_value, e.new_value,
      e.pct_change, e.source, e.detected_at,
      COALESCE(c.name, e.model_id) AS model_name,
      c.provider AS provider,
      c.context_length AS context_length,
      c.modality AS modality,
      c.is_free AS snapshot_is_free,
      COUNT(*) OVER() AS full_count
    FROM model_events e
    LEFT JOIN model_current c ON c.model_id = e.model_id
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY e.detected_at DESC, e.id DESC
    LIMIT $${p++} OFFSET $${p++}
  `;
  sqlParams.push(safeLimit + 1, safeOffset);

  const res = await pool.query(querySql, sqlParams);
  const total = res.rows.length > 0 ? Number(res.rows[0].full_count) : 0;
  const pageRows = res.rows.slice(0, safeLimit);
  const hasMore = res.rows.length > safeLimit;

  const events: ModelEvent[] = pageRows.map((row: any) => ({
    id: Number(row.id),
    model_id: row.model_id,
    event_type: row.event_type,
    old_value: typeof row.old_value === 'string' ? JSON.parse(row.old_value) : row.old_value,
    new_value: typeof row.new_value === 'string' ? JSON.parse(row.new_value) : row.new_value,
    pct_change: row.pct_change !== null ? Number(row.pct_change) : null,
    source: row.source,
    detected_at: row.detected_at,
    model_name: row.model_name || row.model_id,
    provider: row.provider || extractProvider(row.model_id),
    context_length: row.context_length,
    modality: row.modality,
  }));

  let nextCursor: string | undefined = undefined;
  if (hasMore && events.length > 0) {
    const last = events[events.length - 1];
    if (last.id && last.detected_at) {
      nextCursor = encodeCursor({
        detected_at: new Date(last.detected_at).toISOString(),
        id: last.id,
      });
    }
  }

  return { events, total, hasMore, nextCursor };
}

/**
 * Queries events with filters, pagination, and joined model details.
 *
 * Postgres path is fully bounded: every predicate, the ORDER BY, and the
 * LIMIT/OFFSET-or-keyset window are evaluated in SQL, so Node never holds
 * more than one page (+1 probe row). Model metadata comes from the
 * model_current view instead of a per-row LATERAL subquery. (Phase 2 will
 * materialize that view; the join shape stays the same.)
 */
export async function getEvents(params: EventFilterParams = {}): Promise<{
  events: ModelEvent[];
  total: number;
  hasMore: boolean;
  nextCursor?: string;
}> {
  const {
    eventTypes = [],
    provider,
    isFree,
    search,
    limit = 50,
    offset = 0,
    startDate,
    endDate,
  } = params;

  if (isPostgres()) {
    return getEventsBounded({
      eventTypes,
      provider,
      isFree,
      search,
      limit,
      offset,
      startDate,
      endDate,
      cursor: params.cursor,
    });
  }

  let allEvents: ModelEvent[] = [];

  {
    const state = getLocalState();
    const snapshotMap = new Map<string, any>();
    // Build latest snapshot lookup
    for (const s of state.snapshots) {
      snapshotMap.set(s.model_id, s);
    }

    allEvents = state.events.map((e) => {
      const snap = snapshotMap.get(e.model_id);
      return {
        ...e,
        model_name: snap?.name || e.model_name || e.model_id,
        provider: snap?.provider || e.provider || extractProvider(e.model_id),
        context_length: snap?.context_length ?? e.context_length ?? null,
        modality: snap?.modality || e.modality || 'text->text',
      };
    });
  }

  // Apply in-memory filtering for combined criteria (provider, search, isFree, eventTypes)
  let filtered = allEvents;

  if (eventTypes.length > 0) {
    const typeSet = new Set(eventTypes);
    filtered = filtered.filter((e) => typeSet.has(e.event_type));
  }

  if (provider && provider !== 'All') {
    filtered = filtered.filter(
      (e) => e.provider?.toLowerCase() === provider.toLowerCase()
    );
  }

  if (isFree) {
    filtered = filtered.filter((e) => {
      return (
        e.event_type === 'BECAME_FREE' ||
        (e.new_value && e.new_value.is_free === true)
      );
    });
  }

  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(
      (e) =>
        e.model_id.toLowerCase().includes(q) ||
        (e.model_name && e.model_name.toLowerCase().includes(q)) ||
        (e.provider && e.provider.toLowerCase().includes(q))
    );
  }

  // Sort newest first: detected_at DESC, id DESC
  filtered.sort((a, b) => {
    const timeDiff = new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime();
    if (timeDiff !== 0) return timeDiff;
    return (b.id || 0) - (a.id || 0);
  });

  // If cursor is provided, fast-forward past cursor (detected_at, id)
  if (params.cursor) {
    const decoded = decodeCursor(params.cursor);
    if (decoded) {
      const cursorTime = new Date(decoded.detected_at).getTime();
      const cursorId = decoded.id;
      filtered = filtered.filter((e) => {
        const eTime = new Date(e.detected_at).getTime();
        if (eTime < cursorTime) return true;
        if (eTime === cursorTime && (e.id || 0) < cursorId) return true;
        return false;
      });
    }
  }

  const total = filtered.length;
  const paginated = params.cursor ? filtered.slice(0, limit) : filtered.slice(offset, offset + limit);
  const hasMore = params.cursor ? filtered.length > limit : offset + limit < total;

  let nextCursor: string | undefined = undefined;
  if (hasMore && paginated.length > 0) {
    const lastItem = paginated[paginated.length - 1];
    if (lastItem.id && lastItem.detected_at) {
      nextCursor = encodeCursor({ detected_at: lastItem.detected_at, id: lastItem.id });
    }
  }

  return {
    events: paginated,
    total,
    hasMore,
    nextCursor,
  };
}

export interface IngestionRunRecord {
  id?: number;
  source: 'openrouter' | 'github' | 'huggingface';
  started_at: string;
  finished_at?: string;
  status: 'success' | 'partial' | 'failed';
  models_seen?: number;
  events_emitted?: number;
  error_detail?: string;
}

/**
 * Records an ingestion run log entry for reliability and observability
 */
export async function recordIngestionRun(run: IngestionRunRecord): Promise<void> {
  if (isPostgres()) {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO ingestion_runs (source, started_at, finished_at, status, models_seen, events_emitted, error_detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        run.source,
        run.started_at,
        run.finished_at || new Date().toISOString(),
        run.status,
        run.models_seen || 0,
        run.events_emitted || 0,
        run.error_detail || null,
      ]
    );
  } else {
    const state = getLocalState();
    if (!state.ingestion_runs) state.ingestion_runs = [];
    state.ingestion_runs.unshift({
      ...run,
      id: state.ingestion_runs.length + 1,
      finished_at: run.finished_at || new Date().toISOString(),
    });
    saveLocalState(state);
  }
}

/**
 * Retrieves the latest ingestion runs across all sources
 */
export async function getLatestIngestionRuns(limit = 20): Promise<IngestionRunRecord[]> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT * FROM ingestion_runs ORDER BY started_at DESC LIMIT $1`,
      [limit]
    );
    return res.rows;
  } else {
    const state = getLocalState();
    return (state.ingestion_runs || []).slice(0, limit);
  }
}

/**
 * Saves snapshots, events, and records the ingestion run atomically
 */
export async function savePollTransaction(
  snapshots: ModelSnapshot[],
  events: ModelEvent[],
  runInfo: IngestionRunRecord
): Promise<void> {
  if (isPostgres()) {
    const pool = getPgPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await bulkInsert(
        client,
        'model_snapshots',
        ['model_id', 'provider', 'name', 'price_prompt', 'price_completion', 'context_length', 'modality', 'is_free', 'raw_json', 'polled_at'],
        snapshots.map((s) => [
          s.model_id,
          s.provider,
          s.name,
          s.price_prompt,
          s.price_completion,
          s.context_length,
          s.modality,
          s.is_free,
          JSON.stringify(s.raw_json),
          s.polled_at,
        ])
      );

      await bulkInsert(
        client,
        'model_events',
        ['model_id', 'event_type', 'old_value', 'new_value', 'pct_change', 'source', 'detected_at'],
        events.map((e) => [
          e.model_id,
          e.event_type,
          e.old_value ? JSON.stringify(e.old_value) : null,
          e.new_value ? JSON.stringify(e.new_value) : null,
          e.pct_change,
          e.source,
          e.detected_at,
        ])
      );

      await client.query(
        `INSERT INTO ingestion_runs (source, started_at, finished_at, status, models_seen, events_emitted, error_detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          runInfo.source,
          runInfo.started_at,
          runInfo.finished_at || new Date().toISOString(),
          runInfo.status,
          snapshots.length,
          events.length,
          runInfo.error_detail || null,
        ]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else {
    // Atomic local state save
    const state = getLocalState();
    let snapId = state.snapshots.length;
    for (const s of snapshots) {
      snapId++;
      state.snapshots.push({ ...s, id: snapId });
    }

    let eventId = state.events.length;
    for (const e of events) {
      eventId++;
      state.events.unshift({ ...e, id: eventId });
    }

    if (!state.ingestion_runs) state.ingestion_runs = [];
    state.ingestion_runs.unshift({
      ...runInfo,
      id: state.ingestion_runs.length + 1,
      models_seen: snapshots.length,
      events_emitted: events.length,
      finished_at: new Date().toISOString(),
    });

    saveLocalState(state);
  }
}

/**
 * Saves a new API key record
 */
export async function createApiKey(key: {
  key_hash: string;
  key_prefix: string;
  owner_email: string;
  tier: string;
  created_at: string;
}): Promise<void> {
  if (isPostgres()) {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO api_keys (key_hash, key_prefix, owner_email, tier, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [key.key_hash, key.key_prefix, key.owner_email, key.tier, key.created_at]
    );
  } else {
    const state = getLocalState();
    if (!state.api_keys) state.api_keys = [];
    state.api_keys.push({ ...key, id: state.api_keys.length + 1 });
    saveLocalState(state);
  }
}

/**
 * Looks up an API key record by its SHA-256 hash
 */
export async function findApiKeyByHash(keyHash: string): Promise<any | null> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(`SELECT * FROM api_keys WHERE key_hash = $1 LIMIT 1`, [keyHash]);
    return res.rows[0] || null;
  } else {
    const state = getLocalState();
    const key = (state.api_keys || []).find((k: any) => k.key_hash === keyHash);
    return key || null;
  }
}

/**
 * Updates the last_used_at timestamp for a given API key
 */
export async function updateApiKeyLastUsed(keyHash: string): Promise<void> {
  const now = new Date().toISOString();
  if (isPostgres()) {
    const pool = getPgPool();
    await pool.query(`UPDATE api_keys SET last_used_at = $1 WHERE key_hash = $2`, [now, keyHash]);
  } else {
    const state = getLocalState();
    const key = (state.api_keys || []).find((k: any) => k.key_hash === keyHash);
    if (key) {
      key.last_used_at = now;
      saveLocalState(state);
    }
  }
}

/**
 * Revokes an API key
 */
  export async function revokeApiKey(keyHash: string): Promise<void> {
    const now = new Date().toISOString();
    if (isPostgres()) {
      const pool = getPgPool();
      await pool.query(`UPDATE api_keys SET revoked_at = $1 WHERE key_hash = $2`, [now, keyHash]);
    } else {
      const state = getLocalState();
      const key = (state.api_keys || []).find((k: any) => k.key_hash === keyHash);
      if (key) {
        key.revoked_at = now;
        saveLocalState(state);
      }
    }
  }

export {
  revokeUserApiKeys,
  restoreUserApiKeys,
} from './users';

/**
 * Prunes raw_json payloads older than N days to prevent database bloat
 * while preserving core scalar attributes (prices, context, timestamps)
 */
export async function pruneOldRawJson(daysToKeep = 30): Promise<{ prunedCount: number }> {
  const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();

  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `UPDATE model_snapshots
       SET raw_json = '{}'::jsonb
       WHERE polled_at < $1 AND raw_json != '{}'::jsonb`,
      [cutoff]
    );
    return { prunedCount: res.rowCount || 0 };
  } else {
    const state = getLocalState();
    let count = 0;
    for (const snap of state.snapshots) {
      if (new Date(snap.polled_at).getTime() < new Date(cutoff).getTime() && snap.raw_json && Object.keys(snap.raw_json).length > 0) {
        snap.raw_json = {};
        count++;
      }
    }
    if (count > 0) {
      saveLocalState(state);
    }
    return { prunedCount: count };
  }
}

export interface DigestDeliveryRecord {
  id?: number;
  rule_id?: string;
  destination_url: string;
  payload_preview?: string;
  http_status?: number;
  attempts: number;
  delivered_at: string;
  success: boolean;
  error_message?: string;
}

/**
 * Records a webhook delivery attempt in the audit log
 */
export async function recordDigestDelivery(delivery: DigestDeliveryRecord): Promise<void> {
  if (isPostgres()) {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO digest_deliveries (rule_id, destination_url, payload_preview, http_status, attempts, delivered_at, success, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        delivery.rule_id || null,
        delivery.destination_url,
        delivery.payload_preview || null,
        delivery.http_status || null,
        delivery.attempts,
        delivery.delivered_at,
        delivery.success,
        delivery.error_message || null,
      ]
    );
  } else {
    const state = getLocalState();
    if (!state.digest_deliveries) state.digest_deliveries = [];
    state.digest_deliveries.unshift({ ...delivery, id: state.digest_deliveries.length + 1 });
    saveLocalState(state);
  }
}

/**
 * Retrieves the latest webhook delivery audit records
 */
export async function getRecentDigestDeliveries(limit = 20): Promise<DigestDeliveryRecord[]> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT * FROM digest_deliveries ORDER BY delivered_at DESC LIMIT $1`,
      [limit]
    );
    return res.rows.map((row: any) => ({
      id: Number(row.id),
      rule_id: row.rule_id,
      destination_url: row.destination_url,
      payload_preview: row.payload_preview,
      http_status: row.http_status !== null ? Number(row.http_status) : undefined,
      attempts: Number(row.attempts),
      delivered_at: row.delivered_at,
      success: Boolean(row.success),
      error_message: row.error_message,
    }));
  } else {
    const state = getLocalState();
    return (state.digest_deliveries || []).slice(0, limit);
  }
}

export interface AlertRuleRecord {
  id?: string | number;
  type: 'email' | 'webhook';
  destination: string;
  active: boolean;
  min_price_drop_pct?: number;
  created_at?: string;
}

/**
 * Retrieves recent model change events
 */
export async function getRecentEvents(limit = 25): Promise<ModelEvent[]> {
  const result = await getEvents({ limit });
  return result.events;
}

/**
 * Retrieves all active notification alert rules
 */
export async function getActiveAlertRules(): Promise<AlertRuleRecord[]> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT id, type, destination, active, min_price_drop_pct, created_at 
       FROM alert_rules 
       WHERE active = true`
    );
    return res.rows.map((r: any) => ({
      id: r.id,
      type: r.type,
      destination: r.destination,
      active: Boolean(r.active),
      min_price_drop_pct: r.min_price_drop_pct ? Number(r.min_price_drop_pct) : undefined,
      created_at: r.created_at,
    }));
  } else {
    const state = getLocalState();
    return ((state as any).alert_rules || [])
      .filter((r: any) => r.active !== false)
      .map((r: any) => ({
        id: r.id || r.destination,
        type: r.type || (r.destination?.includes('@') ? 'email' : 'webhook'),
        destination: r.destination,
        active: r.active !== false,
      }));
  }
}

  /**
   * Activates or deactivates an alert rule by numeric id. Prefer this over
   * destination matching: the old dual-key form (id OR destination) lets any
   * future id-from-client caller disable rules by destination string.
   */
  export async function updateAlertRuleStatusById(ruleId: string | number, active: boolean): Promise<void> {
    if (isPostgres()) {
      const pool = getPgPool();
      await pool.query(`UPDATE alert_rules SET active = $1 WHERE id = $2`, [active, ruleId]);
    } else {
      const state = getLocalState();
      if ((state as any).alert_rules) {
        const rule = (state as any).alert_rules.find((r: any) => Number(r.id) === Number(ruleId));
        if (rule) {
          rule.active = active;
          saveLocalState(state);
        }
      }
    }
  }

  /**
   * @deprecated Use updateAlertRuleStatusById. Retained for backwards
   * compatibility; do not use with client-supplied identifiers.
   */
  export async function updateAlertRuleStatus(ruleId: string | number, active: boolean): Promise<void> {
  if (isPostgres()) {
    const pool = getPgPool();
    await pool.query(`UPDATE alert_rules SET active = $1 WHERE id = $2 OR destination = $2::text`, [
      active,
      ruleId,
    ]);
  } else {
    const state = getLocalState();
    if ((state as any).alert_rules) {
      const rule = (state as any).alert_rules.find(
        (r: any) => r.id === ruleId || r.destination === ruleId
      );
      if (rule) {
        rule.active = active;
        saveLocalState(state);
      }
    }
  }
}

export {
  createOrGetUser,
  getUserByEmail,
  getUserById,
  updateUserTier,
  getAllUsers,
  normalizeAllUserTiers,
  isStripeEventProcessed,
  markStripeEventProcessed,
} from './users';
export type { UserRecord } from './users';

/**
 * Retrieves watchlist items for a given user
 */
export async function getUserWatchlist(userId: number): Promise<string[]> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT model_id FROM user_watchlists WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return res.rows.map((r: any) => r.model_id);
  } else {
    const state = getLocalState();
    return (state.user_watchlists || [])
      .filter((w: any) => w.user_id === userId)
      .map((w: any) => w.model_id);
  }
}

/**
 * Retrieves watchlist items for a given user by email address
 */
export async function getUserWatchlistByEmail(email: string): Promise<string[]> {
  const user = await getUserByEmail(email);
  if (!user || !user.id) return [];
  return getUserWatchlist(user.id);
}

/**
 * Pins a model to user watchlist
 */
export async function addToWatchlist(userId: number, modelId: string): Promise<boolean> {
  if (isPostgres()) {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO user_watchlists (user_id, model_id, created_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, model_id) DO NOTHING`,
      [userId, modelId]
    );
    return true;
  } else {
    const state = getLocalState();
    if (!state.user_watchlists) state.user_watchlists = [];
    const exists = state.user_watchlists.some(
      (w: any) => w.user_id === userId && w.model_id === modelId
    );
    if (!exists) {
      state.user_watchlists.push({
        id: state.user_watchlists.length + 1,
        user_id: userId,
        model_id: modelId,
        created_at: new Date().toISOString(),
      });
      saveLocalState(state);
    }
    return true;
  }
}

/**
 * Removes a model from user watchlist
 */
export async function removeFromWatchlist(userId: number, modelId: string): Promise<boolean> {
  if (isPostgres()) {
    const pool = getPgPool();
    await pool.query(
      `DELETE FROM user_watchlists WHERE user_id = $1 AND model_id = $2`,
      [userId, modelId]
    );
    return true;
  } else {
    const state = getLocalState();
    if (state.user_watchlists) {
      state.user_watchlists = state.user_watchlists.filter(
        (w: any) => !(w.user_id === userId && w.model_id === modelId)
      );
      saveLocalState(state);
    }
    return true;
  }
}

export interface UserExportData {
  profile: UserRecord;
  apiKeys: Array<{ key_prefix: string; tier: string; created_at: string; last_used_at?: string }>;
  alertRules: any[];
  watchlist: string[];
  exportedAt: string;
}

/**
 * Compiles a full GDPR data portability export package for a user
 */
export async function exportUserData(userId: number): Promise<UserExportData | null> {
  if (isPostgres()) {
    const pool = getPgPool();
    const userRes = await pool.query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [userId]);
    if (userRes.rows.length === 0) return null;
    const user = userRes.rows[0];

    const keysRes = await pool.query(
      `SELECT key_prefix, tier, created_at, last_used_at FROM api_keys WHERE owner_email = $1`,
      [user.email]
    );
    const watchlist = await getUserWatchlist(userId);

    return {
      profile: user,
      apiKeys: keysRes.rows,
      alertRules: [],
      watchlist,
      exportedAt: new Date().toISOString(),
    };
  } else {
    const state = getLocalState();
    const user = (state.users || []).find((u: any) => u.id === userId);
    if (!user) return null;

    const apiKeys = (state.api_keys || [])
      .filter((k: any) => k.owner_email === user.email)
      .map((k: any) => ({
        key_prefix: k.key_prefix,
        tier: k.tier,
        created_at: k.created_at,
        last_used_at: k.last_used_at,
      }));

    const watchlist = await getUserWatchlist(userId);

    return {
      profile: user,
      apiKeys,
      alertRules: [],
      watchlist,
      exportedAt: new Date().toISOString(),
    };
  }
}

/**
 * Permanently deletes a user account and purges associated data
 */
export async function deleteUserAccount(userId: number): Promise<boolean> {
  if (isPostgres()) {
    const pool = getPgPool();
    const userRes = await pool.query(`SELECT email FROM users WHERE id = $1`, [userId]);
    if (userRes.rows.length === 0) return false;
    const email = userRes.rows[0].email;

    // Delete api keys and user record (watchlists cascade on delete)
    await pool.query(`DELETE FROM api_keys WHERE owner_email = $1`, [email]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    return true;
  } else {
    const state = getLocalState();
    const userIdx = (state.users || []).findIndex((u: any) => u.id === userId);
    if (userIdx === -1) return false;
    const email = state.users[userIdx].email;

    state.users.splice(userIdx, 1);
    if (state.api_keys) {
      state.api_keys = state.api_keys.filter((k: any) => k.owner_email !== email);
    }
    if (state.user_watchlists) {
      state.user_watchlists = state.user_watchlists.filter((w: any) => w.user_id !== userId);
    }
    if (state.teams) {
      const ownedTeamIds = new Set(
        (state.teams as any[])
          .filter((t: any) => t.owner_email === email)
          .map((t: any) => t.id)
      );
      (state.teams as any[]) = (state.teams as any[]).filter((t: any) => t.owner_email !== email);
      if (state.team_watchlists) {
        (state as any).team_watchlists = (state as any).team_watchlists.filter(
          (w: any) => !ownedTeamIds.has(w.team_id)
        );
      }
      if (state.team_members) {
        (state as any).team_members = (state as any).team_members.filter(
          (m: any) => m.member_email !== email && !ownedTeamIds.has(m.team_id)
        );
      }
    }
    saveLocalState(state);
    return true;
  }
}

// ─── TEAM WORKSPACES (Enterprise) ───────────────────────────────────────

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return base || `team-${Date.now().toString(36)}`;
}

/**
 * Creates a team and adds the owner as an admin member.
 */
export async function createTeam(name: string, ownerEmail: string): Promise<Team> {
  const slug = slugify(name);
  const now = new Date().toISOString();
  const normalizedEmail = ownerEmail.trim().toLowerCase();

    if (isPostgres()) {
      const pool = getPgPool();
      // Look up the user's id for the authoritative owner_user_id FK
      const user = await getUserByEmail(normalizedEmail);
      const ownerUserId = user?.id || null;

      // Single transaction: a crash between the two inserts must not leave
      // an orphan team with no admin member (owner locked out).
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const inserted = await client.query(
          `INSERT INTO teams (name, slug, owner_email, owner_user_id, created_at)
           VALUES ($1, $2, $3, $4, NOW())
           RETURNING *`,
          [name, slug, normalizedEmail, ownerUserId]
        );
        const team = inserted.rows[0];
        await client.query(
          `INSERT INTO team_members (team_id, member_email, role, created_at)
           VALUES ($1, $2, 'admin', NOW())
           ON CONFLICT (team_id, member_email) DO NOTHING`,
          [team.id, normalizedEmail]
        );
        await client.query('COMMIT');
        return team;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } else {
    const state = getLocalState();
    if (!state.teams) state.teams = [];
    // Local backend: find user by email to get their id
    const user = (state.users || []).find((u: any) => u.email === normalizedEmail);
    const ownerUserId = user?.id || null;
    const team: Team = {
      id: state.teams.length + 1,
      name,
      slug,
      owner_email: normalizedEmail,
      owner_user_id: ownerUserId,
      created_at: now,
    };
    state.teams.push(team);
    if (!state.team_members) state.team_members = [];
    state.team_members.push({
      id: state.team_members.length + 1,
      team_id: team.id,
      member_email: normalizedEmail,
      role: 'admin',
      created_at: now,
    });
    saveLocalState(state);
    return team;
  }
}

/**
 * Lists teams the user can access (as owner or member).
 */
export async function getTeamsForUser(email: string, limit = 500): Promise<Team[]> {
  const normalized = email.toLowerCase().trim();
  const max = Math.min(5000, Math.max(1, Math.floor(limit)));
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT DISTINCT t.*
       FROM teams t
       LEFT JOIN team_members m ON m.team_id = t.id AND m.member_email = $1
       WHERE t.owner_email = $1 OR m.member_email = $1
       ORDER BY t.created_at DESC
       LIMIT $2`,
      [normalized, max]
    );
    return res.rows;
  } else {
    const state = getLocalState();
    const memberTeamIds = new Set(
      (state.team_members || [])
        .filter((m: any) => m.member_email === normalized)
        .map((m: any) => m.team_id)
    );
    return (state.teams || [])
      .filter((t: any) => t.owner_email === normalized || memberTeamIds.has(t.id))
      .slice(0, max);
  }
}

/**
 * Gets a single team by id.
 */
export async function getTeam(teamId: number): Promise<Team | null> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(`SELECT * FROM teams WHERE id = $1`, [teamId]);
    return res.rows[0] || null;
  } else {
    const state = getLocalState();
    return (state.teams || []).find((t: any) => t.id === teamId) || null;
  }
}

/**
 * Resolves the caller's role within a team, or null when not a member.
 */
export async function getTeamRole(teamId: number, email: string): Promise<TeamRole | null> {
  const normalized = email.toLowerCase().trim();
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT role FROM team_members WHERE team_id = $1 AND member_email = $2`,
      [teamId, normalized]
    );
    if (res.rows.length > 0) return res.rows[0].role as TeamRole;
  } else {
    const state = getLocalState();
    const member = (state.team_members || []).find(
      (m: any) => m.team_id === teamId && m.member_email === normalized
    );
    if (member) return member.role as TeamRole;
  }
  return null;
}

/**
 * Adds (or re-activates) a member in a team workspace.
 */
export async function addTeamMember(
  teamId: number,
  memberEmail: string,
  role: TeamRole = 'member'
): Promise<TeamMember> {
  const normalized = memberEmail.toLowerCase().trim();
  const now = new Date().toISOString();

  if (isPostgres()) {
    const pool = getPgPool();
    const inserted = await pool.query(
      `INSERT INTO team_members (team_id, member_email, role, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (team_id, member_email) DO UPDATE SET role = EXCLUDED.role
       RETURNING *`,
      [teamId, normalized, role]
    );
    return inserted.rows[0];
  } else {
    const state = getLocalState();
    if (!state.team_members) state.team_members = [];
    const existing = state.team_members.find(
      (m: any) => m.team_id === teamId && m.member_email === normalized
    );
    if (existing) {
      existing.role = role;
      saveLocalState(state);
      return existing;
    }
    const member: TeamMember = {
      id: state.team_members.length + 1,
      team_id: teamId,
      member_email: normalized,
      role,
      created_at: now,
    };
    state.team_members.push(member);
    saveLocalState(state);
    return member;
  }
}

/**
 * Removes a member from a team workspace.
 */
export async function removeTeamMember(teamId: number, memberEmail: string): Promise<boolean> {
  const normalized = memberEmail.toLowerCase().trim();
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `DELETE FROM team_members WHERE team_id = $1 AND member_email = $2`,
      [teamId, normalized]
    );
    return (res.rowCount || 0) > 0;
  } else {
    const state = getLocalState();
    const before = (state.team_members || []).length;
    state.team_members = (state.team_members || []).filter(
      (m: any) => !(m.team_id === teamId && m.member_email === normalized)
    );
    saveLocalState(state);
    return state.team_members.length < before;
  }
}

/**
 * Lists members of a team.
 */
export async function getTeamMembers(teamId: number): Promise<TeamMember[]> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT * FROM team_members WHERE team_id = $1 ORDER BY created_at ASC`,
      [teamId]
    );
    return res.rows;
  } else {
    const state = getLocalState();
    return (state.team_members || [])
      .filter((m: any) => m.team_id === teamId)
      .sort((a: any, b: any) => a.created_at.localeCompare(b.created_at));
  }
}

/**
 * Renames a team (slug preserved).
 */
export async function renameTeam(teamId: number, newName: string): Promise<Team | null> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `UPDATE teams SET name = $1 WHERE id = $2 RETURNING *`,
      [newName, teamId]
    );
    return res.rows[0] || null;
  } else {
    const state = getLocalState();
    const team = (state.teams || []).find((t: any) => t.id === teamId);
    if (team) {
      team.name = newName;
      saveLocalState(state);
    }
    return team || null;
  }
}

/**
 * Deletes a team and all cascaded members/shared watchlists.
 */
export async function deleteTeam(teamId: number): Promise<boolean> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
    return (res.rowCount || 0) > 0;
  } else {
    const state = getLocalState();
    const before = (state.teams || []).length;
    state.teams = (state.teams || []).filter((t: any) => t.id !== teamId);
    state.team_members = (state.team_members || []).filter((m: any) => m.team_id !== teamId);
    state.team_watchlists = (state.team_watchlists || []).filter((w: any) => w.team_id !== teamId);
    saveLocalState(state);
    return state.teams.length < before;
  }
}

/**
 * Fetches shared watchlist model IDs for a team.
 */
export async function getTeamWatchlist(teamId: number): Promise<string[]> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT model_id FROM team_watchlists WHERE team_id = $1 ORDER BY created_at DESC`,
      [teamId]
    );
    return res.rows.map((r: any) => r.model_id);
  } else {
    const state = getLocalState();
    return (state.team_watchlists || [])
      .filter((w: any) => w.team_id === teamId)
      .sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || ''))
      .map((w: any) => w.model_id);
  }
}

/**
 * Adds a model to the team's shared watchlist.
 */
export async function addToTeamWatchlist(
  teamId: number,
  modelId: string,
  addedByEmail: string
): Promise<boolean> {
  if (isPostgres()) {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO team_watchlists (team_id, model_id, added_by_email, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (team_id, model_id) DO NOTHING`,
      [teamId, modelId, addedByEmail]
    );
    return true;
  } else {
    const state = getLocalState();
    if (!state.team_watchlists) state.team_watchlists = [];
    const exists = state.team_watchlists.some(
      (w: any) => w.team_id === teamId && w.model_id === modelId
    );
    if (!exists) {
      state.team_watchlists.push({
        id: state.team_watchlists.length + 1,
        team_id: teamId,
        model_id: modelId,
        added_by_email: addedByEmail,
        created_at: new Date().toISOString(),
      });
      saveLocalState(state);
    }
    return true;
  }
}

/**
 * Removes a model from the team's shared watchlist.
 */
export async function removeFromTeamWatchlist(teamId: number, modelId: string): Promise<boolean> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `DELETE FROM team_watchlists WHERE team_id = $1 AND model_id = $2`,
      [teamId, modelId]
    );
    return (res.rowCount || 0) > 0;
  } else {
    const state = getLocalState();
    const before = (state.team_watchlists || []).length;
    state.team_watchlists = (state.team_watchlists || []).filter(
      (w: any) => !(w.team_id === teamId && w.model_id === modelId)
    );
    saveLocalState(state);
    return state.team_watchlists.length < before;
  }
}

/**
 * Full team detail: members + shared watchlist.
 */
export async function getTeamDetail(teamId: number): Promise<TeamDetail | null> {
  const team = await getTeam(teamId);
  if (!team) return null;
  const [members, sharedWatchlist] = await Promise.all([
    getTeamMembers(teamId),
    getTeamWatchlist(teamId),
  ]);
  return { ...team, members, sharedWatchlist };
}

export interface UsageProfile {
  email: string;
  user_id?: number | null;
  monthly_prompt_tokens: number;
  monthly_comp_tokens: number;
  cache_hit_ratio: number;
  batch_discount: number;
  primary_model_id: string;
  updated_at: string;
}

export interface UsageProfileInput {
  email: string;
  user_id?: number;
  monthly_prompt_tokens: number;
  monthly_comp_tokens: number;
  cache_hit_ratio?: number;
  batch_discount?: number;
  primary_model_id: string;
}

/**
 * Creates or updates a user's workload usage profile (upsert by user_id).
 * Falls back to email if user_id not provided.
 */
export async function upsertUsageProfile(profile: UsageProfileInput): Promise<UsageProfile> {
  const cacheHit = Math.min(1, Math.max(0, profile.cache_hit_ratio ?? 0));
  const batch = Math.min(1, Math.max(0, profile.batch_discount ?? 0));
  // Normalize once so stored emails always match users.email exactly —
  // unnormalized writes recreate the case/whitespace mismatch class that
  // migration 009 had to heal.
  const normalizedEmail = profile.email.trim().toLowerCase();
  // Resolve user_id from email if not provided
  let userId = profile.user_id;
  if (!userId) {
    const user = await getUserByEmail(normalizedEmail);
    userId = user?.id; // undefined if user not found
  }

  if (isPostgres()) {
    const pool = getPgPool();
    if (userId) {
      // Primary path: upsert by user_id
      const res = await pool.query(
        `INSERT INTO usage_profiles (email, user_id, monthly_prompt_tokens, monthly_comp_tokens, cache_hit_ratio, batch_discount, primary_model_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           email = EXCLUDED.email,
           monthly_prompt_tokens = EXCLUDED.monthly_prompt_tokens,
           monthly_comp_tokens = EXCLUDED.monthly_comp_tokens,
           cache_hit_ratio = EXCLUDED.cache_hit_ratio,
           batch_discount = EXCLUDED.batch_discount,
           primary_model_id = EXCLUDED.primary_model_id,
           updated_at = NOW()
         RETURNING email, user_id, monthly_prompt_tokens, monthly_comp_tokens, cache_hit_ratio, batch_discount, primary_model_id, updated_at`,
         [normalizedEmail, userId, Math.floor(profile.monthly_prompt_tokens), Math.floor(profile.monthly_comp_tokens), cacheHit, batch, profile.primary_model_id]
      );
      const r = res.rows[0];
      return {
        email: r.email,
        user_id: r.user_id,
        monthly_prompt_tokens: Number(r.monthly_prompt_tokens),
        monthly_comp_tokens: Number(r.monthly_comp_tokens),
        cache_hit_ratio: Number(r.cache_hit_ratio),
        batch_discount: Number(r.batch_discount),
        primary_model_id: r.primary_model_id,
        updated_at: r.updated_at,
      };
    } else {
      // Fallback: upsert by email (for legacy/unknown users)
      const res = await pool.query(
        `INSERT INTO usage_profiles (email, monthly_prompt_tokens, monthly_comp_tokens, cache_hit_ratio, batch_discount, primary_model_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (email) DO UPDATE SET
           monthly_prompt_tokens = EXCLUDED.monthly_prompt_tokens,
           monthly_comp_tokens = EXCLUDED.monthly_comp_tokens,
           cache_hit_ratio = EXCLUDED.cache_hit_ratio,
           batch_discount = EXCLUDED.batch_discount,
           primary_model_id = EXCLUDED.primary_model_id,
           updated_at = NOW()
         RETURNING email, user_id, monthly_prompt_tokens, monthly_comp_tokens, cache_hit_ratio, batch_discount, primary_model_id, updated_at`,
        [normalizedEmail, Math.floor(profile.monthly_prompt_tokens), Math.floor(profile.monthly_comp_tokens), cacheHit, batch, profile.primary_model_id]
      );
      const r = res.rows[0];
      return {
        email: r.email,
        user_id: r.user_id,
        monthly_prompt_tokens: Number(r.monthly_prompt_tokens),
        monthly_comp_tokens: Number(r.monthly_comp_tokens),
        cache_hit_ratio: Number(r.cache_hit_ratio),
        batch_discount: Number(r.batch_discount),
        primary_model_id: r.primary_model_id,
        updated_at: r.updated_at,
      };
    }
  } else {
    const state = getLocalState();
    if (!state.usage_profiles) state.usage_profiles = [];
    // Resolve user_id for local backend
    let userId = profile.user_id;
    if (!userId) {
      const user = (state.users || []).find((u: any) => u.email === normalizedEmail);
      userId = user?.id || null;
    }
    const existingIdx = state.usage_profiles.findIndex((p: any) => (userId ? p.user_id === userId : p.email === normalizedEmail));
    const record = {
      email: normalizedEmail,
      user_id: userId,
      monthly_prompt_tokens: Math.floor(profile.monthly_prompt_tokens),
      monthly_comp_tokens: Math.floor(profile.monthly_comp_tokens),
      cache_hit_ratio: cacheHit,
      batch_discount: batch,
      primary_model_id: profile.primary_model_id,
      updated_at: new Date().toISOString(),
    };
    if (existingIdx >= 0) {
      state.usage_profiles[existingIdx] = { ...state.usage_profiles[existingIdx], ...record };
    } else {
      state.usage_profiles.push({ id: state.usage_profiles.length + 1, ...record });
    }
    saveLocalState(state);
    return record;
  }
}

/**
 * Loads a user's usage profile by email, if one exists.
 * @deprecated Use getUsageProfileByUserId for new code (email is not a stable key).
 */
export async function getUsageProfileByEmail(email: string): Promise<UsageProfile | null> {
  const normalized = email.trim().toLowerCase();
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT email, user_id, monthly_prompt_tokens, monthly_comp_tokens, cache_hit_ratio, batch_discount, primary_model_id, updated_at
       FROM usage_profiles WHERE email = $1 LIMIT 1`,
      [normalized]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      email: r.email,
      user_id: r.user_id,
      monthly_prompt_tokens: Number(r.monthly_prompt_tokens),
      monthly_comp_tokens: Number(r.monthly_comp_tokens),
      cache_hit_ratio: Number(r.cache_hit_ratio),
      batch_discount: Number(r.batch_discount),
      primary_model_id: r.primary_model_id,
      updated_at: r.updated_at,
    };
  } else {
    const state = getLocalState();
    const match = (state.usage_profiles || []).find((p: any) => p.email === normalized);
    if (!match) return null;
    return {
      email: match.email,
      user_id: match.user_id,
      monthly_prompt_tokens: Number(match.monthly_prompt_tokens),
      monthly_comp_tokens: Number(match.monthly_comp_tokens),
      cache_hit_ratio: Number(match.cache_hit_ratio),
      batch_discount: Number(match.batch_discount),
      primary_model_id: match.primary_model_id,
      updated_at: match.updated_at,
    };
  }
}

/**
 * Loads a user's usage profile by user_id (preferred, stable key).
 */
export async function getUsageProfileByUserId(userId: number): Promise<UsageProfile | null> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT email, user_id, monthly_prompt_tokens, monthly_comp_tokens, cache_hit_ratio, batch_discount, primary_model_id, updated_at
       FROM usage_profiles WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      email: r.email,
      user_id: r.user_id,
      monthly_prompt_tokens: Number(r.monthly_prompt_tokens),
      monthly_comp_tokens: Number(r.monthly_comp_tokens),
      cache_hit_ratio: Number(r.cache_hit_ratio),
      batch_discount: Number(r.batch_discount),
      primary_model_id: r.primary_model_id,
      updated_at: r.updated_at,
    };
  } else {
    const state = getLocalState();
    const match = (state.usage_profiles || []).find((p: any) => p.user_id === userId);
    if (!match) return null;
    return {
      email: match.email,
      user_id: match.user_id,
      monthly_prompt_tokens: Number(match.monthly_prompt_tokens),
      monthly_comp_tokens: Number(match.monthly_comp_tokens),
      cache_hit_ratio: Number(match.cache_hit_ratio),
      batch_discount: Number(match.batch_discount),
      primary_model_id: match.primary_model_id,
      updated_at: match.updated_at,
    };
  }
}

// ─── ENDPOINT PROBE TELEMETRY (Pro, APT_PROBE) ─────────────────────

/**
 * Persists a single endpoint probe telemetry record.
 */
export async function saveEndpointTelemetry(record: EndpointTelemetry): Promise<void> {
  if (isPostgres()) {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO endpoint_telemetry
        (model_id, provider, endpoint_url, checked_at, online, http_status, p95_latency_ms, avg_latency_ms,
         tokens_per_sec, rate_limited, rate_limited_count, retry_after_sec, sample_count, is_free, free_tier_active, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        record.model_id,
        record.provider,
        record.endpoint_url || null,
        record.checked_at,
        record.online,
        record.http_status,
        record.p95_latency_ms,
        record.avg_latency_ms,
        record.tokens_per_sec,
        record.rate_limited,
        record.rate_limited_count,
        record.retry_after_sec,
        record.sample_count,
        record.is_free,
        record.free_tier_active,
        record.error || null,
      ]
    );
  } else {
    const state = getLocalState();
    if (!state.endpoint_telemetry) state.endpoint_telemetry = [];
    state.endpoint_telemetry.push({
      id: state.endpoint_telemetry.length + 1,
      model_id: record.model_id,
      provider: record.provider,
      endpoint_url: record.endpoint_url || null,
      checked_at: record.checked_at,
      online: Boolean(record.online),
      http_status: record.http_status,
      p95_latency_ms: record.p95_latency_ms !== null && record.p95_latency_ms !== undefined ? Number(record.p95_latency_ms) : null,
      avg_latency_ms: record.avg_latency_ms !== null && record.avg_latency_ms !== undefined ? Number(record.avg_latency_ms) : null,
      tokens_per_sec: record.tokens_per_sec !== null && record.tokens_per_sec !== undefined ? Number(record.tokens_per_sec) : null,
      rate_limited: Boolean(record.rate_limited),
      rate_limited_count: Number(record.rate_limited_count) || 0,
      retry_after_sec: record.retry_after_sec,
      sample_count: Number(record.sample_count) || 0,
      is_free: Boolean(record.is_free),
      free_tier_active: record.free_tier_active,
      error: record.error || null,
    });
    saveLocalState(state);
  }
}

export interface EndpointTelemetryQuery {
  modelId?: string;
  provider?: string;
  limit?: number;
  sinceMs?: number;
}

/**
 * Retrieves recent endpoint telemetry, newest first.
 */
export async function getRecentEndpointTelemetry(
  opts: EndpointTelemetryQuery = {}
): Promise<EndpointTelemetry[]> {
  const limit = Math.min(500, Math.max(1, Math.floor(opts.limit ?? 50)));

  if (isPostgres()) {
    const pool = getPgPool();
    const where: string[] = [];
    const params: any[] = [];
    if (opts.modelId) {
      params.push(opts.modelId);
      where.push(`model_id = $${params.length}`);
    }
    if (opts.provider) {
      params.push(opts.provider);
      where.push(`provider = $${params.length}`);
    }
    if (opts.sinceMs) {
      params.push(new Date(Date.now() - opts.sinceMs).toISOString());
      where.push(`checked_at >= $${params.length}`);
    }
    params.push(limit);
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const res = await pool.query(
      `SELECT * FROM endpoint_telemetry ${whereSql} ORDER BY checked_at DESC LIMIT $${params.length}`,
      params
    );
    return res.rows.map((r: any) => ({
      id: Number(r.id),
      model_id: r.model_id,
      provider: r.provider,
      endpoint_url: r.endpoint_url,
      checked_at: r.checked_at,
      online: Boolean(r.online),
      http_status: r.http_status,
      p95_latency_ms: r.p95_latency_ms !== null ? Number(r.p95_latency_ms) : null,
      avg_latency_ms: r.avg_latency_ms !== null ? Number(r.avg_latency_ms) : null,
      tokens_per_sec: r.tokens_per_sec !== null ? Number(r.tokens_per_sec) : null,
      rate_limited: Boolean(r.rate_limited),
      rate_limited_count: Number(r.rate_limited_count),
      retry_after_sec: r.retry_after_sec,
      sample_count: Number(r.sample_count),
      is_free: Boolean(r.is_free),
      free_tier_active: r.free_tier_active,
      error: r.error,
    }));
  } else {
    const state = getLocalState();
    const cutoff = opts.sinceMs ? new Date(Date.now() - opts.sinceMs).getTime() : null;
    const rows = (state.endpoint_telemetry || [])
      .filter((r: any) => !opts.modelId || r.model_id === opts.modelId)
      .filter((r: any) => !opts.provider || r.provider === opts.provider)
      .filter((r: any) => (cutoff === null ? true : new Date(r.checked_at).getTime() >= cutoff))
      .sort((a: any, b: any) => new Date(b.checked_at).getTime() - new Date(a.checked_at).getTime())
      .slice(0, limit);
    return rows.map((r: any) => ({
      ...r,
      online: Boolean(r.online),
      rate_limited: Boolean(r.rate_limited),
      is_free: Boolean(r.is_free),
    }));
  }
}

// ─── BUDGET GOVERNANCE (Enterprise, GOVERNANCE) ──────────────────

export interface BudgetRuleInput {
  name: string;
  scope: BudgetRuleScope;
  team_id?: number | null;
  owner_email: string;
  monthly_budget_usd: number;
  alert_threshold_pct?: number;
  approval_required?: boolean;
  hard_cap?: boolean;
  notify_email?: string | null;
  active?: boolean;
}

function mapBudgetRuleRows(rows: any[]): BudgetRule[] {
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    scope: r.scope,
    team_id: r.team_id !== null && r.team_id !== undefined ? Number(r.team_id) : null,
    owner_email: r.owner_email,
    owner_user_id: r.owner_user_id !== null && r.owner_user_id !== undefined ? Number(r.owner_user_id) : null,
    monthly_budget_usd: Number(r.monthly_budget_usd),
    alert_threshold_pct: Number(r.alert_threshold_pct),
    approval_required: Boolean(r.approval_required),
    hard_cap: Boolean(r.hard_cap ?? false),
    notify_email: r.notify_email || null,
    active: Boolean(r.active),
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

function mapBudgetRuleRow(r: any): BudgetRule {
  return mapBudgetRuleRows([r])[0];
}

export async function createBudgetRule(input: BudgetRuleInput): Promise<BudgetRule> {
  const threshold = Math.min(1, Math.max(0, input.alert_threshold_pct ?? 0.8));
  // Normalize once so stored emails always match users.email exactly.
  const normalizedOwnerEmail = input.owner_email.trim().toLowerCase();
  // Resolve owner_user_id from owner_email
  let ownerUserId: number | null = null;
  if (normalizedOwnerEmail) {
    const user = await getUserByEmail(normalizedOwnerEmail);
    ownerUserId = user?.id || null;
  }

  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `INSERT INTO budget_rules
        (name, scope, team_id, owner_email, owner_user_id, monthly_budget_usd, alert_threshold_pct, approval_required, hard_cap, notify_email, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        input.name,
        input.scope,
        input.team_id ?? null,
        normalizedOwnerEmail,
        ownerUserId,
        Math.floor(input.monthly_budget_usd * 100) / 100,
        threshold,
        Boolean(input.approval_required),
        Boolean(input.hard_cap),
        input.notify_email || null,
        input.active !== false,
      ]
    );
    return mapBudgetRuleRows(res.rows)[0];
  } else {
    const state = getLocalState();
    if (!state.budget_rules) state.budget_rules = [];
    const record = {
      id: state.budget_rules.length + 1,
      name: input.name,
      scope: input.scope,
      team_id: input.team_id ?? null,
      owner_email: normalizedOwnerEmail,
      owner_user_id: ownerUserId,
      monthly_budget_usd: Math.floor(input.monthly_budget_usd * 100) / 100,
      alert_threshold_pct: threshold,
      approval_required: Boolean(input.approval_required),
      hard_cap: Boolean(input.hard_cap),
      notify_email: input.notify_email || null,
      active: input.active !== false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    state.budget_rules.push(record);
    saveLocalState(state);
    return { ...record };
  }
}

export async function getBudgetRule(id: number): Promise<BudgetRule | null> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(`SELECT * FROM budget_rules WHERE id = $1 LIMIT 1`, [id]);
    if (res.rows.length === 0) return null;
    return mapBudgetRuleRows(res.rows)[0];
  } else {
    const state = getLocalState();
    return (state.budget_rules || []).find((r: any) => Number(r.id) === id) || null;
  }
}

/**
 * Rules the given user can see: their own personal rules plus rules of every
 * team they belong to. Uses owner_user_id as primary key (stable), with
 * owner_email as fallback for rows not yet migrated.
 */
export async function getBudgetRulesForUser(email: string, limit = 500): Promise<BudgetRule[]> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await getUserByEmail(normalizedEmail);
  const userId = user?.id || null;
  const max = Math.min(5000, Math.max(1, Math.floor(limit)));

  if (isPostgres()) {
    const pool = getPgPool();
    let res;
    if (userId) {
      // Primary path: use stable user_id FK
      res = await pool.query(
        `SELECT * FROM budget_rules
         WHERE owner_user_id = $1
            OR team_id IN (SELECT team_id FROM team_members WHERE member_email = $2)
         ORDER BY active DESC, id DESC
         LIMIT $3`,
        [userId, normalizedEmail, max]
      );
    } else {
      // Fallback: user not in DB yet, use email
      res = await pool.query(
        `SELECT * FROM budget_rules
         WHERE owner_email = $1
            OR team_id IN (SELECT team_id FROM team_members WHERE member_email = $1)
         ORDER BY active DESC, id DESC
         LIMIT $2`,
        [normalizedEmail, max]
      );
    }
    return mapBudgetRuleRows(res.rows);
  } else {
    const state = getLocalState();
    const teamIds = new Set(
      (state.team_members || [])
        .filter((m: any) => m.member_email === normalizedEmail)
        .map((m: any) => Number(m.team_id))
    );
    return (state.budget_rules || [])
      .filter((r: any) =>
        (userId ? r.owner_user_id === userId : r.owner_email === normalizedEmail) ||
        teamIds.has(Number(r.team_id))
      )
      .map(mapBudgetRuleRow)
      .sort((a: any, b: any) => Number(b.id) - Number(a.id))
      .slice(0, max);
  }
}

export async function getBudgetRulesForTeam(teamId: number): Promise<BudgetRule[]> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT * FROM budget_rules WHERE team_id = $1 ORDER BY active DESC, id DESC`,
      [teamId]
    );
    return mapBudgetRuleRows(res.rows);
  } else {
    const state = getLocalState();
    return (state.budget_rules || [])
      .filter((r: any) => Number(r.team_id) === teamId)
      .map(mapBudgetRuleRow);
  }
}

export async function getAllBudgetRules(limit = 200): Promise<BudgetRule[]> {
  const max = Math.min(500, Math.max(1, Math.floor(limit)));
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT * FROM budget_rules ORDER BY active DESC, id DESC LIMIT $1`,
      [max]
    );
    return mapBudgetRuleRows(res.rows);
  } else {
    const state = getLocalState();
    return (state.budget_rules || [])
      .sort((a: any, b: any) => Number(b.id) - Number(a.id))
      .slice(0, max)
      .map(mapBudgetRuleRow);
  }
}

export async function recordBudgetAlert(alert: BudgetAlertRecord): Promise<BudgetAlertRecord> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `INSERT INTO budget_alerts
        (rule_id, model_family, projected_monthly_usd, budget_usd, pct_used, alert_type, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        alert.rule_id ?? null,
        alert.model_family ?? null,
        alert.projected_monthly_usd,
        alert.budget_usd,
        alert.pct_used,
        alert.alert_type,
        alert.message,
      ]
    );
    const r = res.rows[0];
    return {
      id: Number(r.id),
      rule_id: r.rule_id !== null ? Number(r.rule_id) : undefined,
      model_family: r.model_family,
      projected_monthly_usd: Number(r.projected_monthly_usd),
      budget_usd: Number(r.budget_usd),
      pct_used: Number(r.pct_used),
      alert_type: r.alert_type,
      message: r.message,
      acknowledged: Boolean(r.acknowledged),
      created_at: r.created_at,
    };
  } else {
    const state = getLocalState();
    if (!state.budget_alerts) state.budget_alerts = [];
    const record = {
      id: state.budget_alerts.length + 1,
      rule_id: alert.rule_id ?? undefined,
      model_family: alert.model_family ?? null,
      projected_monthly_usd: alert.projected_monthly_usd,
      budget_usd: alert.budget_usd,
      pct_used: alert.pct_used,
      alert_type: alert.alert_type,
      message: alert.message,
      acknowledged: Boolean(alert.acknowledged),
      created_at: new Date().toISOString(),
    };
    state.budget_alerts.push(record);
    saveLocalState(state);
    return { ...record };
  }
}

export async function getBudgetAlerts(opts: {
  ruleIds?: number[];
  limit?: number;
  sinceHours?: number;
} = {}): Promise<BudgetAlertRecord[]> {
  const limit = Math.min(200, Math.max(1, Math.floor(opts.limit ?? 50)));
  if (isPostgres()) {
    const pool = getPgPool();
    const where: string[] = [];
    const params: any[] = [];
    if (opts.ruleIds && opts.ruleIds.length > 0) {
      params.push(opts.ruleIds);
      where.push(`rule_id = ANY($${params.length}::int[])`);
    }
    if (opts.sinceHours && opts.sinceHours > 0) {
      params.push(new Date(Date.now() - opts.sinceHours * 3600_000).toISOString());
      where.push(`created_at >= $${params.length}`);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit);
    const res = await pool.query(
      `SELECT * FROM budget_alerts ${whereSql} ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    );
    return res.rows.map((r: any) => ({
      id: Number(r.id),
      rule_id: r.rule_id !== null ? Number(r.rule_id) : undefined,
      model_family: r.model_family,
      projected_monthly_usd: Number(r.projected_monthly_usd),
      budget_usd: Number(r.budget_usd),
      pct_used: Number(r.pct_used),
      alert_type: r.alert_type,
      message: r.message,
      acknowledged: Boolean(r.acknowledged),
      created_at: r.created_at,
    }));
  } else {
    const state = getLocalState();
    const since = opts.sinceHours && opts.sinceHours > 0
      ? Date.now() - opts.sinceHours * 3600_000
      : 0;
    return (state.budget_alerts || [])
      .filter((a: any) => !opts.ruleIds || opts.ruleIds.length === 0 || opts.ruleIds.includes(Number(a.rule_id)))
      .filter((a: any) => new Date(a.created_at).getTime() >= since)
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit)
      .map((a: any) => ({
        ...a,
        rule_id: a.rule_id !== null && a.rule_id !== undefined ? Number(a.rule_id) : undefined,
      }));
  }
}

// ─── SHADOW-AI DISCOVERY FEED (015_shadow_ai_findings) ─────────────
// Persistent per-scope findings for models outside the tracked catalog.
// Upserts preserve first_seen; acknowledged/dismissed rows are never
// re-opened by the runner — status changes are explicit via
// setShadowFindingStatus.

function mapShadowRows(rows: any[]): ShadowAiRecord[] {
  return rows.map((r: any) => ({
    id: Number(r.id),
    model_id: r.model_id,
    scope: r.scope,
    team_id: r.team_id !== null && r.team_id !== undefined ? Number(r.team_id) : null,
    owner_email: r.owner_email,
    owner_user_id: r.owner_user_id !== null && r.owner_user_id !== undefined ? Number(r.owner_user_id) : null,
    first_seen: r.first_seen,
    last_seen: r.last_seen,
    estimated_monthly_usd: Number(r.estimated_monthly_usd),
    reason: r.reason,
    status: r.status as ShadowFindingStatus,
    created_at: r.created_at,
  }));
}

function shadowKeyMatch(a: any, scope: string, teamId: number | null, ownerEmail: string): boolean {
  if (scope === 'team') {
    return a.scope === 'team' && Number(a.team_id) === Number(teamId);
  }
  return a.scope === 'personal' && String(a.owner_email).toLowerCase() === ownerEmail;
}

export async function upsertShadowFinding(input: {
  model_id: string;
  scope: BudgetRuleScope;
  team_id?: number | null;
  owner_email: string;
  estimated_monthly_usd: number;
  reason: string;
}): Promise<{ record: ShadowAiRecord; created: boolean }> {
  const modelId = input.model_id.trim();
  if (!modelId) throw new Error('model_id must be a non-empty string');
  const scope: BudgetRuleScope = input.scope === 'team' ? 'team' : 'personal';
  const teamId = scope === 'team' ? (input.team_id ?? null) : null;
  if (scope === 'team' && (teamId === null || !Number.isInteger(teamId) || teamId <= 0)) {
    throw new Error('team_id must be a positive integer for team findings');
  }
  const ownerEmail = input.owner_email.trim().toLowerCase();
  const spend = Math.max(0, Math.round(Number(input.estimated_monthly_usd || 0) * 100) / 100);
  const reason = input.reason.slice(0, 2000);

  if (isPostgres()) {
    const pool = getPgPool();
    const user = ownerEmail ? await getUserByEmail(ownerEmail) : null;
    const ownerUserId = user?.id || null;
    // Partial unique indexes (ux_shadow_personal / ux_shadow_team) enforce
    // one row per scope key; the upsert refreshes last_seen + estimate but
    // never touches first_seen, status, or created_at. The arbiter must
    // match the row's scope — a team insert would raise on the personal
    // arbiter instead of conflicting, so route explicitly.
    const conflictTarget = scope === 'team'
      ? `(model_id, team_id) WHERE scope = 'team'`
      : `(model_id, owner_email) WHERE scope = 'personal'`;
    const res = await pool.query(
      `INSERT INTO shadow_ai_findings
        (model_id, scope, team_id, owner_email, owner_user_id, estimated_monthly_usd, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT ${conflictTarget}
       DO UPDATE SET last_seen = NOW(), estimated_monthly_usd = EXCLUDED.estimated_monthly_usd,
                     reason = EXCLUDED.reason
       RETURNING *, (xmax = 0) AS is_new`,
      [modelId, scope, teamId, ownerEmail, ownerUserId, spend, reason]
    );
    const row = mapShadowRows(res.rows)[0];
    return { record: row, created: res.rows[0]?.is_new === true };
  } else {
    const state = getLocalState();
    if (!state.shadow_ai_findings) state.shadow_ai_findings = [];
    const now = new Date().toISOString();
    const existing = (state.shadow_ai_findings as any[]).find((a: any) =>
      a.model_id === modelId && shadowKeyMatch(a, scope, teamId, ownerEmail)
    );
    if (existing) {
      existing.last_seen = now;
      existing.estimated_monthly_usd = spend;
      existing.reason = reason;
      saveLocalState(state);
      return { record: { ...existing }, created: false };
    }
    const record = {
      id: state.shadow_ai_findings.length + 1,
      model_id: modelId,
      scope,
      team_id: teamId,
      owner_email: ownerEmail,
      owner_user_id: null,
      first_seen: now,
      last_seen: now,
      estimated_monthly_usd: spend,
      reason,
      status: 'open' as ShadowFindingStatus,
      created_at: now,
    };
    state.shadow_ai_findings.push(record);
    saveLocalState(state);
    return { record: { ...record }, created: true };
  }
}

export async function getShadowFindings(opts: {
  email?: string;
  teamId?: number;
  status?: ShadowFindingStatus;
  limit?: number;
} = {}): Promise<ShadowAiRecord[]> {
  const limit = Math.min(500, Math.max(1, Math.floor(opts.limit ?? 100)));
  if (isPostgres()) {
    const pool = getPgPool();
    const where: string[] = [];
    const params: any[] = [];
    if (opts.email) {
      params.push(opts.email.trim().toLowerCase());
      where.push(`(owner_email = $${params.length} OR team_id IN (SELECT team_id FROM team_members WHERE member_email = $${params.length}))`);
    }
    if (opts.teamId !== undefined) {
      params.push(opts.teamId);
      where.push(`team_id = $${params.length}`);
    }
    if (opts.status) {
      params.push(opts.status);
      where.push(`status = $${params.length}`);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit);
    const res = await pool.query(
      `SELECT * FROM shadow_ai_findings ${whereSql} ORDER BY last_seen DESC LIMIT $${params.length}`,
      params
    );
    return mapShadowRows(res.rows);
  } else {
    const state = getLocalState();
    const email = opts.email ? opts.email.trim().toLowerCase() : null;
    const teamIds = new Set(
      ((state.team_members || []) as any[])
        .filter((m: any) => email && m.member_email === email)
        .map((m: any) => Number(m.team_id))
    );
    return ((state.shadow_ai_findings || []) as any[])
      .filter((a: any) => {
        if (email && !(a.owner_email === email || (a.scope === 'team' && teamIds.has(Number(a.team_id))))) return false;
        if (opts.teamId !== undefined && Number(a.team_id) !== opts.teamId) return false;
        if (opts.status && a.status !== opts.status) return false;
        return true;
      })
      .sort((a: any, b: any) => new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime())
      .slice(0, limit)
      .map((a: any) => ({ ...a }));
  }
}

export async function setShadowFindingStatus(
  id: number,
  status: ShadowFindingStatus
): Promise<ShadowAiRecord | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  if (status !== 'open' && status !== 'acknowledged' && status !== 'dismissed') return null;
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `UPDATE shadow_ai_findings SET status = $1 WHERE id = $2 RETURNING *`,
      [status, id]
    );
    if (res.rows.length === 0) return null;
    return mapShadowRows(res.rows)[0];
  } else {
    const state = getLocalState();
    const row = ((state.shadow_ai_findings || []) as any[]).find((a: any) => Number(a.id) === id);
    if (!row) return null;
    row.status = status;
    saveLocalState(state);
    return { ...row };
  }
}

export async function createMigrationApproval(input: {
  team_id?: number | null;
  rule_id?: number | null;
  from_model_id: string;
  to_model_id: string;
  monthly_savings_usd: number;
  requested_by: string;
}): Promise<MigrationApproval> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `INSERT INTO migration_approvals
        (team_id, rule_id, from_model_id, to_model_id, monthly_savings_usd, status, requested_by)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)
       RETURNING *`,
      [
        input.team_id ?? null,
        input.rule_id ?? null,
        input.from_model_id,
        input.to_model_id,
        input.monthly_savings_usd,
        input.requested_by,
      ]
    );
    const r = res.rows[0];
    return {
      id: Number(r.id),
      team_id: r.team_id !== null ? Number(r.team_id) : null,
      rule_id: r.rule_id !== null ? Number(r.rule_id) : null,
      from_model_id: r.from_model_id,
      to_model_id: r.to_model_id,
      monthly_savings_usd: Number(r.monthly_savings_usd),
      status: r.status,
      requested_by: r.requested_by,
      reviewed_by: r.reviewed_by,
      decision_at: r.decision_at,
      created_at: r.created_at,
    };
  } else {
    const state = getLocalState();
    if (!state.migration_approvals) state.migration_approvals = [];
    const record = {
      id: state.migration_approvals.length + 1,
      team_id: input.team_id ?? null,
      rule_id: input.rule_id ?? null,
      from_model_id: input.from_model_id,
      to_model_id: input.to_model_id,
      monthly_savings_usd: input.monthly_savings_usd,
      status: 'pending' as const,
      requested_by: input.requested_by,
      reviewed_by: null,
      decision_at: null,
      created_at: new Date().toISOString(),
    };
    state.migration_approvals.push(record);
    saveLocalState(state);
    return { ...record };
  }
}

export async function getMigrationApprovals(opts: {
  teamId?: number;
  status?: string;
  ruleIds?: number[];
  limit?: number;
} = {}): Promise<MigrationApproval[]> {
  const limit = Math.min(200, Math.max(1, Math.floor(opts.limit ?? 50)));
  if (isPostgres()) {
    const pool = getPgPool();
    const where: string[] = [];
    const params: any[] = [];
    if (opts.teamId !== undefined && opts.teamId !== null) {
      params.push(opts.teamId);
      where.push(`team_id = $${params.length}`);
    }
    if (opts.status) {
      params.push(opts.status);
      where.push(`status = $${params.length}`);
    }
    if (opts.ruleIds && opts.ruleIds.length > 0) {
      params.push(opts.ruleIds);
      where.push(`rule_id = ANY($${params.length}::int[])`);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit);
    const res = await pool.query(
      `SELECT * FROM migration_approvals ${whereSql} ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    );
    return res.rows.map((r: any) => ({
      id: Number(r.id),
      team_id: r.team_id !== null ? Number(r.team_id) : null,
      rule_id: r.rule_id !== null ? Number(r.rule_id) : null,
      from_model_id: r.from_model_id,
      to_model_id: r.to_model_id,
      monthly_savings_usd: Number(r.monthly_savings_usd),
      status: r.status,
      requested_by: r.requested_by,
      reviewed_by: r.reviewed_by,
      decision_at: r.decision_at,
      created_at: r.created_at,
    }));
  } else {
    const state = getLocalState();
    return (state.migration_approvals || [])
      .filter((a: any) => opts.teamId === undefined || opts.teamId === null || Number(a.team_id) === opts.teamId)
      .filter((a: any) => !opts.status || a.status === opts.status)
      .filter((a: any) => !opts.ruleIds || opts.ruleIds.length === 0 || opts.ruleIds.includes(Number(a.rule_id)))
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit)
      .map((a: any) => ({ ...a }));
  }
}

export async function decideMigrationApproval(
  id: number,
  decision: 'approved' | 'rejected',
  reviewedBy: string
): Promise<MigrationApproval | null> {
  if (isPostgres()) {
      const pool = getPgPool();
      // Optimistic guard: only pending rows transition. Concurrent
      // approve/reject races resolve to exactly one winner; losers get null.
      const res = await pool.query(
        `UPDATE migration_approvals
         SET status = $2, reviewed_by = $3, decision_at = NOW()
         WHERE id = $1 AND status = 'pending'
         RETURNING *`,
        [id, decision, reviewedBy]
      );
      if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: Number(r.id),
      team_id: r.team_id !== null ? Number(r.team_id) : null,
      rule_id: r.rule_id !== null ? Number(r.rule_id) : null,
      from_model_id: r.from_model_id,
      to_model_id: r.to_model_id,
      monthly_savings_usd: Number(r.monthly_savings_usd),
      status: r.status,
      requested_by: r.requested_by,
      reviewed_by: r.reviewed_by,
      decision_at: r.decision_at,
      created_at: r.created_at,
    };
  } else {
      const state = getLocalState();
      const match = (state.migration_approvals || []).find((a: any) => Number(a.id) === id);
      if (!match || match.status !== 'pending') return null;
      match.status = decision;
      match.reviewed_by = reviewedBy;
      match.decision_at = new Date().toISOString();
      saveLocalState(state);
      return { ...match };
  }
}

