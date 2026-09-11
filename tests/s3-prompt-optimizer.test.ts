import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { approximateTokenCount, optimizePrompt } from '../src/lib/prompt-optimizer';
import { POST } from '../src/app/api/v1/prompt-optimize/route';

describe('S3 prompt optimizer (real token diff, session-only)', () => {
  it('savings trace to a computed token diff, not a guess', () => {
    const r = optimizePrompt({
      system_prompt: 'You are helpful.\n\n\nYou are helpful.\n   Be concise.   ',
      target_model_id: 'openai/gpt-4o',
    });
    expect(r.tokens_before).toBeGreaterThan(r.tokens_after);
    expect(r.tokens_saved).toBe(r.tokens_before - r.tokens_after);
    expect(r.tokenizer.toLowerCase()).toContain('approximation');
    expect(approximateTokenCount('hello world')).toBeGreaterThan(0);
  });

  it('cross-references prompt-caching capability', () => {
    const r = optimizePrompt({ system_prompt: 'Be concise.', target_model_id: 'openai/gpt-4o' });
    expect(r.caching_note).toContain('caching');
  });

  it('POST is no-store and carries the privacy notice', async () => {
    const res = await POST(
      new NextRequest('http://localhost/api/v1/prompt-optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system_prompt: 'Be brief.\n\n\nBe brief.', target_model_id: 'openai/gpt-4o' }),
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    const body = await res.json();
    expect(body.privacy.toLowerCase()).toContain('not persisted');
    expect(body.tokens_saved).toBeGreaterThanOrEqual(0);
  });
});
