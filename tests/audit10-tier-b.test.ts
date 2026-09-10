import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { RAW_CAPABILITY_DATA, findCapabilityForModel } from '../src/lib/capabilities';
import { RAW_LICENSE_DATA, findLicenseForModel } from '../src/lib/licenses';
import { LICENSE_DISCLAIMER } from '../src/types/licenses';
import { GET as v1Models } from '../src/app/api/v1/models/route';
import fs from 'fs';
import path from 'path';

// ─── Tier B: source integrity + no silent inference ────────────────────
describe('Tier B source traceability pins', () => {
  it('R1 tool-calling/source post-dates actual support (R1-0528, not the Jan report)', () => {
    // Audit correction: the original Jan-2025 R1 report predates function-calling
    // support (added in R1-0528, May 2025). A record pinning tool flags to the
    // Jan source would be an inferred flag — the audit's core Tier B violation.
    const r1 = findCapabilityForModel('deepseek/deepseek-r1')!;
    expect(r1.tool_calling).toBe(true);
    expect(r1.source_url).toContain('news250528');
    expect(r1.verified_date >= '2025-05-28').toBe(true);
  });

  it('no flag asserts what its cited source cannot know (Gemini tuning omitted)', () => {
    const gem = findCapabilityForModel('google/gemini-2.0-flash-001')!;
    expect(gem.fine_tuning).toBeUndefined();
  });

  it('at least the curated models carry dated https sources; no score fields', () => {
    for (const r of [...RAW_CAPABILITY_DATA, ...RAW_LICENSE_DATA]) {
      expect(r.source_url).toMatch(/^https:\/\//);
      expect(r.verified_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect((r as any).score).toBeUndefined();
    }
  });

  it('R4 disclaimer is a non-trivial "not legal advice" string rendered on both surfaces', () => {
    expect(LICENSE_DISCLAIMER.toLowerCase()).toContain('not legal advice');
    const compare = fs.readFileSync(path.join(process.cwd(), 'src/app/compare/page.tsx'), 'utf-8');
    const detail = fs.readFileSync(path.join(process.cwd(), 'src/app/models/[...id]/page.tsx'), 'utf-8');
    expect(compare).toContain('{LICENSE_DISCLAIMER}');
    expect(detail).toContain('{LICENSE_DISCLAIMER}');
  });
});

describe('Tier B filter boundary semantics', () => {
  it('unknown model enriches to null (never false); UI renders — for undefined', async () => {
    const res = await v1Models(
      new NextRequest('http://localhost/api/v1/models?q=definitely-not-a-real-model-zzz&limit=50', {
        headers: { 'x-forwarded-for': '10.90.1.1' },
      })
    );
    expect(res.status).toBe(200);
    const compare = fs.readFileSync(path.join(process.cwd(), 'src/app/compare/page.tsx'), 'utf-8');
    // Unknown renders as —, explicit false as No: two distinct states, no silent inference.
    expect(compare).toContain("'—'");
  });

  it('explicit-false filter matches only sourced false (never unknowns)', async () => {
    const res = await v1Models(
      new NextRequest('http://localhost/api/v1/models?tool_calling=false&limit=100', {
        headers: { 'x-forwarded-for': '10.90.1.2' },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const m of body.data as any[]) {
      // No row may claim tool_calling === false without a sourced record saying so.
      const rec = findCapabilityForModel(m.model_id);
      expect(rec?.tool_calling).toBe(false);
    }
  });

  it('no license row claims commercial denial without evidence', () => {
    for (const r of RAW_LICENSE_DATA) {
      if (r.commercial_use_allowed === false) {
        expect(r.commercial_use_note && r.commercial_use_note.length > 0).toBe(true);
      }
    }
    // Uncertain stays null, never false.
    expect(findLicenseForModel('qwen/qwen-2.5-72b-instruct')?.commercial_use_allowed).toBeNull();
  });
});
