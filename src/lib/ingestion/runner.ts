import { fetchOpenRouterModels, normalizeOpenRouterModel } from './openrouter';
import { computeModelDiffs, DiffResult } from './diff';
import {
  getLatestSnapshotsMap,
  getKnownModelIds,
  savePollTransaction,
  recordIngestionRun,
} from '@/lib/db/queries';
import { ModelSnapshot } from '@/types/models';
import { logger } from '@/lib/logger';
import { captureException } from '@/lib/errors';

export interface PollExecutionResult {
  success: boolean;
  runId: string;
  timestamp: string;
  totalPolled: number;
  newModels: number;
  priceChanges: number;
  becameFree: number;
  leftFree: number;
  contextChanged: number;
  removedModels: number;
  totalEventsEmitted: number;
  error?: string;
}

/**
 * Pings optional external heartbeat service (Healthchecks.io / Better Uptime / Cronitor)
 */
async function pingHeartbeat(runId: string) {
  const heartbeatUrl = process.env.HEARTBEAT_URL;
  if (!heartbeatUrl) return;

  try {
    await fetch(heartbeatUrl, {
      method: 'POST',
      headers: { 'User-Agent': `AI-Model-Radar/1.0 (runId: ${runId})` },
    });
  } catch (err) {
    logger.warn('Failed to ping heartbeat webhook:', { runId, error: String(err) });
  }
}

/**
 * Runs a complete OpenRouter polling and diffing ingestion cycle within an atomic transaction
 */
export async function runIngestionCycle(options: {
  customModels?: ModelSnapshot[];
  polledAt?: string;
} = {}): Promise<PollExecutionResult> {
  const runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
  const runLogger = logger.child({ runId, source: 'openrouter' });
  const startedAt = new Date().toISOString();
  const timestamp = options.polledAt || startedAt;

  runLogger.info('Starting ingestion cycle', { timestamp });

  try {
    // 1. Fetch raw models or use provided custom models
    let normalizedModels: ModelSnapshot[] = [];
    if (options.customModels && options.customModels.length > 0) {
      normalizedModels = options.customModels;
      runLogger.info('Using custom model fixture', { count: normalizedModels.length });
    } else {
      runLogger.info('Fetching live models from OpenRouter API');
      const rawModels = await fetchOpenRouterModels();
      normalizedModels = rawModels.map((raw) => normalizeOpenRouterModel(raw, timestamp));
      runLogger.info('Normalized models received', { count: normalizedModels.length });
    }

    // 2. Load latest known snapshots and historical IDs
    const previousSnapshots = await getLatestSnapshotsMap();
    const knownModelIds = await getKnownModelIds();

    // 3. Compute pure diffs
    runLogger.info('Computing pure model diffs');
    const diffResult = computeModelDiffs({
      previousSnapshots,
      knownModelIds,
      currentModels: normalizedModels,
      detectedAt: timestamp,
      source: 'openrouter',
    });

    runLogger.info('Diff computed successfully', {
      newModels: diffResult.newModelsCount,
      priceChanges: diffResult.priceChangesCount,
      becameFree: diffResult.becameFreeCount,
      leftFree: diffResult.leftFreeCount,
      contextChanged: diffResult.contextChangedCount,
      removedModels: diffResult.removedModelsCount,
      eventsCount: diffResult.events.length,
    });

    // 4. Atomic transaction: write snapshots, events, and run record together
    await savePollTransaction(diffResult.newSnapshots, diffResult.events, {
      source: 'openrouter',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: 'success',
      models_seen: normalizedModels.length,
      events_emitted: diffResult.events.length,
    });

    runLogger.info('Ingestion cycle persisted atomically to database');

    // 5. Ping external heartbeat monitor on success
    await pingHeartbeat(runId);

    return {
      success: true,
      runId,
      timestamp,
      totalPolled: normalizedModels.length,
      newModels: diffResult.newModelsCount,
      priceChanges: diffResult.priceChangesCount,
      becameFree: diffResult.becameFreeCount,
      leftFree: diffResult.leftFreeCount,
      contextChanged: diffResult.contextChangedCount,
      removedModels: diffResult.removedModelsCount,
      totalEventsEmitted: diffResult.events.length,
    };
  } catch (error: any) {
    const errorMsg = error.message || String(error);
    captureException(error, { runId, source: 'openrouter', startedAt });

    // Record explicit failed run in database
    await recordIngestionRun({
      source: 'openrouter',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: 'failed',
      models_seen: 0,
      events_emitted: 0,
      error_detail: errorMsg,
    }).catch((e) => runLogger.warn('Failed to record ingestion error run in DB:', { error: String(e) }));

    return {
      success: false,
      runId,
      timestamp,
      totalPolled: 0,
      newModels: 0,
      priceChanges: 0,
      becameFree: 0,
      leftFree: 0,
      contextChanged: 0,
      removedModels: 0,
      totalEventsEmitted: 0,
      error: errorMsg,
    };
  }
}
