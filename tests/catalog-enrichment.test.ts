import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import {
  applyAttributeFilters,
  enrichModels,
  hasAttributeFilters,
} from '../src/lib/catalog-enrichment';
import { GET as legacyModels } from '../src/app/api/models/route';
import { GET as v1Models } from '../src/app/api/v1/models/route';
import type { ModelCurrent } from '../src/types/models';

function m(model_id: string): ModelCurrent {
  return {
    model_id,
    provider: 'T',
    name: model_id,
    price_prompt: 1,
    price_completion: 1,
    context_length: 1000,
    modality: 'text->text',
    is_free: false,
    raw_json: {},
    polled_at: new Date().toISOString(),
  };
}

describe('catalog-enrichment (shared twin logic, ADR-4 freeze)', () => {
  it('filter helpers: empty filters pass through; unknowns never match', () => {
    expect(hasAttributeFilters({})).toBe(false);
    expect(hasAttributeFilters({ vision: true })).toBe(true);
    const models = [m('openai/gpt-4o'), m('nope/unknown-zzz')];
    expect(applyAttributeFilters(models, {})).toHaveLength(2);
    const vision = applyAttributeFilters(models, { vision: true });
    expect(vision.map((x) => x.model_id)).toEqual(['openai/gpt-4o']);
    // Explicit-false matches only sourced false, never unknowns.
    for (const x of applyAttributeFilters(models, { toolCalling: false })) {
      expect(x.model_id).not.toBe('nope/unknown-zzz');
    }
  });

  it('enrichment attaches sourced records or null (never false)', () => {
    const [known, unknown] = enrichModels([m('openai/gpt-4o'), m('nope/unknown-zzz')]);
    expect(known.capabilities?.vision).toBe(true);
    expect(known.license?.license_id).toContain('Proprietary');
    expect(unknown.capabilities).toBeNull();
    expect(unknown.license).toBeNull();
  });

  it('legacy/v1 parity: same query, same enriched shape (freeze guard)', async () => {
    const ip = `10.77.${Math.floor(Math.random() * 200) + 1}.9`;
    const legacy = await legacyModels(
      new NextRequest('http://localhost/api/models?limit=5&tool_calling=true', {
        headers: { 'x-forwarded-for': ip },
      })
    );
    const v1 = await v1Models(
      new NextRequest('http://localhost/api/v1/models?limit=5&tool_calling=true', {
        headers: { 'x-forwarded-for': ip },
      })
    );
    expect(legacy.status).toBe(200);
    expect(v1.status).toBe(200);
    const l = await legacy.json();
    const v = await v1.json();
    expect(l.total).toBe(v.total);
    expect(l.models.map((x: any) => x.model_id)).toEqual(v.data.map((x: any) => x.model_id));
    for (const row of [...l.models, ...v.data]) {
      expect(row).toHaveProperty('capabilities');
      expect(row).toHaveProperty('license');
    }
  });
});
