/**
 * Constant-time secret comparison shared by every auth boundary that checks a
 * pre-shared secret (ADMIN_SECRET, CRON_SECRET).
 *
 * Deliberately dependency-free and Edge-safe: Next.js middleware cannot use
 * node:crypto's timingSafeEqual, so this uses a manual XOR accumulation over
 * TextEncoder bytes instead. No early return on content (the loop always runs
 * over the longer input); only type/emptiness short-circuits, since an empty
 * presented value must never authenticate.
 *
 * Length is not hidden (lengths are compared, not hashed first) — acceptable
 * here because our secret lengths are not sensitive; content is what matters.
 */
const encoder = new TextEncoder();

export function secretsEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length === 0 || b.length === 0) return false;
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const len = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < len; i++) {
    diff |= (aBytes[i % aBytes.length] ?? 0) ^ (bBytes[i % bBytes.length] ?? 0);
  }
  return diff === 0;
}
