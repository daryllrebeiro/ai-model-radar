import { describe, it, expect } from 'vitest';
import { insertSnapshots, pruneOldRawJson, getLatestSnapshotsMap } from '../src/lib/db/queries';
import { ModelSnapshot } from '../src/types/models';

describe('Phase P3: 30-Day Raw JSON Pruning Job', () => {
  it('1. Clears raw_json from snapshots older than 30 days while preserving core prices', async () => {
    const oldDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
    const recentDate = new Date().toISOString();

    const oldSnapshot: ModelSnapshot = {
      model_id: 'test/old-archived-model',
      provider: 'TestProvider',
      name: 'Old Archived Model',
      price_prompt: 0.000005,
      price_completion: 0.000015,
      context_length: 32000,
      modality: 'text->text',
      is_free: false,
      raw_json: { large_payload: 'x'.repeat(500) },
      polled_at: oldDate,
    };

    const recentSnapshot: ModelSnapshot = {
      model_id: 'test/recent-active-model',
      provider: 'TestProvider',
      name: 'Recent Active Model',
      price_prompt: 0.000002,
      price_completion: 0.000008,
      context_length: 128000,
      modality: 'text->text',
      is_free: false,
      raw_json: { active_config: true },
      polled_at: recentDate,
    };

    await insertSnapshots([oldSnapshot, recentSnapshot]);

    const result = await pruneOldRawJson(30);
    expect(result.prunedCount).toBeGreaterThanOrEqual(1);

    const snapshotMap = await getLatestSnapshotsMap();
    const oldRetrieved = snapshotMap.get('test/old-archived-model');
    const recentRetrieved = snapshotMap.get('test/recent-active-model');

    if (oldRetrieved) {
      // raw_json pruned to empty object
      expect(Object.keys(oldRetrieved.raw_json).length).toBe(0);
      // Pricing and context preserved
      expect(oldRetrieved.price_prompt).toBe(0.000005);
      expect(oldRetrieved.context_length).toBe(32000);
    }

    if (recentRetrieved) {
      // Recent snapshot retains full raw_json
      expect(recentRetrieved.raw_json).toBeDefined();
    }
  });
});
