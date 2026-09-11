import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import {
  RAW_COMPLIANCE_DATA,
  findComplianceForModel,
  findProviderCompliance,
  filterModelIdsByHipaa,
  filterModelIdsByEuResidency,
} from '../src/lib/compliance';
import { COMPLIANCE_DISCLAIMER } from '../src/types/compliance';
import { GET as v1Models } from '../src/app/api/v1/models/route';

describe('S7 compliance tracker (provider-level, not legal advice)', () => {
  it('every record has source + date; disclaimer is stronger than R4', () => {
    expect(COMPLIANCE_DISCLAIMER.toLowerCase()).toContain('not legal');
    expect(COMPLIANCE_DISCLAIMER.toLowerCase()).toContain('verify directly with the provider');
    for (const r of RAW_COMPLIANCE_DATA) {
      expect(r.source_url).toMatch(/^https:\/\//);
      expect(r.verified_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect((r as any).score).toBeUndefined();
    }
  });

  it('models inherit provider posture; unknown stays null', () => {
    expect(findComplianceForModel('openai/gpt-4o')?.hipaa_eligible).toBe(true);
    expect(findComplianceForModel('openai/gpt-4o')?.overridden).toBe(false);
    expect(findComplianceForModel('openai/gpt-4o:free')?.eu_data_residency).toBe(true);
    expect(findComplianceForModel('deepseek/deepseek-r1')?.hipaa_eligible).toBeNull();
    expect(findComplianceForModel('nope/unknown-model-xyz')).toBeNull();
  });

  it('provider lookup is case-insensitive', () => {
    expect(findProviderCompliance('openai')?.provider).toBe('OpenAI');
    expect(findProviderCompliance('ANTHROPIC')?.hipaa_eligible).toBe(true);
  });

  it('filter helpers only match explicit true', () => {
    const ids = ['openai/gpt-4o', 'deepseek/deepseek-r1', 'nope/unknown-xyz'];
    expect(filterModelIdsByHipaa(ids)).toEqual(['openai/gpt-4o']);
    expect(filterModelIdsByEuResidency(ids)).toEqual(['openai/gpt-4o']);
  });

  it('v1/models supports hipaa_eligible + eu_residency filters', async () => {
    const req = new NextRequest('http://localhost/api/v1/models?hipaa_eligible=true&limit=50');
    const res = await v1Models(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    for (const m of body.data) {
      if (m.compliance) expect(m.compliance.hipaa_eligible).toBe(true);
    }
    const req2 = new NextRequest('http://localhost/api/v1/models?eu_residency=true&limit=50');
    const res2 = await v1Models(req2);
    expect(res2.status).toBe(200);
  });
});
