import { EmbeddingModelRecord, EmbeddingBenchmarkRecord, ModelCategory } from '@/types/embeddings';

/**
 * S9 — Curated embedding catalog + MTEB subtask scores.
 * Sourced + dated like chat benchmarks. No composite score, ever.
 */
export const RAW_EMBEDDING_DATA: EmbeddingModelRecord[] = [
  {
    model_id: 'openai/text-embedding-3-large',
    name: 'text-embedding-3-large',
    provider: 'OpenAI',
    dimensions: 3072,
    max_input_length: 8191,
    price_per_1m: 0.13,
    verified_date: '2026-09-10',
    source_name: 'OpenAI Embeddings Guide',
    source_url: 'https://platform.openai.com/docs/guides/embeddings',
  },
  {
    model_id: 'openai/text-embedding-3-small',
    name: 'text-embedding-3-small',
    provider: 'OpenAI',
    dimensions: 1536,
    max_input_length: 8191,
    price_per_1m: 0.02,
    verified_date: '2026-09-10',
    source_name: 'OpenAI Embeddings Guide',
    source_url: 'https://platform.openai.com/docs/guides/embeddings',
  },
  {
    model_id: 'cohere/embed-english-v3.0',
    name: 'Embed English v3.0',
    provider: 'Cohere',
    dimensions: 1024,
    max_input_length: 512,
    price_per_1m: 0.1,
    verified_date: '2026-09-10',
    source_name: 'Cohere Embed Docs',
    source_url: 'https://docs.cohere.com/docs/cohere-embed',
  },
];

export const RAW_EMBEDDING_BENCHMARKS: EmbeddingBenchmarkRecord[] = [
  {
    model_id: 'openai/text-embedding-3-large',
    name: 'text-embedding-3-large',
    provider: 'OpenAI',
    retrieval: 55.4,
    classification: 75.2,
    clustering: 48.9,
    reranking: 61.0,
    sts: 85.1,
    tested_date: '2024-01-25',
    source_name: 'MTEB Leaderboard',
    source_url: 'https://huggingface.co/spaces/mteb/leaderboard',
  },
  {
    model_id: 'openai/text-embedding-3-small',
    name: 'text-embedding-3-small',
    provider: 'OpenAI',
    retrieval: 51.1,
    classification: 72.8,
    clustering: 46.5,
    reranking: 58.3,
    sts: 83.2,
    tested_date: '2024-01-25',
    source_name: 'MTEB Leaderboard',
    source_url: 'https://huggingface.co/spaces/mteb/leaderboard',
  },
  {
    model_id: 'cohere/embed-english-v3.0',
    name: 'Embed English v3.0',
    provider: 'Cohere',
    retrieval: 53.8,
    classification: 74.1,
    clustering: 47.2,
    reranking: 60.4,
    sts: 84.0,
    tested_date: '2023-11-02',
    source_name: 'MTEB Leaderboard',
    source_url: 'https://huggingface.co/spaces/mteb/leaderboard',
  },
];

const EMBEDDING_HINTS = ['embed', 'bge-', 'e5-', 'gte-', 'text-embedding', 'cohere/embed', 'voyage'];

export function classifyModelCategory(modelId: string): ModelCategory {
  const needle = modelId.toLowerCase().replace(/:free$/, '');
  if (RAW_EMBEDDING_DATA.some((r) => r.model_id.toLowerCase() === needle)) return 'embedding';
  if (EMBEDDING_HINTS.some((h) => needle.includes(h))) return 'embedding';
  return 'chat';
}

export function findEmbeddingForModel(modelId: string): EmbeddingModelRecord | null {
  const needle = modelId.toLowerCase().replace(/:free$/, '');
  return (
    RAW_EMBEDDING_DATA.find((r) => r.model_id.toLowerCase() === needle) ||
    RAW_EMBEDDING_DATA.find(
      (r) => needle.includes(r.model_id.toLowerCase()) || r.model_id.toLowerCase().includes(needle),
    ) ||
    null
  );
}

export function findEmbeddingBenchmark(modelId: string): EmbeddingBenchmarkRecord | null {
  const needle = modelId.toLowerCase().replace(/:free$/, '');
  return RAW_EMBEDDING_BENCHMARKS.find((r) => r.model_id.toLowerCase() === needle) || null;
}

export function filterModelIdsByCategory(modelIds: string[], category: ModelCategory): string[] {
  return modelIds.filter((id) => classifyModelCategory(id) === category);
}
