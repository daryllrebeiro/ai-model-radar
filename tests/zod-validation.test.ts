import { describe, it, expect } from 'vitest';
import { modelsQuerySchema, eventsQuerySchema } from '../src/lib/validation/api-schemas';

describe('Phase P2: Zod API Input Validation', () => {
  it('1. Validates and parses valid model query parameters with defaults', () => {
    const validParams = {
      q: 'claude',
      provider: 'Anthropic',
      free: 'false',
      sortBy: 'price',
      limit: '25',
      offset: '10',
    };

    const result = modelsQuerySchema.safeParse(validParams);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.q).toBe('claude');
      expect(result.data.provider).toBe('Anthropic');
      expect(result.data.free).toBe(false);
      expect(result.data.sortBy).toBe('price');
      expect(result.data.limit).toBe(25);
      expect(result.data.offset).toBe(10);
    }
  });

  it('2. Rejects invalid parameters (e.g. out-of-range limit, invalid sortBy)', () => {
    const invalidParams = {
      sortBy: 'invalid_sort_key',
      limit: '500', // max 100
      offset: '-5', // min 0
    };

    const result = modelsQuerySchema.safeParse(invalidParams);
    expect(result.success).toBe(false);
  });

  it('3. Parses event types in events query schema', () => {
    const validEventParams = {
      types: 'PRICE_CHANGE,BECAME_FREE',
      limit: '50',
    };

    const result = eventsQuerySchema.safeParse(validEventParams);
    expect(result.success).toBe(true);
  });
});
