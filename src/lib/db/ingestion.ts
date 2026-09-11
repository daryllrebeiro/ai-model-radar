/**
 * Ingestion writes and run ledger: snapshot/event bulk writers, poll
 * transaction, ingestion-run records, raw-JSON pruning.
 * Split out of queries.ts (god-module remediation) - same logic, new home.
 */
import { ModelSnapshot } from '@/types/models';
import { ModelEvent, isValidAnnouncementNewValue } from '@/types/events';
import { isPostgres, getPgPool, getLocalState, saveLocalState } from './client';
import { bulkInsert } from './_shared';

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
 * Bulk insert model events. P1-5: enforces the EVENT_NEW_VALUE_SCHEMAS
 * registry — DEPRECATION_ANNOUNCED rows must carry a real https source_url
 * and a parseable announced_at, so inferred/forum dates can never enter
 * history through any writer (poll worker, tests, or future sources).
 */
export async function insertEvents(events: ModelEvent[]): Promise<void> {
  if (events.length === 0) return;
  for (const e of events) {
    if (e.event_type === 'DEPRECATION_ANNOUNCED' && !isValidAnnouncementNewValue(e.new_value)) {
      throw new Error(
        `insertEvents rejected DEPRECATION_ANNOUNCED for ${e.model_id}: new_value must be {source_url: https-url, announced_at: ISO} (EVENT_NEW_VALUE_SCHEMAS).`
      );
    }
  }

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

export interface IngestionRunRecord {
  id?: number;
  source: 'openrouter' | 'github' | 'huggingface' | 'changelog';
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
