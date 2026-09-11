/**
 * P2 hot-path relief: short-TTL in-memory cache in front of the full
 * `model_snapshots` DISTINCT ON scan (`getLatestSnapshotsMap`).
 *
 * ONLY for staleness-tolerant reads (arbitrage views, signals, forecasts,
 * recommendations, ask, stream). Money/decision paths (ingestion runner,
 * routing, digest, probes, governance, reconciliation, alert evaluation)
 * MUST keep calling getLatestSnapshotsMap directly — a 5-minute-stale
 * price must never decide spend or routing.
 *
 * Per-instance memory only: worst-case staleness is the TTL, documented.
 * CATALOG_CACHE_TTL_MS=0 disables (every call hits the DB).
 */
import { ModelSnapshot } from '@/types/models';
import { getLatestSnapshotsMap } from './db/catalog';

export const DEFAULT_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

export function catalogCacheTtlMs(env = process.env): number {
  const raw = Number(env.CATALOG_CACHE_TTL_MS);
  if (!Number.isFinite(raw)) return DEFAULT_CATALOG_CACHE_TTL_MS;
  return Math.max(0, Math.floor(raw));
}

let cached: { at: number; map: Map<string, ModelSnapshot> } | null = null;

export async function getCachedSnapshotsMap(
  nowMs = Date.now(),
  env = process.env
): Promise<Map<string, ModelSnapshot>> {
  const ttl = catalogCacheTtlMs(env);
  if (ttl > 0 && cached && nowMs - cached.at < ttl) {
    return cached.map;
  }
  const map = await getLatestSnapshotsMap();
  if (ttl > 0) {
    cached = { at: nowMs, map };
  }
  return map;
}

export function invalidateCatalogCache(): void {
  cached = null;
}
