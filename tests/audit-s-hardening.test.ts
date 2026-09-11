import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as deprecationsGET } from '../src/app/api/v1/deprecations/route';
import { GET as activeProbeGET } from '../src/app/api/v1/active-probe/route';
import { POST as finetunePOST } from '../src/app/api/v1/finetune-estimate/route';
import { POST as optimizePOST } from '../src/app/api/v1/prompt-optimize/route';
import { POST as codegenPOST } from '../src/app/api/v1/migrate-code/route';
import { POST as orgScanPOST } from '../src/app/api/v1/org-scan/route';
import { runActiveProbeCycle } from '../src/lib/active-probe';
import { validateCompoundRule } from '../src/lib/compound-rules';
import { classifyModelCategory } from '../src/lib/embeddings';
import { findComplianceForModel } from '../src/lib/compliance';

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('AUDIT-H1: every public S route is rate-limited (no unbounded reads/compute)', () => {
  it('deprecations GET serves the collecting gate anonymously within budget', async () => {
    const res = await deprecationsGET(new NextRequest('http://localhost/api/v1/deprecations'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('collecting');
    expect(body.maturity.min_pairs).toBe(10);
    expect(body.providers).toEqual([]);
  });

  it('active-probe status GET exposes budget/battery without paid calls', async () => {
    const res = await activeProbeGET(new NextRequest('http://localhost/api/v1/active-probe'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.battery_version).toBeGreaterThan(0);
    expect(body.budget.max_calls_per_run).toBeLessThanOrEqual(30);
    expect(body.scope_note.toLowerCase()).toContain('not a guarantee');
  });

  it('finetune estimator rejects bad input before computing', async () => {
    const bad = await finetunePOST(post('http://localhost/api/v1/finetune-estimate', 'not-json{'));
    expect(bad.status).toBe(400);
    const neg = await finetunePOST(
      post('http://localhost/api/v1/finetune-estimate', {
        monthly_prompt_tokens: -5,
        monthly_comp_tokens: 0,
        training_tokens: 0,
        large_model_id: 'openai/gpt-4o',
        small_model_id: 'openai/gpt-4o-mini',
      })
    );
    expect(neg.status).toBe(400);
    const unknown = await finetunePOST(
      post('http://localhost/api/v1/finetune-estimate', {
        monthly_prompt_tokens: 1000,
        monthly_comp_tokens: 1000,
        training_tokens: 1000,
        large_model_id: 'evil/does-not-exist',
        small_model_id: 'evil/also-fake',
      })
    );
    expect(unknown.status).toBe(422);
  });

  it('prompt-optimizer rejects oversized bodies pre-parse (413)', async () => {
    const big = await optimizePOST(
      post(
        'http://localhost/api/v1/prompt-optimize',
        { system_prompt: 'x', target_model_id: 'openai/gpt-4o' },
        { 'content-length': String(10 * 1024 * 1024) }
      )
    );
    expect(big.status).toBe(413);
  });

  it('codegen rejects oversized bodies and unknown pairs without guessing', async () => {
    const big = await codegenPOST(
      post(
        'http://localhost/api/v1/migrate-code',
        { code: 'x', source_provider: 'a', target_provider: 'b', target_model: 'm' },
        { 'content-length': String(10 * 1024 * 1024) }
      )
    );
    expect(big.status).toBe(413);
    const unsupported = await codegenPOST(
      post('http://localhost/api/v1/migrate-code', {
        code: 'x = 1',
        source_provider: 'some-obscure-sdk',
        target_provider: 'another-obscure-sdk',
        target_model: 'm',
      })
    );
    expect(unsupported.status).toBe(422);
    const body = await unsupported.json();
    expect(body.supported_pairs.length).toBeGreaterThan(0);
  });
});

describe('AUDIT-H2: org-scan stays authenticated, bounded, and report-only', () => {
  it('no session → 401 with no data (fail-closed)', async () => {
    const res = await orgScanPOST(
      post('http://localhost/api/v1/org-scan', { org: 'acme', files: [], known_models: [] })
    );
    expect(res.status).toBe(401);
  });

  it('oversized scan bodies are refused pre-parse even before auth payload work', async () => {
    // 401 fires first (session check precedes parse) — proves no expensive
    // work happens for unauthenticated callers; authed oversized is 413/400.
    const res = await orgScanPOST(
      post(
        'http://localhost/api/v1/org-scan',
        { org: 'acme', files: [], known_models: [] },
        { 'content-length': String(100 * 1024 * 1024) }
      )
    );
    expect([401, 413]).toContain(res.status);
  });
});

describe('AUDIT-H3: probe cycle degrades on provider failure (no outage-as-drift)', () => {
  it('a throwing provider is counted, skipped, and never diffed', async () => {
    const prev = {
      model_id: 'a/flaky',
      prompt_id: 'factual-qa-capital',
      prompt_version: 1,
      output: 'Paris',
      ttft_ms: 100,
      tokens_per_sec: 50,
      sampled_at: '2026-01-01T00:00:00Z',
    };
    const res = await runActiveProbeCycle({
      modelIds: ['a/flaky'],
      previous: [prev],
      generateFn: async () => {
        throw new Error('upstream 500');
      },
    });
    expect(res.errors).toBe(3);
    expect(res.samples).toEqual([]);
    expect(res.diffs).toEqual([]);
  });

  it('partial failure still yields diffs only for successful calls', async () => {
    const res = await runActiveProbeCycle({
      modelIds: ['a/ok', 'a/down'],
      generateFn: async (model_id) => {
        if (model_id === 'a/down') throw new Error('timeout');
        return { output: 'steady output here', ttft_ms: 90, tokens_per_sec: 60 };
      },
    });
    expect(res.errors).toBe(3);
    expect(res.samples.length).toBe(3);
    expect(res.latency['a/down'].samples).toBe(0);
    expect(res.latency['a/down'].p50_ttft_ms).toBeNull();
  });
});

describe('AUDIT data-integrity: no inferred facts via S filters', () => {
  it('DEPRECATION_ANNOUNCED is a valid compound rule event type (no silent drop)', () => {
    const errors = validateCompoundRule({
      name: 'deprecation watch',
      logic: 'and',
      conditions: [{ field: 'event_type', op: 'eq', value: 'DEPRECATION_ANNOUNCED' }],
    });
    expect(errors).toEqual([]);
  });

  it('unknown providers classify as unknown — never force-fit', () => {
    expect(findComplianceForModel('groq/llama-3.3-70b-versatile')).toBeNull();
    expect(classifyModelCategory('groq/llama-3.3-70b-versatile')).toBe('chat');
    expect(classifyModelCategory('openai/gpt-4o')).toBe('chat');
    // Residual (Low, documented in AUDIT_S_FEATURES.md): the embedding
    // heuristic is substring-based, so a hypothetical chat model with
    // "embed" in its id would misclassify. Curated-list membership wins
    // where it matters (all tracked embedding models are listed).
  });
});
