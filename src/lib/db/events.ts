/**
 * Event reads: bounded keyset-paginated getEvents plus the
 * getRecentEvents convenience wrapper.
 * Split out of queries.ts (god-module remediation) - same logic, new home.
 */
import { ModelEvent, EventFilterParams } from '@/types/events';
import { isPostgres, getPgPool, getLocalState } from './client';
import { extractProvider } from '../utils';
import { encodeCursor, decodeCursor } from '../pagination';
import { toIsoString } from './_shared';

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
    detected_at: toIsoString(row.detected_at),
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
