import { describe, it, expect } from 'vitest';
import { ns, resetLocalBackend } from './helpers';
import { insertSnapshots, insertEvents } from '../src/lib/db/queries';
import { getLocalState, isPostgres } from '../src/lib/db/client';

describe('P1-2 backend isolation helpers', () => {
  it('ns() scopes ids per file and run (no cross-file collisions)', () => {
    const a = ns('file-a')('model');
    const b = ns('file-b')('model');
    expect(a).not.toBe(b);
    expect(a.startsWith('test/file-a/')).toBe(true);
    expect(ns('file-a')('model')).not.toBe(a); // run-scoped: distinct per call-site run
  });

  it('resetLocalBackend clears snapshots/events in local mode only', async () => {
    if (isPostgres()) return; // Postgres tables are shared — helper is local-only by design
    await insertSnapshots([
      {
        model_id: 'test/isolation/probe',
        provider: 'Iso',
        name: 'Iso',
        price_prompt: 1,
        price_completion: 1,
        context_length: 100,
        modality: 'text->text',
        is_free: false,
        raw_json: {},
        polled_at: new Date().toISOString(),
      },
    ] as any);
    await insertEvents([
      {
        model_id: 'test/isolation/probe',
        event_type: 'PRICE_CHANGE',
        old_value: null,
        new_value: null,
        pct_change: -1,
        source: 'iso-seed',
        detected_at: new Date().toISOString(),
      },
    ] as any);
    expect(getLocalState().snapshots.length).toBeGreaterThan(0);
    await resetLocalBackend();
    const state = getLocalState();
    expect(state.snapshots).toEqual([]);
    expect(state.events).toEqual([]);
  });
});
