import { describe, it, expect } from 'vitest';
import { estimateBuildVsBuy } from '../src/lib/finetuning';
import { FINETUNE_QUALITY_DISCLAIMER } from '../src/types/finetuning';
import { POST } from '../src/app/api/v1/finetune-estimate/route';
import { NextRequest } from 'next/server';

describe('S6 build-vs-buy (cost only, quality disclaimed)', () => {
  it('disclaimer is prominent and explicit', () => {
    expect(FINETUNE_QUALITY_DISCLAIMER.toLowerCase()).toContain('cannot verify');
    expect(FINETUNE_QUALITY_DISCLAIMER.toLowerCase()).toContain('comparable quality');
  });

  it('estimates from tracked pricing with breakeven math', () => {
    const e = estimateBuildVsBuy({
      monthly_prompt_tokens: 10_000_000,
      monthly_comp_tokens: 2_000_000,
      training_tokens: 5_000_000,
      large_model_id: 'openai/gpt-4o',
      small_model_id: 'openai/gpt-4o-mini',
    });
    expect(e).not.toBeNull();
    expect(e!.prompt_large_monthly).toBeGreaterThan(e!.finetune_hosted_monthly);
    expect(e!.breakeven_months).not.toBeNull();
  });

  it('returns null (422) for unknown pricing — never guesses', () => {
    expect(
      estimateBuildVsBuy({
        monthly_prompt_tokens: 1000,
        monthly_comp_tokens: 1000,
        training_tokens: 1000,
        large_model_id: 'nope/unknown-xyz',
        small_model_id: 'nope/unknown-abc',
      })
    ).toBeNull();
  });

  it('POST carries the disclaimer on every estimate', async () => {
    const res = await POST(
      new NextRequest('http://localhost/api/v1/finetune-estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          monthly_prompt_tokens: 10_000_000,
          monthly_comp_tokens: 2_000_000,
          training_tokens: 5_000_000,
          large_model_id: 'openai/gpt-4o',
          small_model_id: 'openai/gpt-4o-mini',
        }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.disclaimer).toContain('cannot verify');
    expect(body.estimate.monthly_savings_after_training).toBeGreaterThan(0);
  });
});
