/**
 * R10 persistence: routing telemetry + pilot opt-ins.
 * Telemetry is reliability-first: success rate and overhead are read from
 * here BEFORE usage growth is treated as signal (see routing/stats).
 */
import { isPostgres, getPgPool, getLocalState, saveLocalState } from './client';
import { hashEmail } from '../logger';

export interface RoutingAttempt {
  key_prefix: string | null;
  owner_email_hash: string | null;
  requested_model: string;
  selected_model: string;
  policy: string;
  upstream_status: number | null;
  latency_ms: number | null;
  success: boolean;
  error?: string | null;
}

export async function recordRoutingAttempt(a: RoutingAttempt): Promise<void> {
  if (isPostgres()) {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO routing_attempts (key_prefix, owner_email_hash, requested_model, selected_model,
        policy, upstream_status, latency_ms, success, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        a.key_prefix,
        a.owner_email_hash,
        a.requested_model.slice(0, 500),
        a.selected_model.slice(0, 500),
        a.policy.slice(0, 40),
        a.upstream_status,
        a.latency_ms,
        a.success,
        (a.error || '').slice(0, 2000) || null,
      ]
    );
    return;
  }
  const state = getLocalState();
  state.routing_attempts.push({ ...a, id: state.routing_attempts.length + 1, created_at: new Date().toISOString() });
  saveLocalState(state);
}

export interface RoutingReliability {
  window_hours: number;
  attempts: number;
  success_rate: number | null;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  by_policy: Record<string, { attempts: number; success_rate: number | null }>;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export async function getRoutingReliability(windowHours = 24): Promise<RoutingReliability> {
  const hours = Math.min(24 * 30, Math.max(1, Math.floor(windowHours)));
  let rows: any[];
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT policy, success, latency_ms FROM routing_attempts
       WHERE created_at >= NOW() - ($1 || ' hours')::interval`,
      [String(hours)]
    );
    rows = res.rows;
  } else {
    const state = getLocalState();
    const cutoff = Date.now() - hours * 3600 * 1000;
    rows = state.routing_attempts.filter((r: any) => new Date(r.created_at).getTime() >= cutoff);
  }
  const lat = rows
    .map((r: any) => (r.latency_ms !== null && r.latency_ms !== undefined ? Number(r.latency_ms) : null))
    .filter((n: number | null): n is number => n !== null)
    .sort((a: number, b: number) => a - b);
  const buckets = new Map<string, { attempts: number; ok: number }>();
  for (const r of rows) {
    const p = String(r.policy || 'explicit');
    const bucket = buckets.get(p) || { attempts: 0, ok: 0 };
    bucket.attempts++;
    if (r.success) bucket.ok++;
    buckets.set(p, bucket);
  }
  const out: RoutingReliability['by_policy'] = {};
  for (const [p, b] of buckets) {
    out[p] = { attempts: b.attempts, success_rate: b.attempts > 0 ? Math.round((b.ok / b.attempts) * 1000) / 1000 : null };
  }
  return {
    window_hours: hours,
    attempts: rows.length,
    success_rate: rows.length > 0 ? Math.round((rows.filter((r: any) => r.success).length / rows.length) * 1000) / 1000 : null,
    p50_latency_ms: percentile(lat, 50),
    p95_latency_ms: percentile(lat, 95),
    by_policy: out,
  };
}

export function hashOwnerEmail(email: string | undefined): string | null {
  if (!email) return null;
  try {
    return hashEmail(email);
  } catch {
    return null;
  }
}

/** Pilot opt-in: explicit per-user consent row (one half of the pilot gate). */
export async function createRoutingOptIn(ownerEmail: string): Promise<boolean> {
  const email = ownerEmail.trim().toLowerCase();
  if (!email) return false;
  if (isPostgres()) {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO routing_pilot_optins (owner_email) VALUES ($1)
       ON CONFLICT (owner_email) DO UPDATE SET approved = TRUE`,
      [email]
    );
    return true;
  }
  const state = getLocalState();
  const found = state.routing_pilot_optins.find((r: any) => String(r.owner_email).toLowerCase() === email);
  if (found) {
    found.approved = true;
  } else {
    state.routing_pilot_optins.push({
      id: state.routing_pilot_optins.length + 1,
      owner_email: email,
      approved: true,
      created_at: new Date().toISOString(),
    });
  }
  saveLocalState(state);
  return true;
}

export async function hasRoutingOptIn(ownerEmail: string | undefined): Promise<boolean> {
  if (!ownerEmail) return false;
  const email = ownerEmail.trim().toLowerCase();
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT 1 FROM routing_pilot_optins WHERE owner_email = $1 AND approved = TRUE`,
      [email]
    );
    return res.rows.length > 0;
  }
  const state = getLocalState();
  return state.routing_pilot_optins.some(
    (r: any) => String(r.owner_email).toLowerCase() === email && r.approved !== false
  );
}

/**
 * Pilot gate: kill switch AND operator allowlist AND user opt-in.
 * All three, or no routing. Returns ok:false with a safe reason otherwise.
 */
export async function checkRoutingPilot(
  ownerEmail: string | undefined,
  env = process.env
): Promise<{ ok: boolean; reason?: string }> {
  if (env.ROUTING_ENABLED !== 'true') {
    return { ok: false, reason: 'Routing gateway is disabled (ROUTING_ENABLED).' };
  }
  const allowlist = (env.ROUTING_PILOT_ALLOWLIST || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!ownerEmail || !allowlist.includes(ownerEmail.toLowerCase())) {
    return { ok: false, reason: 'Not a routing pilot member.' };
  }
  if (!(await hasRoutingOptIn(ownerEmail))) {
    return { ok: false, reason: 'Pilot opt-in consent required.' };
  }
  return { ok: true };
}
