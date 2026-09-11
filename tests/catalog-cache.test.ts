import { describe, it, expect, afterEach } from 'vitest';
import {
  getCachedSnapshotsMap,
  invalidateCatalogCache,
  catalogCacheTtlMs,
  DEFAULT_CATALOG_CACHE_TTL_MS,
} from '../src/lib/catalog-cache';
import { insertSnapshots } from '../src/lib/db/queries';

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
  invalidateCatalogCache();
});

describe('catalog TTL cache (P2 hot-path relief)', () => {
  it('defaults to 5min; 0 disables; clamps negatives', () => {
    delete process.env.CATALOG_CACHE_TTL_MS;
    expect(catalogCacheTtlMs()).toBe(DEFAULT_CATALOG_CACHE_TTL_MS);
    expect(catalogCacheTtlMs({ CATALOG_CACHE_TTL_MS: '0' } as any)).toBe(0);
    expect(catalogCacheTtlMs({ CATALOG_CACHE_TTL_MS: '-5' } as any)).toBe(0);
    expect(catalogCacheTtlMs({ CATALOG_CACHE_TTL_MS: 'abc' } as any)).toBe(DEFAULT_CATALOG_CACHE_TTL_MS);
  });

  it('serves stale within TTL, refreshes after invalidate', async () => {
    process.env.CATALOG_CACHE_TTL_MS = '60000';
    const prefix = `cache.${Date.now()}`;
    const first = await getCachedSnapshotsMap();
    const sizeBefore = first.size;
    await insertSnapshots([
      {
        model_id: `${prefix}/m0`,
        provider: 'CacheCo',
        name: 'Cache Model',
        price_prompt: 1,
        price_completion: 1,
        context_length: 1000,
        modality: 'text->text',
        is_free: false,
        raw_json: {},
        polled_at: new Date().toISOString(),
      },
    ] as any);
    // Within TTL: same (stale) instance, new row invisible.
    const second = await getCachedSnapshotsMap();
    expect(second).toBe(first);
    expect(second.has(`${prefix}/m0`)).toBe(false);
    expect(second.size).toBe(sizeBefore);
    // After invalidate: fresh read includes the row.
    invalidateCatalogCache();
    const third = await getCachedSnapshotsMap();
    expect(third.has(`${prefix}/m0`)).toBe(true);
  });

  it('TTL=0 always hits the store', async () => {
    process.env.CATALOG_CACHE_TTL_MS = '0';
    const a = await getCachedSnapshotsMap();
    const b = await getCachedSnapshotsMap();
    expect(a).not.toBe(b);
    expect(a.size).toBe(b.size);
  });
});
