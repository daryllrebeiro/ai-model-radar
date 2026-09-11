import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import {
  RAW_EMBEDDING_DATA,
  RAW_EMBEDDING_BENCHMARKS,
  classifyModelCategory,
  findEmbeddingForModel,
  findEmbeddingBenchmark,
} from '../src/lib/embeddings';
import { GET as v1Models } from '../src/app/api/v1/models/route';

describe('S9 embeddings lane (own schema, no composite score)', () => {
  it('every record sourced + dated; no composite score field', () => {
    expect(RAW_EMBEDDING_DATA.length).toBeGreaterThan(0);
    for (const r of RAW_EMBEDDING_DATA) {
      expect(r.source_url).toMatch(/^https:\/\//);
      expect(r.verified_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect((r as any).score).toBeUndefined();
      expect((r as any).quality_score).toBeUndefined();
    }
    for (const b of RAW_EMBEDDING_BENCHMARKS) {
      expect((b as any).score).toBeUndefined();
      expect((b as any).overall).toBeUndefined();
      expect(b.source_url).toMatch(/^https:\/\//);
    }
  });

  it('category discriminator classifies correctly', () => {
    expect(classifyModelCategory('openai/text-embedding-3-large')).toBe('embedding');
    expect(classifyModelCategory('OPENAI/TEXT-EMBEDDING-3-SMALL:free')).toBe('embedding');
    expect(classifyModelCategory('openai/gpt-4o')).toBe('chat');
    expect(classifyModelCategory('cohere/embed-english-v3.0')).toBe('embedding');
  });

  it('embedding attrs carry dimensions + price, not chat columns', () => {
    const e = findEmbeddingForModel('openai/text-embedding-3-large')!;
    expect(e.dimensions).toBe(3072);
    expect(e.price_per_1m).toBeGreaterThan(0);
    const b = findEmbeddingBenchmark('openai/text-embedding-3-large')!;
    expect(b.retrieval).toBeGreaterThan(0);
    expect(b.sts).toBeGreaterThan(0);
  });

  it('v1/models category filter works', async () => {
    const req = new NextRequest('http://localhost/api/v1/models?category=embedding&limit=50');
    const res = await v1Models(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const m of body.data) {
      expect(m.category).toBe('embedding');
    }
  });
});
