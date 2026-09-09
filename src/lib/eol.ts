/**
 * EOL Tracker (pure): retirement countdowns for registered models plus
 * removals actually observed in the event stream.
 *
 * Status: 'expired' (eol_at passed), 'approaching' (<= 90 days out),
 * 'active' (further out). Observed removals without a registry row surface
 * as 'removed' so silent delistings are visible next to announced ones.
 */

import type { ModelEvent } from '@/types/events';

export const EOL_APPROACH_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export type EolStatus = 'active' | 'approaching' | 'expired' | 'removed';

export interface EolEntry {
  model_id: string;
  announced_at?: string | null;
  eol_at?: string | null;
  source?: string | null;
  notes?: string | null;
  status: EolStatus;
  days_remaining: number | null;
  observed_removed_at?: string | null;
}

export function eolStatus(eolAtMs: number, nowMs: number): 'active' | 'approaching' | 'expired' {
  if (eolAtMs <= nowMs) return 'expired';
  if (eolAtMs - nowMs <= EOL_APPROACH_DAYS * DAY_MS) return 'approaching';
  return 'active';
}

export function daysRemaining(eolAtMs: number, nowMs: number): number {
  return Math.ceil((eolAtMs - nowMs) / DAY_MS);
}

export function buildEolReport(
  registry: Array<{
    model_id: string;
    announced_at?: string | null;
    eol_at?: string | null;
    source?: string | null;
    notes?: string | null;
  }>,
  removalEvents: ModelEvent[],
  now: Date = new Date()
): EolEntry[] {
  const nowMs = now.getTime();
  const removedAt = new Map<string, string>();
  for (const e of removalEvents) {
    if (e.event_type !== 'MODEL_REMOVED') continue;
    const at = new Date(e.detected_at).getTime();
    if (!Number.isFinite(at)) continue;
    const key = e.model_id.toLowerCase();
    const prev = removedAt.get(key);
    if (!prev || new Date(prev).getTime() < at) {
      removedAt.set(key, e.detected_at);
    }
  }

  const entries: EolEntry[] = registry.map((r) => {
    const eolMs = r.eol_at ? new Date(r.eol_at).getTime() : NaN;
    if (!Number.isFinite(eolMs)) {
      return {
        model_id: r.model_id,
        announced_at: r.announced_at ?? null,
        eol_at: r.eol_at ?? null,
        source: r.source ?? null,
        notes: r.notes ?? null,
        status: 'active' as const,
        days_remaining: null,
        observed_removed_at: removedAt.get(r.model_id.toLowerCase()) ?? null,
      };
    }
    return {
      model_id: r.model_id,
      announced_at: r.announced_at ?? null,
      eol_at: r.eol_at ?? null,
      source: r.source ?? null,
      notes: r.notes ?? null,
      status: eolStatus(eolMs, nowMs),
      days_remaining: daysRemaining(eolMs, nowMs),
      observed_removed_at: removedAt.get(r.model_id.toLowerCase()) ?? null,
    };
  });

  const registered = new Set(registry.map((r) => r.model_id.toLowerCase()));
  for (const [key, at] of removedAt) {
    if (registered.has(key)) continue;
    const original = removalEvents.find((e) => e.model_id.toLowerCase() === key)?.model_id ?? key;
    entries.push({
      model_id: original,
      status: 'removed',
      days_remaining: null,
      observed_removed_at: at,
    });
  }

  const rank: Record<EolStatus, number> = { expired: 0, removed: 1, approaching: 2, active: 3 };
  entries.sort(
    (a, b) => rank[a.status] - rank[b.status] || (a.days_remaining ?? Infinity) - (b.days_remaining ?? Infinity)
  );
  return entries;
}
