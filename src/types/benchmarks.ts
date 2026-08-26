export interface RawBenchmarkRecord {
  model_id: string;
  name: string;
  provider: string;
  arena_elo?: number; // LMSYS Chatbot Arena Elo
  swe_bench_verified?: number; // SWE-bench Verified %
  humaneval?: number; // HumanEval pass@1 %
  math_500?: number; // MATH-500 %
  gpqa_diamond?: number; // GPQA Diamond %
  mmlu_pro?: number; // MMLU-Pro %
  tested_date: string;
  source_name?: string;
  source_url: string;
  pricing_prompt_1m?: number;
  pricing_comp_1m?: number;
}

export interface CustomBenchmarkWeights {
  coding: number; // 0 - 100
  reasoning: number; // 0 - 100
  general: number; // 0 - 100
  math: number; // 0 - 100
  costEfficiency: number; // 0 - 100
}
