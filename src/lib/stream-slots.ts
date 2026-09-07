/**
 * Per-instance concurrent SSE stream slots, keyed by authenticated identity.
 * The entry key/IP limiter cannot see open connections, so without this an
 * attacker could hold N slow connections × 5s DB polls each (Slowloris-style
 * DB exhaustion). Best-effort per warm serverless instance; maxDuration on
 * the route bounds the worst case regardless.
 */

export const MAX_CONCURRENT_STREAMS_PER_IDENTITY = 5;

const activeStreams = new Map<string, Set<object>>();

/** Acquire a stream slot; returns null when the identity is at cap. */
export function streamSlotAcquire(identity: string): object | null {
  let set = activeStreams.get(identity);
  if (!set) {
    set = new Set();
    activeStreams.set(identity, set);
  }
  if (set.size >= MAX_CONCURRENT_STREAMS_PER_IDENTITY) return null;
  const token = {};
  set.add(token);
  // Safety release in case neither abort nor cancel fires (frozen instance).
  setTimeout(() => {
    const s = activeStreams.get(identity);
    if (s) {
      s.delete(token);
      if (s.size === 0) activeStreams.delete(identity);
    }
  }, 65 * 1000).unref?.();
  return token;
}

/** Release a previously acquired stream slot. */
export function streamSlotRelease(identity: string, token: object | null): void {
  if (!token) return;
  const set = activeStreams.get(identity);
  if (set) {
    set.delete(token);
    if (set.size === 0) activeStreams.delete(identity);
  }
}
