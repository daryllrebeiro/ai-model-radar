/**
 * R9 example community connector: Replicate public models.
 *
 * Merged like a normal code contribution after review (see registry entry
 * below + docs/CONNECTOR_REVIEW.md). Runtime-disabled by default: it runs
 * ONLY when CONNECTORS_ALLOWLIST includes "replicate", and its output is
 * strictly schema-validated before it can become snapshots. It is NOT wired
 * into the automatic poll cron.
 */
import { SourceConnector, ConnectorRecord } from './connectors';

const REPLICATE_MODELS_URL = 'https://api.replicate.com/v1/models';

interface ReplicateModel {
  url?: string;
  owner?: string;
  name?: string;
  description?: string;
  visibility?: string;
  latest_version?: { id?: string };
}

function modelIdFromUrl(url: string): string | null {
  // Canonical Replicate URLs look like https://replicate.com/owner/name
  const m = /^https?:\/\/replicate\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)\/?$/.exec(url || '');
  if (!m) return null;
  return `${m[1]}/${m[2]}`;
}

export function normalizeReplicateModel(raw: unknown): ConnectorRecord {
  const r = (raw || {}) as ReplicateModel;
  const fromUrl = typeof r.url === 'string' ? modelIdFromUrl(r.url) : null;
  const owner = (r.owner || '').trim();
  const name = (r.name || '').trim();
  const model_id = fromUrl || (owner && name ? `${owner}/${name}` : '');
  if (!model_id) {
    throw new Error('Replicate record has no usable owner/name or url.');
  }
  // Replicate's public listing carries no pricing: prices stay null (unknown),
  // NEVER zero (zero means free — asserting free without evidence corrupts
  // the event history this system exists to protect).
  return {
    model_id,
    name: name || model_id,
    provider: owner || 'replicate',
    price_prompt: null,
    price_completion: null,
    context_length: null,
    modality: 'text->text',
  };
}

export async function fetchReplicateModels(fetchFn: typeof fetch = fetch): Promise<unknown[]> {
  const res = await fetchFn(REPLICATE_MODELS_URL, {
    headers: { Accept: 'application/json', 'User-Agent': 'AI-Model-Radar/1.0 (connector:replicate)' },
  });
  if (!res.ok) {
    throw new Error(`Replicate upstream HTTP ${res.status}`);
  }
  const body = (await res.json()) as { results?: unknown[] };
  if (!body || !Array.isArray(body.results)) {
    throw new Error('Replicate response missing results array.');
  }
  return body.results;
}

export const replicateConnector: SourceConnector = {
  key: 'replicate',
  displayName: 'Replicate (community)',
  review: {
    status: 'reviewed',
    reviewer: 'core-team',
    reviewed_at: '2026-09-10',
    notes:
      'First community connector. Pricing/context are null (unknown) by design — ' +
      'the listing carries no pricing evidence. Allowlist-gated, never auto-polled.',
  },
  fetchRaw: fetchReplicateModels,
  normalize: normalizeReplicateModel,
};
