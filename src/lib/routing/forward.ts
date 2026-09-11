/**
 * P2 route thinning: upstream forwarding for the R10 pilot gateway,
 * extracted from the chat route. The route keeps auth/pilot/breaker/
 * selection; this module owns the single-attempt forward, fail-open
 * shaping, response headers, and attempt audit. No retries on
 * timeout/5xx: a retry could double-bill (see ROUTING_INCIDENT_PLAN.md).
 */
import { recordRoutingAttempt, hashOwnerEmail } from '@/lib/db/routing';
import { logger } from '@/lib/logger';

export interface ForwardInput {
  ownerEmail?: string;
  upstreamBase: string;
  upstreamKey: string;
  /** Full request body minus radar-only keys; model is set to selected. */
  body: Record<string, unknown>;
  selectedModelId: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export interface ForwardResult {
  ok: boolean;
  status: number | null;
  payload: unknown;
  error: string | null;
  overheadMs: number;
}

export async function forwardToUpstream(input: ForwardInput): Promise<ForwardResult> {
  const timeoutMs = input.timeoutMs ?? 55000;
  const fetchFn = input.fetchFn || fetch;
  const overheadMark = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let upstreamRes: Response | null = null;
  let upstreamErr: string | null = null;
  try {
    upstreamRes = await fetchFn(`${input.upstreamBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.upstreamKey}`,
        'User-Agent': 'AI-Model-Radar/1.0 Router-Pilot',
      },
      body: JSON.stringify({ ...input.body, model: input.selectedModelId }),
      signal: controller.signal,
    });
  } catch (err: any) {
    upstreamErr = err?.name === 'AbortError' ? 'Upstream timeout' : err?.message || 'Upstream unreachable';
  } finally {
    clearTimeout(timeout);
  }
  const overheadMs = Date.now() - overheadMark;
  if (!upstreamRes || !upstreamRes.ok) {
    return {
      ok: false,
      status: upstreamRes ? upstreamRes.status : null,
      payload: null,
      error: upstreamErr || `Upstream HTTP ${upstreamRes ? upstreamRes.status : null}`,
      overheadMs,
    };
  }
  return {
    ok: true,
    status: upstreamRes.status,
    payload: await upstreamRes.json().catch(() => null),
    error: null,
    overheadMs,
  };
}

/**
 * Explicit fail-open body: shape-compatible, names the ORIGINAL model,
 * no substitution, no fabricated completion — explicit by construction.
 */
export function buildFailOpenBody(modelHint: string, errText: string): Record<string, unknown> {
  return {
    id: `chatcmpl-fallback-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: modelHint,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'Upstream unavailable — retry this request directly against the requested model.',
        },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    proxy_fallback: true,
    proxy_error: errText,
  };
}

export async function logRoutingAttempt(input: {
  ownerEmail?: string;
  requested: string;
  selected: string;
  policy: string;
  upstreamStatus: number | null;
  latencyMs: number;
  success: boolean;
  error?: string;
}): Promise<void> {
  try {
    await recordRoutingAttempt({
      key_prefix: null,
      owner_email_hash: hashOwnerEmail(input.ownerEmail),
      requested_model: input.requested,
      selected_model: input.selected,
      policy: input.policy,
      upstream_status: input.upstreamStatus,
      latency_ms: input.latencyMs,
      success: input.success,
      error: input.error || null,
    });
  } catch (err) {
    logger.warn('Routing attempt audit failed:', { error: String(err) });
  }
}
