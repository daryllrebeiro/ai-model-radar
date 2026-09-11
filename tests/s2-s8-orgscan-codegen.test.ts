import { describe, it, expect } from 'vitest';
import { scanFilesForModels, extractModelRefs, isOrgAllowlisted } from '../src/lib/org-scan';
import { ORG_SCAN_SCOPES, ORG_SCAN_DATA_POLICY } from '../src/types/org-scan';
import { transformCode, detectPair } from '../src/lib/migration-codegen';
import { MIGRATION_BEHAVIORAL_CAVEAT } from '../src/types/migration-codegen';

describe('S2 org scan (report-only, minimal scope)', () => {
  it('requests contents:read only, nothing else', () => {
    expect([...ORG_SCAN_SCOPES]).toEqual(['contents:read']);
    expect(ORG_SCAN_DATA_POLICY.toLowerCase()).toContain('never retained');
  });

  it('matches known model ids with file/line refs, stores matched line only', () => {
    const matches = scanFilesForModels(
      [{ repo: 'acme/api', path: 'src/llm.ts', content: "const m = 'openai/gpt-4o';\nconst x = 1;" }],
      ['openai/gpt-4o']
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].line).toBe(1);
    expect(matches[0].matched_line).toContain('openai/gpt-4o');
    expect(Object.keys(matches[0])).not.toContain('content');
  });

  it('ignores unknown strings, flags removed models', () => {
    expect(extractModelRefs('no models here')).toEqual([]);
    const matches = scanFilesForModels(
      [{ repo: 'r', path: 'f', content: "use 'acme/old-model';" }],
      ['acme/old-model'],
      () => 'removed'
    );
    expect(matches[0].risk_note).toContain('MODEL_REMOVED');
  });

  it('pilot allowlist is open when unset, scoped when set', () => {
    expect(isOrgAllowlisted('acme', '')).toBe(true);
    expect(isOrgAllowlisted('Acme', 'acme, globex')).toBe(true);
    expect(isOrgAllowlisted('initech', 'acme, globex')).toBe(false);
  });
});

describe('S8 migration codegen (suggested diff, no auto-apply)', () => {
  it('caveat disclaims behavioral equivalence', () => {
    expect(MIGRATION_BEHAVIORAL_CAVEAT.toLowerCase()).toContain('not a guarantee');
  });

  it('openai-compat swap rewrites model + baseURL', () => {
    const r = transformCode({
      code: "const c = new OpenAI({ baseURL: 'https://api.a.com/v1' });\nconst r = await c.chat.completions.create({ model: 'a/m', messages });",
      source_provider: 'openai-compatible-a',
      target_provider: 'openai-compatible-b',
      target_model: 'b/m2',
      target_base_url: 'https://api.b.com/v1',
    });
    expect(r?.pair).toBe('openai-compat-to-openai-compat');
    expect(r!.transformed_code).toContain('b/m2');
    expect(r!.transformed_code).toContain('https://api.b.com/v1');
  });

  it('cross-shape pairs emit explicit envelopes; unknown pairs refuse', () => {
    const r = transformCode({
      code: 'openai call',
      source_provider: 'openai',
      target_provider: 'anthropic',
      target_model: 'claude-x',
    });
    expect(r?.transformed_code).toContain('messages.create');
    expect(detectPair('unknown-a', 'unknown-b')).toBeNull();
    expect(transformCode({ code: 'x', source_provider: 'unknown-a', target_provider: 'unknown-b', target_model: 'm' })).toBeNull();
  });
});
