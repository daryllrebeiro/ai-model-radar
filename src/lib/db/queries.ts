import { ModelSnapshot, ModelCurrent } from '@/types/models';
import { ModelEvent, EventFilterParams, MarketStats, PriceDropDeal } from '@/types/events';
import { isPostgres, getPgPool, getLocalState, saveLocalState } from './client';
import { extractProvider } from '../utils';
import { encodeCursor, decodeCursor } from '../pagination';

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
      for (const s of snapshots) {
        await client.query(
          `INSERT INTO model_snapshots 
          (model_id, provider, name, price_prompt, price_completion, context_length, modality, is_free, raw_json, polled_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
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
          ]
        );
      }
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
      for (const e of events) {
        await client.query(
          `INSERT INTO model_events 
          (model_id, event_type, old_value, new_value, pct_change, source, detected_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            e.model_id,
            e.event_type,
            e.old_value ? JSON.stringify(e.old_value) : null,
            e.new_value ? JSON.stringify(e.new_value) : null,
            e.pct_change,
            e.source,
            e.detected_at,
          ]
        );
      }
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
      ORDER BY model_id, polled_at DESC
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
        polled_at: row.polled_at,
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
 * Queries events with filters, pagination, and joined model details
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

  let allEvents: ModelEvent[] = [];

  if (isPostgres()) {
    const pool = getPgPool();
    const whereClauses: string[] = ['1=1'];
    const sqlParams: any[] = [];
    let paramIndex = 1;

    if (eventTypes.length > 0) {
      whereClauses.push(`e.event_type = ANY($${paramIndex++})`);
      sqlParams.push(eventTypes);
    }

    if (startDate) {
      whereClauses.push(`e.detected_at >= $${paramIndex++}`);
      sqlParams.push(startDate);
    }

    if (endDate) {
      whereClauses.push(`e.detected_at <= $${paramIndex++}`);
      sqlParams.push(endDate);
    }

    const whereSql = whereClauses.join(' AND ');

    // Join with latest snapshot to get model metadata
    const querySql = `
      SELECT 
        e.*,
        COALESCE(s.name, e.model_id) as model_name,
        COALESCE(s.provider, 'Unknown') as provider,
        s.context_length,
        s.modality,
        s.is_free
      FROM model_events e
      LEFT JOIN LATERAL (
        SELECT name, provider, context_length, modality, is_free
        FROM model_snapshots ms
        WHERE ms.model_id = e.model_id
        ORDER BY polled_at DESC
        LIMIT 1
      ) s ON true
      WHERE ${whereSql}
      ORDER BY e.detected_at DESC
    `;

    const res = await pool.query(querySql, sqlParams);
    allEvents = res.rows.map((row: any) => ({
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
  } else {
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

/**
 * Returns current models directory list
 */
export async function getModelCurrentList(params: {
  search?: string;
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
    const sRes = await pool.query(
      `SELECT * FROM model_snapshots WHERE model_id = $1 ORDER BY polled_at ASC`,
      [modelId]
    );
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
      polled_at: r.polled_at,
    }));

    const eRes = await pool.query(
      `SELECT * FROM model_events WHERE model_id = $1 ORDER BY detected_at DESC`,
      [modelId]
    );
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

/**
 * Returns Deals statistics and leaderboards
 */
export async function getDealsData(): Promise<{
  freeModels: ModelCurrent[];
  topDrops7d: PriceDropDeal[];
  topDrops30d: PriceDropDeal[];
}> {
  const snapshotMap = await getLatestSnapshotsMap();
  const currentList = Array.from(snapshotMap.values());
  const freeModels = currentList.filter((m) => m.is_free);

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

      for (const s of snapshots) {
        await client.query(
          `INSERT INTO model_snapshots 
          (model_id, provider, name, price_prompt, price_completion, context_length, modality, is_free, raw_json, polled_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
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
          ]
        );
      }

      for (const e of events) {
        await client.query(
          `INSERT INTO model_events 
          (model_id, event_type, old_value, new_value, pct_change, source, detected_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            e.model_id,
            e.event_type,
            e.old_value ? JSON.stringify(e.old_value) : null,
            e.new_value ? JSON.stringify(e.new_value) : null,
            e.pct_change,
            e.source,
            e.detected_at,
          ]
        );
      }

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
 * Activates or deactivates an alert rule
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

export interface UserRecord {
  id: number;
  email: string;
  role: string;
  tier: string;
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Creates or retrieves a user by email
 */
export async function createOrGetUser(data: {
  email: string;
  role?: string;
  tier?: string;
  stripe_customer_id?: string;
}): Promise<UserRecord> {
  const normalizedEmail = data.email.trim().toLowerCase();
  const role = data.role || 'user';
  const tier = data.tier || 'free';

  if (isPostgres()) {
    const pool = getPgPool();
    const existing = await pool.query(`SELECT * FROM users WHERE email = $1 LIMIT 1`, [normalizedEmail]);
    if (existing.rows.length > 0) {
      return existing.rows[0];
    }
    const inserted = await pool.query(
      `INSERT INTO users (email, role, tier, stripe_customer_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING *`,
      [normalizedEmail, role, tier, data.stripe_customer_id || null]
    );
    return inserted.rows[0];
  } else {
    const state = getLocalState();
    if (!state.users) state.users = [];
    const found = state.users.find((u: any) => u.email === normalizedEmail);
    if (found) return found;

    const newUser: UserRecord = {
      id: state.users.length + 1,
      email: normalizedEmail,
      role,
      tier,
      stripe_customer_id: data.stripe_customer_id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    state.users.push(newUser);
    saveLocalState(state);
    return newUser;
  }
}

/**
 * Finds user by email
 */
export async function getUserByEmail(email: string): Promise<UserRecord | null> {
  const normalizedEmail = email.trim().toLowerCase();
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(`SELECT * FROM users WHERE email = $1 LIMIT 1`, [normalizedEmail]);
    return res.rows[0] || null;
  } else {
    const state = getLocalState();
    const found = (state.users || []).find((u: any) => u.email === normalizedEmail);
    return found || null;
  }
}

/**
 * Finds user by ID
 */
export async function getUserById(id: number): Promise<UserRecord | null> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [id]);
    return res.rows[0] || null;
  } else {
    const state = getLocalState();
    const found = (state.users || []).find((u: any) => u.id === id);
    return found || null;
  }
}

/**
 * Updates user subscription tier and Stripe reference
 */
export async function updateUserTier(
  emailOrCustomerId: string,
  tier: string,
  stripeSubscriptionId?: string
): Promise<UserRecord | null> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `UPDATE users 
       SET tier = $1, stripe_subscription_id = COALESCE($2, stripe_subscription_id), updated_at = NOW()
       WHERE email = $3 OR stripe_customer_id = $3
       RETURNING *`,
      [tier, stripeSubscriptionId || null, emailOrCustomerId]
    );
    return res.rows[0] || null;
  } else {
    const state = getLocalState();
    const user = (state.users || []).find(
      (u: any) => u.email === emailOrCustomerId || u.stripe_customer_id === emailOrCustomerId
    );
    if (user) {
      user.tier = tier;
      if (stripeSubscriptionId) user.stripe_subscription_id = stripeSubscriptionId;
      user.updated_at = new Date().toISOString();
      saveLocalState(state);
      return user;
    }
    return null;
  }
}

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
    saveLocalState(state);
    return true;
  }
}


