import { describe, it, expect } from 'vitest';
import {
  selectBestModel,
  getDefaultPolicy,
  type ModelCandidate,
} from '@/lib/router';

function candidate(overrides: Partial<ModelCandidate> = {}): ModelCandidate {
  return {
    model_id: 'm1',
    provider: 'openai',
    name: 'Model 1',
    price_prompt: 1,
    price_completion: 2,
    context_length: 8192,
    is_free: false,
    provider_healthy: true,
    ...overrides,
  };
}

describe('selectBestModel', () => {
  it('returns null for an empty catalog', () => {
    expect(selectBestModel([], getDefaultPolicy('free'))).toBeNull();
  });

  it('excludes unhealthy models', () => {
    const models = [
      candidate({ model_id: 'down', provider_healthy: false, price_prompt: 0 }),
      candidate({ model_id: 'up', price_prompt: 5 }),
    ];
    const picked = selectBestModel(models, getDefaultPolicy('pro'));
    expect(picked?.model_id).toBe('up');
  });

  it('prefers free models for the free tier policy', () => {
    const models = [
      candidate({ model_id: 'cheap-paid', price_prompt: 0.1, price_completion: 0.2, is_free: false }),
      candidate({ model_id: 'free-model', price_prompt: 0, price_completion: 0, is_free: true }),
    ];
    const picked = selectBestModel(models, getDefaultPolicy('free'));
    expect(picked?.model_id).toBe('free-model');
  });

  it('picks cheapest first for pro tier (no free preference)', () => {
    const models = [
      candidate({ model_id: 'expensive', price_prompt: 5 }),
      candidate({ model_id: 'cheap', price_prompt: 0.5 }),
    ];
    const picked = selectBestModel(models, getDefaultPolicy('pro'));
    expect(picked?.model_id).toBe('cheap');
  });

  it('honors allowed/blocked provider lists', () => {
    const models = [
      candidate({ model_id: 'a', provider: 'openai' }),
      candidate({ model_id: 'b', provider: 'anthropic' }),
    ];
    const policy = { ...getDefaultPolicy('enterprise'), allowed_providers: ['anthropic'] };
    expect(selectBestModel(models, policy)?.model_id).toBe('b');

    const blocked = { ...getDefaultPolicy('enterprise'), blocked_providers: ['openai', 'anthropic'] };
    expect(selectBestModel(models, blocked)).toBeNull();
  });

  it('enforces context-length and price ceilings', () => {
    const models = [
      candidate({ model_id: 'tiny', context_length: 1024 }),
      candidate({ model_id: 'pricey', price_prompt: 500 }),
      candidate({ model_id: 'ok', context_length: 32768, price_prompt: 1, price_completion: 1 }),
    ];
    const picked = selectBestModel(models, getDefaultPolicy('pro'));
    expect(picked?.model_id).toBe('ok');
  });

  it('treats null prices as infinitely expensive', () => {
    const models = [
      candidate({ model_id: 'unknown-price', price_prompt: null }),
      candidate({ model_id: 'known', price_prompt: 9 }),
    ];
    const picked = selectBestModel(models, getDefaultPolicy('enterprise'));
    expect(picked?.model_id).toBe('known');
  });
});

describe('getDefaultPolicy', () => {
  it('is strictest for free tier, loosest for enterprise', () => {
    const free = getDefaultPolicy('free');
    const ent = getDefaultPolicy('enterprise');
    expect(free.prefer_free).toBe(true);
    expect(ent.prefer_free).toBe(false);
    expect((free.max_price_prompt ?? 0)).toBeLessThan(ent.max_price_prompt ?? 0);
  });
});
