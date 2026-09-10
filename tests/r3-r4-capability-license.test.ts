import { describe, it, expect } from 'vitest';
import { RAW_CAPABILITY_DATA, findCapabilityForModel, filterModelIdsByCapability } from '../src/lib/capabilities';
import { RAW_LICENSE_DATA, findLicenseForModel, filterModelIdsByCommercialUse } from '../src/lib/licenses';
import { LICENSE_DISCLAIMER } from '../src/types/licenses';
import { GET as v1Models } from '../src/app/api/v1/models/route';
import { NextRequest } from 'next/server';

describe('R3 capability matrix (sourced, no guessed flags)', () => {
  it('every record has a source URL + verified date, no capability score', () => {
    expect(RAW_CAPABILITY_DATA.length).toBeGreaterThan(0);
    for (const r of RAW_CAPABILITY_DATA) {
      expect(r.source_url).toMatch(/^https:\/\//);
      expect(r.verified_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect((r as any).score).toBeUndefined();
      expect((r as any).capability_score).toBeUndefined();
    }
  });

  it('lookup is case-insensitive and matches :free variants', () => {
    expect(findCapabilityForModel('OPENAI/GPT-4O')?.tool_calling).toBe(true);
    expect(findCapabilityForModel('openai/gpt-4o:free')?.vision).toBe(true);
    expect(findCapabilityForModel('nope/unknown-model-xyz')).toBeNull();
  });

  it('unknown flags stay undefined (rendered as —, never false)', () => {
    const r1 = findCapabilityForModel('deepseek/deepseek-r1')!;
    expect(r1.tool_calling).toBe(true);
    expect(r1.vision).toBeUndefined();
    expect(r1.audio_input).toBeUndefined();
  });

  it('filter helper only matches explicit true', () => {
    const ids = RAW_CAPABILITY_DATA.map((r) => r.model_id);
    const withTools = filterModelIdsByCapability(ids, 'tool_calling');
    expect(withTools.length).toBe(ids.length); // all curated rows document tool-calling
    const withAudioOut = filterModelIdsByCapability(ids, 'audio_output');
    expect(withAudioOut.length).toBeLessThan(ids.length);
    expect(withAudioOut).toContain('openai/gpt-4o');
    expect(withAudioOut).not.toContain('deepseek/deepseek-r1');
  });
});

describe('R4 licensing tracker (summary, not legal advice)', () => {
  it('every record has a source + date; disclaimer is explicit', () => {
    expect(LICENSE_DISCLAIMER.toLowerCase()).toContain('not legal advice');
    for (const r of RAW_LICENSE_DATA) {
      expect(r.source_url).toMatch(/^https:\/\//);
      expect(r.verified_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.license_id.length).toBeGreaterThan(0);
    }
  });

  it('proprietary vs open-weight distinction is explicit', () => {
    expect(findLicenseForModel('openai/gpt-4o')?.license_id).toContain('Proprietary');
    expect(findLicenseForModel('meta-llama/llama-3.3-70b-instruct')?.license_id).toContain('Llama');
    expect(findLicenseForModel('meta-llama/llama-3.3-70b-instruct')?.attribution_required).toBe(true);
  });

  it('uncertain commercial use is null, not false', () => {
    expect(findLicenseForModel('qwen/qwen-2.5-72b-instruct')?.commercial_use_allowed).toBeNull();
    const ids = RAW_LICENSE_DATA.map((r) => r.model_id);
    const commercial = filterModelIdsByCommercialUse(ids);
    expect(commercial).toContain('openai/gpt-4o');
    expect(commercial).not.toContain('qwen/qwen-2.5-72b-instruct');
  });
});

describe('R3/R4 API surface (v1/models filters + enrichment)', () => {
  it('enriches rows with capabilities + license without breaking shape', async () => {
    const res = await v1Models(
      new NextRequest('http://localhost/api/v1/models?limit=5', {
        headers: { 'x-forwarded-for': '10.200.1.1' },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe('v1');
    expect(Array.isArray(body.data)).toBe(true);
    if (body.data.length > 0) {
      expect(body.data[0]).toHaveProperty('capabilities');
      expect(body.data[0]).toHaveProperty('license');
    }
  });

  it('rejects invalid filter values (400), accepts valid ones (200)', async () => {
    const bad = await v1Models(
      new NextRequest('http://localhost/api/v1/models?tool_calling=maybe', {
        headers: { 'x-forwarded-for': '10.200.1.2' },
      })
    );
    expect(bad.status).toBe(400);
    const ok = await v1Models(
      new NextRequest('http://localhost/api/v1/models?tool_calling=true&limit=5', {
        headers: { 'x-forwarded-for': '10.200.1.3' },
      })
    );
    expect(ok.status).toBe(200);
  });
});
