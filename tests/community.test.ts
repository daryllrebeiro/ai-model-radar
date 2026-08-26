import { describe, it, expect } from 'vitest';
import { getFallbackHFModels } from '../src/lib/ingestion/huggingface';

describe('Phase V2: Hugging Face Community Ingestion', () => {
  it('1. Generates structured community models with valid authors and metrics', () => {
    const models = getFallbackHFModels();
    expect(models.length).toBeGreaterThan(0);

    const first = models[0];
    expect(first.id).toBeDefined();
    expect(first.author).toBeDefined();
    expect(first.downloads).toBeGreaterThan(0);
    expect(first.likes).toBeGreaterThan(0);
    expect(first.pipeline_tag).toBeDefined();
    expect(Array.isArray(first.tags)).toBe(true);
  });
});
