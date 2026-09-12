/**
 * Catalog reads: latest snapshots, model directory, detail, price history,
 * deals, and market stats. Split out of queries.ts (god-module remediation,
 * first cut) — same logic, new home. queries.ts re-exports everything, so
 * no caller changes. NOTE: imports getEvents from './events' (used only
 * inside function bodies; no import cycles remain after the split).
 */
import { ModelSnapshot, ModelCurrent } from '@/types/models';
import { ModelEvent, MarketStats, PriceDropDeal } from '@/types/events';
import { isPostgres, getPgPool, getLocalState } from './client';
import { extractProvider } from '../utils';
import { getEvents } from './events';
import { toIsoString } from './_shared';
import {
  AttributeFilters,
  applyAttributeFilters,
  hasAttributeFilters,
  applyCategoryFilter,
  sortModelsByLatency,
} from '../catalog-enrichment';
import { ACTIVE_PROBE_SCOPE_NOTE } from '@/types/active-probe';

/**
 * Returns latest snapshot per model_id
 */
export async function getLatestSnapshotsMap(): Promise<Map<string, ModelSnapshot>> {
  const map = new Map<string, ModelSnapshot>();

  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(`
      SELECT DISTINCT ON (model_id) *
      FROM model_snapshots
      ORDER BY model_id, polled_at DESC, id DESC
    `);
    for (const row of res.rows) {
      map.set(row.model_id, {
        id: Number(row.id),
        model_id: row.model_id,
        provider: row.provider,
        name: row.name,
        price_prompt: row.price_prompt !== null ? Number(row.price_prompt) : null,
        price_completion: row.price_completion !== null ? Number(row.price_completion) : null,
        context_length: row.context_length !== null ? Number(row.context_length) : null,
        modality: row.modality,
        is_free: Boolean(row.is_free),
        raw_json: typeof row.raw_json === 'string' ? JSON.parse(row.raw_json) : row.raw_json,
        polled_at: toIsoString(row.polled_at),
      });
    }
  } else {
    const state = getLocalState();
    // Sort by polled_at asc then reduce to keep last
    const sorted = [...state.snapshots].sort(
      (a, b) => new Date(a.polled_at).getTime() - new Date(b.polled_at).getTime()
    );
    for (const s of sorted) {
      map.set(s.model_id, s);
    }
  }

  return map;
}

/**
 * Returns all distinct model IDs ever recorded in history
 */
export async function getKnownModelIds(): Promise<Set<string>> {
  const set = new Set<string>();

  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(`SELECT DISTINCT model_id FROM model_snapshots`);
    for (const row of res.rows) {
      set.add(row.model_id);
    }
  } else {
    const state = getLocalState();
    for (const s of state.snapshots) {
      set.add(s.model_id);
    }
  }

  return set;
}

/**
 * Returns current models directory list
 */
export async function getModelCurrentList(params: {  search?: string;
  provider?: string;
  isFree?: boolean;
  sortBy?: 'name' | 'price' | 'context' | 'updated';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
} = {}): Promise<{ models: ModelCurrent[]; total: number }> {
  const {
    search,
    provider,
    isFree,
    sortBy = 'name',
    sortOrder = 'asc',
    limit = 100,
    offset = 0,
  } = params;

  // Postgres: push predicates, ORDER BY, and the LIMIT window into SQL over
  // the model_current view (one latest row per model). COUNT(*) OVER()
  // reports the filtered total in the same round trip, so Node never holds
  // more than one page. Sort semantics mirror the legacy in-memory path:
  // NULL prices sort last ascending / first descending (Postgres default),
  // NULL context coerces to 0 via COALESCE.
  if (isPostgres()) {
    const pool = getPgPool();
    const where: string[] = ['1=1'];
    const sqlParams: any[] = [];
    let p = 1;

    if (provider && provider !== 'All') {
      where.push(`LOWER(provider) = LOWER($${p++})`);
      sqlParams.push(provider);
    }
    if (isFree) {
      where.push(`is_free = TRUE`);
    }
    if (search) {
      // Escape LIKE metacharacters so user input can't widen the match.
      const escaped = search.replace(/([%_\\])/g, '\\$1');
      const pattern = `%${escaped}%`;
      where.push(
        `(model_id ILIKE $${p} ESCAPE '\\' OR name ILIKE $${p} ESCAPE '\\' OR provider ILIKE $${p} ESCAPE '\\')`
      );
      sqlParams.push(pattern);
      p++;
    }

    const orderColumns: Record<string, string> = {
      name: 'name',
      price: 'price_prompt',
      context: 'COALESCE(context_length, 0)',
      updated: 'polled_at',
    };
    const orderCol = orderColumns[sortBy] || 'name';
    const dir = sortOrder === 'desc' ? 'DESC' : 'ASC';
    const safeLimit = Math.min(500, Math.max(1, Math.floor(limit)));
    const safeOffset = Math.max(0, Math.floor(offset));

    const res = await pool.query(
      `SELECT *, COUNT(*) OVER() AS full_count FROM model_current
       WHERE ${where.join(' AND ')}
       ORDER BY ${orderCol} ${dir}
       LIMIT $${p++} OFFSET $${p++}`,
      [...sqlParams, safeLimit, safeOffset]
    );
    const total = res.rows.length > 0 ? Number(res.rows[0].full_count) : 0;
    const models: ModelCurrent[] = res.rows.map((row: any) => ({
      id: Number(row.id),
      model_id: row.model_id,
      provider: row.provider,
      name: row.name,
      price_prompt: row.price_prompt !== null ? Number(row.price_prompt) : null,
      price_completion: row.price_completion !== null ? Number(row.price_completion) : null,
      context_length: row.context_length !== null ? Number(row.context_length) : null,
      modality: row.modality,
      is_free: Boolean(row.is_free),
      raw_json: typeof row.raw_json === 'string' ? JSON.parse(row.raw_json) : row.raw_json,
      polled_at: row.polled_at,
    }));
    return { models, total };
  }

  const snapshotMap = await getLatestSnapshotsMap();
  let models: ModelCurrent[] = Array.from(snapshotMap.values());

  if (provider && provider !== 'All') {
    models = models.filter(
      (m) => m.provider.toLowerCase() === provider.toLowerCase()
    );
  }

  if (isFree) {
    models = models.filter((m) => m.is_free);
  }

  if (search) {
    const q = search.toLowerCase();
    models = models.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.model_id.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q)
    );
  }

  // Sorting
  models.sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'name') {
      cmp = a.name.localeCompare(b.name);
    } else if (sortBy === 'price') {
      const aPrice = a.price_prompt ?? 999;
      const bPrice = b.price_prompt ?? 999;
      cmp = aPrice - bPrice;
    } else if (sortBy === 'context') {
      const aCtx = a.context_length ?? 0;
      const bCtx = b.context_length ?? 0;
      cmp = aCtx - bCtx;
    } else if (sortBy === 'updated') {
      cmp = new Date(a.polled_at).getTime() - new Date(b.polled_at).getTime();
    }
    return sortOrder === 'desc' ? -cmp : cmp;
  });

  const total = models.length;
  const paginated = models.slice(offset, offset + limit);

  return { models: paginated, total };
}

export interface CatalogQueryOptions {
  search?: string;
  provider?: string;
  isFree?: boolean;
  sortBy?: 'name' | 'price' | 'context' | 'updated' | 'latency';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  filters?: AttributeFilters;
  category?: string;
  /**
   * Injected latest-p95 provider (keeps enrichment DB-free): the route
   * supplies a closure over getRecentEndpointTelemetry when sortBy is
   * 'latency'. Absent + latency requested → latency sort is skipped, never
   * guessed.
   */
  fetchLatencyP95?: () => Promise<Map<string, number>>;
}

/**
 * Single catalog entry point shared by the legacy `/api/models` and
 * `v1/models` twins (ADR-4: no third copy). Encapsulates the bounded-window
 * read (500 = catalog cap), attribute + category filters, latency sort,
 * and pagination so `total` always reflects the filtered set.
 */
export async function queryCatalog(opts: CatalogQueryOptions = {}): Promise<{
  models: ModelCurrent[];
  total: number;
  latencyScope?: string;
}> {
  const {
    search,
    provider,
    isFree,
    sortBy = 'name',
    sortOrder = 'asc',
    limit = 100,
    offset = 0,
    filters = {},
    category = 'all',
  } = opts;
  const latencySort = sortBy === 'latency';
  const needsWindow = hasAttributeFilters(filters) || (category !== 'all' && category !== undefined) || latencySort;
  const data = await getModelCurrentList({
    search,
    provider,
    isFree,
    sortBy: (latencySort ? 'name' : sortBy) as 'name' | 'price' | 'context' | 'updated',
    sortOrder,
    limit: needsWindow ? 500 : limit,
    offset: needsWindow ? 0 : offset,
  });
  let models = applyCategoryFilter(applyAttributeFilters(data.models, filters), category);
  let latencyScope: string | undefined;
  if (latencySort) {
    if (opts.fetchLatencyP95) {
      models = sortModelsByLatency(models, await opts.fetchLatencyP95());
      latencyScope = ACTIVE_PROBE_SCOPE_NOTE;
    }
    // Without telemetry the catalog order stands — never fabricate latency.
  }
  const total = needsWindow ? models.length : data.total;
  const page = needsWindow ? models.slice(offset, offset + limit) : models;
  return { models: page, total, latencyScope };
}

/**
 * Returns full history for a specific model
 */
export async function getModelDetail(modelId: string): Promise<{
  current: ModelSnapshot | null;
  snapshots: ModelSnapshot[];
  events: ModelEvent[];
} | null> {
  let snapshots: ModelSnapshot[] = [];
  let events: ModelEvent[] = [];

  if (isPostgres()) {
    const pool = getPgPool();
    // Independent queries: one round trip instead of two sequential ones.
    const [sRes, eRes] = await Promise.all([
      pool.query(
        `SELECT * FROM model_snapshots WHERE model_id = $1 ORDER BY polled_at ASC`,
        [modelId]
      ),
      pool.query(
        `SELECT * FROM model_events WHERE model_id = $1 ORDER BY detected_at DESC`,
        [modelId]
      ),
    ]);
    snapshots = sRes.rows.map((r: any) => ({
      id: Number(r.id),
      model_id: r.model_id,
      provider: r.provider,
      name: r.name,
      price_prompt: r.price_prompt !== null ? Number(r.price_prompt) : null,
      price_completion: r.price_completion !== null ? Number(r.price_completion) : null,
      context_length: r.context_length !== null ? Number(r.context_length) : null,
      modality: r.modality,
      is_free: Boolean(r.is_free),
      raw_json: typeof r.raw_json === 'string' ? JSON.parse(r.raw_json) : r.raw_json,
        polled_at: toIsoString(r.polled_at),
    }));

    events = eRes.rows.map((r: any) => ({
      id: Number(r.id),
      model_id: r.model_id,
      event_type: r.event_type,
      old_value: typeof r.old_value === 'string' ? JSON.parse(r.old_value) : r.old_value,
      new_value: typeof r.new_value === 'string' ? JSON.parse(r.new_value) : r.new_value,
      pct_change: r.pct_change !== null ? Number(r.pct_change) : null,
      source: r.source,
      detected_at: r.detected_at,
      model_name: snapshots[snapshots.length - 1]?.name || modelId,
      provider: snapshots[snapshots.length - 1]?.provider || extractProvider(modelId),
    }));
  } else {
    const state = getLocalState();
    snapshots = state.snapshots
      .filter((s) => s.model_id === modelId)
      .sort((a, b) => new Date(a.polled_at).getTime() - new Date(b.polled_at).getTime());

    events = state.events
      .filter((e) => e.model_id === modelId)
      .sort((a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime())
      .map((e) => ({
        ...e,
        model_name: snapshots[snapshots.length - 1]?.name || modelId,
        provider: snapshots[snapshots.length - 1]?.provider || extractProvider(modelId),
      }));
  }

  if (snapshots.length === 0 && events.length === 0) {
    return null;
  }

  const current = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;

  return {
    current,
    snapshots,
    events,
  };
}

export type HistoryRange = '7d' | '30d' | '90d' | '1y' | 'all';

export const HISTORY_RANGE_MS: Record<HistoryRange, number | null> = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
  '1y': 365 * 24 * 60 * 60 * 1000,
  all: null,
};

export function isHistoryRange(value: string | null | undefined): value is HistoryRange {
  return !!value && value in HISTORY_RANGE_MS;
}

/**
 * Returns time-series snapshots and event annotations for the price history chart.
 * Filters both by an optional look-back window (7d/30d/90d/1y/all).
 */
export async function getModelPriceHistory(
  modelId: string,
  range: HistoryRange = 'all'
): Promise<{
  current: ModelSnapshot | null;
  snapshots: ModelSnapshot[];
  events: ModelEvent[];
} | null> {
  const cutoffMs = HISTORY_RANGE_MS[range];
  let snapshots: ModelSnapshot[] = [];
  let events: ModelEvent[] = [];

  if (isPostgres()) {
    const pool = getPgPool();
    // Compute the cutoff in JS and bind it as a parameter: interpolating the
    // range key into an INTERVAL literal produced invalid syntax ('1 7d').
    const cutoffIso = cutoffMs !== null ? new Date(Date.now() - cutoffMs).toISOString() : null;
    const sQuery = cutoffIso !== null
      ? `SELECT * FROM model_snapshots WHERE model_id = $1 AND polled_at >= $2 ORDER BY polled_at ASC`
      : `SELECT * FROM model_snapshots WHERE model_id = $1 ORDER BY polled_at ASC`;
    const eQuery = cutoffIso !== null
      ? `SELECT * FROM model_events WHERE model_id = $1 AND detected_at >= $2 ORDER BY detected_at DESC`
      : `SELECT * FROM model_events WHERE model_id = $1 ORDER BY detected_at DESC`;
    // Independent queries: one round trip instead of two sequential ones.
    const [sRes, eRes] = await Promise.all([
      pool.query(sQuery, cutoffIso !== null ? [modelId, cutoffIso] : [modelId]),
      pool.query(eQuery, cutoffIso !== null ? [modelId, cutoffIso] : [modelId]),
    ]);
    snapshots = sRes.rows.map((r: any) => ({
      id: Number(r.id),
      model_id: r.model_id,
      provider: r.provider,
      name: r.name,
      price_prompt: r.price_prompt !== null ? Number(r.price_prompt) : null,
      price_completion: r.price_completion !== null ? Number(r.price_completion) : null,
      context_length: r.context_length !== null ? Number(r.context_length) : null,
      modality: r.modality,
      is_free: Boolean(r.is_free),
      raw_json: typeof r.raw_json === 'string' ? JSON.parse(r.raw_json) : r.raw_json,
        polled_at: toIsoString(r.polled_at),
    }));

    events = eRes.rows.map((r: any) => ({
      id: Number(r.id),
      model_id: r.model_id,
      event_type: r.event_type,
      old_value: typeof r.old_value === 'string' ? JSON.parse(r.old_value) : r.old_value,
      new_value: typeof r.new_value === 'string' ? JSON.parse(r.new_value) : r.new_value,
      pct_change: r.pct_change !== null ? Number(r.pct_change) : null,
      source: r.source,
      detected_at: r.detected_at,
      model_name: snapshots[snapshots.length - 1]?.name || modelId,
      provider: snapshots[snapshots.length - 1]?.provider || extractProvider(modelId),
    }));
  } else {
    const state = getLocalState();
    const cutoff = cutoffMs !== null ? Date.now() - cutoffMs : null;
    snapshots = state.snapshots
      .filter((s) => s.model_id === modelId)
      .filter((s) => (cutoff === null ? true : new Date(s.polled_at).getTime() >= cutoff))
      .sort((a, b) => new Date(a.polled_at).getTime() - new Date(b.polled_at).getTime());

    events = state.events
      .filter((e) => e.model_id === modelId)
      .filter((e) => (cutoff === null ? true : new Date(e.detected_at).getTime() >= cutoff))
      .sort((a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime())
      .map((e) => ({
        ...e,
        model_name: snapshots[snapshots.length - 1]?.name || modelId,
        provider: snapshots[snapshots.length - 1]?.provider || extractProvider(modelId),
      }));
  }

  if (snapshots.length === 0 && events.length === 0) {
    return null;
  }

  const current = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;

  return { current, snapshots, events };
}

/**
 * Returns Deals statistics and leaderboards
 */
export async function getDealsData(): Promise<{
  freeModels: ModelCurrent[];
  topDrops7d: PriceDropDeal[];
  topDrops30d: PriceDropDeal[];
}> {
  // Postgres: no full-table hydration. Free models come from an indexed
  // is_free filter on the one-row-per-model view; top drops come from a
  // date-bounded, pct-ordered events query joined to current metadata.
  // At most ~30 event rows plus the (small) free-model set cross into Node.
  if (isPostgres()) {
    const pool = getPgPool();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const freeRes = await pool.query(
      // Capped: the free-model set is small in practice, but an unbounded
      // SELECT here would scale with the catalog. 500 covers the product
      // surface (deals page renders a subset); raise deliberately if needed.
      `SELECT * FROM model_current WHERE is_free = TRUE LIMIT 500`
    );
    const freeModels: ModelCurrent[] = freeRes.rows.map((row: any) => ({
      id: Number(row.id),
      model_id: row.model_id,
      provider: row.provider,
      name: row.name,
      price_prompt: row.price_prompt !== null ? Number(row.price_prompt) : null,
      price_completion: row.price_completion !== null ? Number(row.price_completion) : null,
      context_length: row.context_length !== null ? Number(row.context_length) : null,
      modality: row.modality,
      is_free: Boolean(row.is_free),
      raw_json: typeof row.raw_json === 'string' ? JSON.parse(row.raw_json) : row.raw_json,
      polled_at: row.polled_at,
    }));

    const dropRes = await pool.query(
      `SELECT e.id, e.model_id, e.event_type,
              e.old_value, e.new_value, e.pct_change, e.detected_at,
              COALESCE(c.name, e.model_id) AS model_name,
              COALESCE(c.provider, e.model_id) AS provider,
              c.context_length AS context_length
       FROM model_events e
       LEFT JOIN model_current c ON c.model_id = e.model_id
       WHERE e.event_type IN ('PRICE_CHANGE', 'BECAME_FREE')
         AND e.detected_at >= $1
         AND (e.pct_change < 0 OR e.event_type = 'BECAME_FREE')
       ORDER BY e.pct_change ASC NULLS LAST, e.detected_at DESC
       LIMIT 30`,
      [thirtyDaysAgo]
    );
    const toDeal = (row: any): PriceDropDeal => {
      const oldVal = typeof row.old_value === 'string' ? JSON.parse(row.old_value) : row.old_value;
      const newVal = typeof row.new_value === 'string' ? JSON.parse(row.new_value) : row.new_value;
      return {
        model_id: row.model_id,
        model_name: row.model_name || row.model_id,
        provider: row.provider || extractProvider(row.model_id),
        old_prompt: oldVal?.price_prompt ?? 0,
        new_prompt: newVal?.price_prompt ?? 0,
        old_completion: oldVal?.price_completion ?? 0,
        new_completion: newVal?.price_completion ?? 0,
        pct_change: row.pct_change !== null ? Number(row.pct_change) : (row.event_type === 'BECAME_FREE' ? -100 : 0),
        detected_at: row.detected_at,
        context_length: row.context_length !== null && row.context_length !== undefined ? Number(row.context_length) : null,
      };
    };
    const topDrops30d = dropRes.rows.map(toDeal);
    const topDrops7d = topDrops30d
      .filter((d) => new Date(d.detected_at).getTime() >= new Date(sevenDaysAgo).getTime())
      .slice(0, 20);

    return { freeModels, topDrops7d, topDrops30d };
  }

  const snapshotMap = await getLatestSnapshotsMap();
  const currentList = Array.from(snapshotMap.values());
  // Bounded free-models slice matching the Postgres path (LIMIT 500)
  const freeModels = currentList.filter((m) => m.is_free).slice(0, 500);

  const now = new Date().getTime();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  // Retrieve price drops
  const { events } = await getEvents({
    eventTypes: ['PRICE_CHANGE', 'BECAME_FREE'],
    limit: 1000,
  });

  const mapToDeal = (e: ModelEvent): PriceDropDeal => {
    const snap = snapshotMap.get(e.model_id);
    return {
      model_id: e.model_id,
      model_name: e.model_name || snap?.name || e.model_id,
      provider: e.provider || snap?.provider || extractProvider(e.model_id),
      old_prompt: e.old_value?.price_prompt ?? 0,
      new_prompt: e.new_value?.price_prompt ?? 0,
      old_completion: e.old_value?.price_completion ?? 0,
      new_completion: e.new_value?.price_completion ?? 0,
      pct_change: e.pct_change || (e.event_type === 'BECAME_FREE' ? -100 : 0),
      detected_at: e.detected_at,
      context_length: snap?.context_length ?? null,
    };
  };

  const drops = events.filter((e) => (e.pct_change && e.pct_change < 0) || e.event_type === 'BECAME_FREE');

  const topDrops7d = drops
    .filter((e) => new Date(e.detected_at).getTime() >= sevenDaysAgo)
    .map(mapToDeal)
    .sort((a, b) => a.pct_change - b.pct_change)
    .slice(0, 20);

  const topDrops30d = drops
    .filter((e) => new Date(e.detected_at).getTime() >= thirtyDaysAgo)
    .map(mapToDeal)
    .sort((a, b) => a.pct_change - b.pct_change)
    .slice(0, 30);

  return {
    freeModels,
    topDrops7d,
    topDrops30d,
  };
}

/**
 * Returns top-level market summary stats
 */
export async function getMarketStats(): Promise<MarketStats> {
  // Postgres: two aggregate queries, zero row hydration. Model totals come
  // from the one-row-per-model view; event counters use FILTER over indexed
  // detected_at/event_type predicates. Node holds O(1) rows either way.
  if (isPostgres()) {
    const pool = getPgPool();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const modelRes = await pool.query(
      `SELECT COUNT(*) AS total,
              COUNT(DISTINCT provider) AS providers,
              COUNT(*) FILTER (WHERE is_free) AS free,
              MAX(polled_at) AS last_polled
       FROM model_current`
    );
    const eventRes = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE (event_type = 'PRICE_CHANGE' AND pct_change < 0 OR event_type = 'BECAME_FREE') AND detected_at >= $1) AS drops24,
         COUNT(*) FILTER (WHERE (event_type = 'PRICE_CHANGE' AND pct_change < 0 OR event_type = 'BECAME_FREE') AND detected_at >= $2) AS drops7,
         COUNT(*) FILTER (WHERE event_type = 'NEW_MODEL' AND detected_at >= $2) AS new7
       FROM model_events`,
      [oneDayAgo, sevenDaysAgo]
    );
    const m = modelRes.rows[0];
    const e = eventRes.rows[0];
    return {
      totalActiveModels: Number(m.total),
      totalProviders: Number(m.providers),
      totalFreeModels: Number(m.free),
      priceDrops24h: Number(e.drops24),
      priceDrops7d: Number(e.drops7),
      newModels7d: Number(e.new7),
      lastPolledAt: m.last_polled,
    };
  }

  const snapshotMap = await getLatestSnapshotsMap();
  const models = Array.from(snapshotMap.values());
  const providers = new Set(models.map((m) => m.provider));
  const freeModels = models.filter((m) => m.is_free);

  const now = new Date().getTime();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  const { events } = await getEvents({ limit: 1000 });

  let priceDrops24h = 0;
  let priceDrops7d = 0;
  let newModels7d = 0;
  let lastPolledAt: string | null = null;

  if (models.length > 0) {
    const latestTime = models.reduce(
      (max, m) => (new Date(m.polled_at).getTime() > new Date(max).getTime() ? m.polled_at : max),
      models[0].polled_at
    );
    lastPolledAt = latestTime;
  }

  for (const e of events) {
    const eTime = new Date(e.detected_at).getTime();
    if (e.event_type === 'PRICE_CHANGE' && e.pct_change && e.pct_change < 0) {
      if (eTime >= oneDayAgo) priceDrops24h++;
      if (eTime >= sevenDaysAgo) priceDrops7d++;
    } else if (e.event_type === 'BECAME_FREE') {
      if (eTime >= oneDayAgo) priceDrops24h++;
      if (eTime >= sevenDaysAgo) priceDrops7d++;
    }

    if (e.event_type === 'NEW_MODEL' && eTime >= sevenDaysAgo) {
      newModels7d++;
    }
  }

  return {
    totalActiveModels: models.length,
    totalProviders: providers.size,
    totalFreeModels: freeModels.length,
    priceDrops24h,
    priceDrops7d,
    newModels7d,
    lastPolledAt,
  };
}
