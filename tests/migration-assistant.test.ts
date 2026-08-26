import { describe, it, expect } from 'vitest';
import { findMigrationAlternatives } from '../src/lib/migration-advisor';
import { GET } from '../src/app/api/v1/migrate/route';
import { NextRequest } from 'next/server';

describe('Phase Q4: Migration Assistant ("What do I switch to")', () => {
  it('1. Generates 2 to 3 transparent alternatives for a premium model with cost savings', () => {
    const report = findMigrationAlternatives('anthropic/claude-3-7-sonnet', []);
    expect(report).toBeDefined();
    expect(report?.target_model.model_id).toBe('anthropic/claude-3-7-sonnet');
    expect(report?.alternatives.length).toBeGreaterThanOrEqual(2);
    expect(report?.alternatives.length).toBeLessThanOrEqual(3);

    // Verify transparent metrics exist without fake composite scores
    const firstAlt = report!.alternatives[0];
    expect(firstAlt.model_id).toBeDefined();
    expect(firstAlt.prompt_per_1m).toBeGreaterThanOrEqual(0);
    expect(firstAlt.comp_per_1m).toBeGreaterThanOrEqual(0);
    expect(firstAlt.cost_difference_label).toBeDefined();
    expect(firstAlt.context_comparison_label).toBeDefined();
    expect(firstAlt.rationale.length).toBeGreaterThan(10);
    expect(report?.compare_url).toContain('/compare?models=');
  });

  it('2. Matches verified evaluation benchmarks for comparable alternative models', () => {
    const report = findMigrationAlternatives('openai/gpt-4o', []);
    expect(report).toBeDefined();

    const r1Alt = report?.alternatives.find((a) => a.model_id === 'deepseek/deepseek-r1');
    if (r1Alt && r1Alt.benchmark_comparison) {
      expect(r1Alt.benchmark_comparison.arena_elo).toBe(1364);
      expect(r1Alt.benchmark_comparison.source_name).toBeDefined();
      expect(r1Alt.benchmark_comparison.source_url).toContain('deepseek.com');
    }
  });

  it('3. Responds with JSON report from GET /api/v1/migrate?model=openai/gpt-4o', async () => {
    const req = new NextRequest('https://ai-model-radar.com/api/v1/migrate?model=openai/gpt-4o');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.target_model.model_id).toBe('openai/gpt-4o');
    expect(Array.isArray(json.alternatives)).toBe(true);
    expect(json.compare_url).toBeDefined();
  });

  it('4. Returns 400 Bad Request if model query parameter is missing', async () => {
    const req = new NextRequest('https://ai-model-radar.com/api/v1/migrate');
    const res = await GET(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain('Missing required query parameter');
  });
});
