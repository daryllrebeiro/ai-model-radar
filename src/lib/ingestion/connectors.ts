/**
 * R9 — Open connector/plugin system for ingestion sources (Tier E).
 *
 * Trust-boundary design: the event-sourced history is the product moat, so
 * third-party sources can NEVER inject data freely. Every connector:
 *  1. implements SourceConnector (fixed schema out — validated strictly,
 *     no arbitrary passthrough);
 *  2. is merged only after human review (docs/CONNECTOR_REVIEW.md);
 *  3. stays runtime-disabled unless explicitly allowlisted via
 *     CONNECTORS_ALLOWLIST — there is NO runtime plugin loading, NO open
 *     marketplace, NO unreviewed code execution.
 */
import { z } from 'zod';
import { ModelSnapshot } from '@/types/models';
import { extractProvider } from '../utils';

/** The ONLY shape a connector may return per model. Strict: unknown keys stripped, wrong types rejected. */
export const connectorRecordSchema = z.object({
  model_id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(300),
  provider: z.string().trim().min(1).max(100),
  price_prompt: z.number().finite().min(0).nullable(),
  price_completion: z.number().finite().min(0).nullable(),
  context_length: z.number().int().positive().max(100_000_000).nullable(),
  modality: z.string().trim().max(100).optional().default('text->text'),
});

export type ConnectorRecord = z.infer<typeof connectorRecordSchema>;

export type ConnectorReviewStatus = 'built-in' | 'reviewed' | 'example-pending-review';

export interface ConnectorReview {
  status: ConnectorReviewStatus;
  reviewer: string;
  reviewed_at: string;
  notes: string;
}

export interface SourceConnector {
  key: string;
  displayName: string;
  review: ConnectorReview;
  /** Raw provider fetch. Throw on upstream failure (caller isolates per-source). */
  fetchRaw: (fetchFn?: typeof fetch) => Promise<unknown[]>;
  /** Pure mapping from one raw provider object to the strict record. */
  normalize: (raw: unknown) => ConnectorRecord;
}

export function validateConnectorRecords(raw: unknown[]): ConnectorRecord[] {
  return raw.map((r, i) => {
    const parsed = connectorRecordSchema.safeParse(r);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ');
      throw new Error(`Connector record ${i} failed schema validation: ${issues}`);
    }
    return parsed.data;
  });
}

export function connectorRecordToSnapshot(
  record: ConnectorRecord,
  raw: unknown,
  polledAt = new Date().toISOString()
): ModelSnapshot {
  const isFree = record.price_prompt === 0 && record.price_completion === 0;
  return {
    model_id: record.model_id,
    provider: record.provider || extractProvider(record.model_id),
    name: record.name,
    price_prompt: record.price_prompt,
    price_completion: record.price_completion,
    context_length: record.context_length,
    modality: record.modality || 'text->text',
    is_free: isFree,
    raw_json: (raw || {}) as Record<string, any>,
    polled_at: polledAt,
  };
}

// ─── Registry (review-and-merge, not a marketplace) ──────────────────────

import { replicateConnector } from './replicate';

const BUILT_IN: SourceConnector[] = [];

function builtin(key: string, displayName: string): SourceConnector {
  return {
    key,
    displayName,
    review: {
      status: 'built-in',
      reviewer: 'core-team',
      reviewed_at: '2026-01-01',
      notes: 'First-party source, same review bar as any core change.',
    },
    fetchRaw: async () => {
      throw new Error(`Built-in source "${key}" runs through its dedicated ingestion path, not the connector runner.`);
    },
    normalize: (raw: unknown) => validateConnectorRecords([raw])[0],
  };
}

BUILT_IN.push(builtin('openrouter', 'OpenRouter'));
BUILT_IN.push(builtin('huggingface', 'Hugging Face'));
BUILT_IN.push(builtin('github-labs', 'GitHub Labs'));

export const CONNECTOR_REGISTRY: SourceConnector[] = [...BUILT_IN, replicateConnector];

export function getConnector(key: string): SourceConnector | null {
  return CONNECTOR_REGISTRY.find((c) => c.key === key) || null;
}

/** Allowlist from env: only these keys may run. Unreviewed keys never run. */
export function allowlistedConnectorKeys(env = process.env): string[] {
  return (env.CONNECTORS_ALLOWLIST || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isConnectorRunnable(connector: SourceConnector, env = process.env): boolean {
  if (connector.review.status === 'built-in') return false;
  if (connector.review.status !== 'reviewed') return false;
  return allowlistedConnectorKeys(env).includes(connector.key.toLowerCase());
}

/** P2: enforced per-source timeout (throw-and-isolate, with a deadline). */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Runs one reviewed + allowlisted connector and returns STRICTLY validated
 * snapshots. Does NOT persist — the caller (a human-operated script, never
 * the automatic poll cron) decides what happens next.
 */
export async function runConnector(
  connector: SourceConnector,
  opts: { fetchFn?: typeof fetch; polledAt?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}
): Promise<ModelSnapshot[]> {
  if (!isConnectorRunnable(connector, opts.env)) {
    throw new Error(
      `Connector "${connector.key}" is not runnable (needs status=reviewed + CONNECTORS_ALLOWLIST entry).`
    );
  }
  const timeoutMs = Math.min(120000, Math.max(1000, Math.floor(opts.timeoutMs ?? 30000)));
  const raw = await withTimeout(
    connector.fetchRaw(opts.fetchFn),
    timeoutMs,
    `Connector "${connector.key}" timed out after ${timeoutMs}ms`
  );
  if (!Array.isArray(raw)) throw new Error(`Connector "${connector.key}" returned a non-array payload.`);
  if (raw.length > 5000) throw new Error(`Connector "${connector.key}" returned ${raw.length} records (cap 5000).`);
  const polledAt = opts.polledAt || new Date().toISOString();
  return raw.map((r) => connectorRecordToSnapshot(validateConnectorRecords([connector.normalize(r)])[0], r, polledAt));
}
