/**
 * S9 — Dedicated embeddings / vector-model lane.
 *
 * Chat-model columns (arena_elo, swe_bench, humaneval…) are inapplicable to
 * embeddings. Embeddings get their own discriminator + attribute schema:
 * dimensions, max input length, price per call, and INDIVIDUAL MTEB subtask
 * scores. No synthesized single "embedding quality score" — same discipline
 * as chat benchmarks (show subtasks individually, never a fabricated composite).
 */

export type ModelCategory = 'chat' | 'embedding';

export interface EmbeddingModelRecord {
  model_id: string;
  name: string;
  provider: string;
  /** Vector dimensionality. Null = unpublished. */
  dimensions: number | null;
  /** Max input tokens/chars as published. Null = unpublished. */
  max_input_length: number | null;
  /** Price per 1M tokens (or per call where noted). Null = unpublished. */
  price_per_1m: number | null;
  verified_date: string;
  source_name: string;
  source_url: string;
}

/** Individual MTEB subtask scores — one row per model, subtasks kept separate. */
export interface EmbeddingBenchmarkRecord {
  model_id: string;
  name: string;
  provider: string;
  /** MTEB subtask scores (0-100), each individually sourced. Omit unknown. */
  retrieval?: number;
  classification?: number;
  clustering?: number;
  reranking?: number;
  sts?: number;
  summarization?: number;
  tested_date: string;
  source_name: string;
  source_url: string;
}
