import React from 'react';
import { RAW_BENCHMARK_DATA } from '@/lib/benchmarks';
import { BenchmarkMatrix } from '@/components/benchmarks/benchmark-matrix';
import { Award, Info } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function BenchmarksPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="border-b border-gray-800 pb-6">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-purple-950/60 border border-purple-800/50 text-purple-400 text-xs font-mono mb-2">
          <Award className="w-3.5 h-3.5" />
          <span>VERIFIED PUBLIC BENCHMARK DATA</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          Model Benchmark Matrix
        </h1>
        <p className="mt-1.5 text-sm sm:text-base text-gray-400 max-w-2xl">
          Raw, verifiable benchmark metrics sourced directly from public test evaluations and leaderboard logs. No synthesized composite certainty claims.
        </p>
      </div>

      {/* Principle #2 & #3 Callout Notice */}
      <div className="p-4 rounded-xl border border-purple-500/20 bg-purple-950/20 flex items-start gap-3 text-xs text-gray-300">
        <Info className="w-4 h-4 text-purple-400 mt-0.5 flex-shrink-0" />
        <div>
          <strong className="text-purple-300">Strict Non-Synthesized Methodology: </strong>
          Benchmark scores presented below are exact sourced evaluation numbers from LMSYS Chatbot Arena, SWE-bench Verified, HumanEval, and technical research papers with timestamps. You can test your own custom priority weighting on the client side without altering underlying factual records.
        </div>
      </div>

      {/* Benchmark Matrix Table */}
      <section>
        <BenchmarkMatrix initialRecords={RAW_BENCHMARK_DATA} />
      </section>
    </div>
  );
}
