'use client';

import React, { useState } from 'react';
import { Terminal, Code2, Copy, Check, ExternalLink, ShieldCheck, Key, Zap } from 'lucide-react';

export default function ApiDocsPage() {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyCode = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const endpoints = [
    {
      id: 'get-events',
      method: 'GET',
      path: '/api/v1/events',
      desc: 'Retrieve append-only stream of model price drops, new releases, free tier additions, and context changes.',
      params: [
        { name: 'types', type: 'string', desc: 'Comma-separated event types (e.g. PRICE_CHANGE,BECAME_FREE)' },
        { name: 'provider', type: 'string', desc: 'Filter by provider (e.g. DeepSeek, OpenAI, Anthropic)' },
        { name: 'free', type: 'boolean', desc: 'Filter to only 100% free model events (true/false)' },
        { name: 'limit', type: 'number', desc: 'Number of results to return (max 100, default 50)' },
      ],
      curl: 'curl -X GET "https://ai-model-radar.vercel.app/api/v1/events?types=PRICE_CHANGE,BECAME_FREE&limit=10"',
      example: `{
  "version": "v1",
  "total": 426,
  "has_more": true,
  "limit": 10,
  "offset": 0,
  "data": [
    {
      "id": 1,
      "model_id": "deepseek/deepseek-chat",
      "event_type": "PRICE_CHANGE",
      "pct_change": -30.0,
      "old_value": { "price_prompt": 0.00000020, "price_completion": 0.00000040 },
      "new_value": { "price_prompt": 0.00000014, "price_completion": 0.00000028 },
      "detected_at": "2025-02-22T08:00:00.000Z"
    }
  ]
}`,
    },
    {
      id: 'get-models',
      method: 'GET',
      path: '/api/v1/models',
      desc: 'List all currently active AI models across providers with normalized per-token pricing and context limits.',
      params: [
        { name: 'q', type: 'string', desc: 'Search query for model name or ID' },
        { name: 'provider', type: 'string', desc: 'Filter by provider name' },
        { name: 'free', type: 'boolean', desc: 'Return only $0/token free models' },
        { name: 'sortBy', type: 'string', desc: 'Sort by name, price, context, or updated' },
      ],
      curl: 'curl -X GET "https://ai-model-radar.vercel.app/api/v1/models?provider=Anthropic"',
      example: `{
  "version": "v1",
  "total": 417,
  "limit": 50,
  "offset": 0,
  "data": [
    {
      "model_id": "anthropic/claude-3-7-sonnet",
      "name": "Claude 3.7 Sonnet",
      "provider": "Anthropic",
      "price_prompt": 0.000003,
      "price_completion": 0.000015,
      "context_length": 200000,
      "is_free": false
    }
  ]
}`,
    },
    {
      id: 'get-arbitrage',
      method: 'GET',
      path: '/api/v1/arbitrage',
      desc: 'Fetch multi-provider price arbitrage clusters to compare host endpoints for identical model weights.',
      params: [],
      curl: 'curl -X GET "https://ai-model-radar.vercel.app/api/v1/arbitrage"',
      example: `{
  "version": "v1",
  "total_clusters": 12,
  "data": [
    {
      "family_key": "Llama 3.3 70B",
      "provider_count": 3,
      "max_prompt_savings_pct": 100,
      "cheapest_option": { "model_id": "meta-llama/llama-3.3-70b-instruct:free", "is_free": true },
      "expensive_option": { "model_id": "meta-llama/llama-3.3-70b-instruct", "prompt_per_1m": 0.70 }
    }
  ]
}`,
    },
    {
      id: 'get-benchmarks',
      method: 'GET',
      path: '/api/v1/benchmarks',
      desc: 'Retrieve verified, raw public benchmark scores (Chatbot Arena, SWE-bench Verified, HumanEval).',
      params: [{ name: 'provider', type: 'string', desc: 'Filter by provider' }],
      curl: 'curl -X GET "https://ai-model-radar.vercel.app/api/v1/benchmarks"',
      example: `{
  "version": "v1",
  "total": 8,
  "methodology": "Verified unsynthesized evaluation records",
  "data": [
    {
      "model_id": "anthropic/claude-3-7-sonnet",
      "arena_elo": 1368,
      "swe_bench_verified": 70.3,
      "humaneval": 93.2,
      "tested_date": "2025-02-24"
    }
  ]
}`,
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="border-b border-gray-800 pb-6">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-cyan-950/60 border border-cyan-800/50 text-cyan-400 text-xs font-mono mb-2">
          <Code2 className="w-3.5 h-3.5" />
          <span>DEVELOPER READ API v1</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          Public API &amp; Integration Guide
        </h1>
        <p className="mt-1.5 text-sm sm:text-base text-gray-400 max-w-2xl">
          Programmatic access to the AI Model Radar event stream, model directories, price arbitrage matrices, and verified benchmark datasets.
        </p>
      </div>

      {/* Auth & Rate Limits Info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl border border-gray-800 bg-[#111827]/70">
          <div className="flex items-center gap-2 text-cyan-400 mb-1">
            <Key className="w-4 h-4" />
            <span className="text-xs font-mono font-bold uppercase">Authentication</span>
          </div>
          <p className="text-xs text-gray-400">
            Public read endpoints require no auth in v1. Optional <code className="text-gray-200">x-api-key</code> supported.
          </p>
        </div>

        <div className="p-4 rounded-xl border border-gray-800 bg-[#111827]/70">
          <div className="flex items-center gap-2 text-emerald-400 mb-1">
            <Zap className="w-4 h-4" />
            <span className="text-xs font-mono font-bold uppercase">Rate Limits</span>
          </div>
          <p className="text-xs text-gray-400">
            120 requests / minute per IP. Standard <code className="text-gray-200">X-RateLimit-*</code> headers included.
          </p>
        </div>

        <div className="p-4 rounded-xl border border-gray-800 bg-[#111827]/70">
          <div className="flex items-center gap-2 text-purple-400 mb-1">
            <ShieldCheck className="w-4 h-4" />
            <span className="text-xs font-mono font-bold uppercase">CORS Policy</span>
          </div>
          <p className="text-xs text-gray-400">
            Permissive <code className="text-gray-200">Access-Control-Allow-Origin: *</code> for seamless browser integrations.
          </p>
        </div>
      </div>

      {/* Endpoints List */}
      <div className="space-y-8">
        {endpoints.map((ep) => (
          <div
            key={ep.id}
            className="rounded-2xl border border-gray-800 bg-[#111827]/80 p-6 space-y-4 shadow-sm"
          >
            {/* Method & Path */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800/80 pb-4">
              <div className="flex items-center gap-3">
                <span className="px-2.5 py-1 rounded-md text-xs font-mono font-bold bg-cyan-950 text-cyan-400 border border-cyan-800">
                  {ep.method}
                </span>
                <code className="text-sm font-mono font-bold text-white">
                  {ep.path}
                </code>
              </div>
              <span className="text-xs text-gray-400">{ep.desc}</span>
            </div>

            {/* Query Parameters */}
            {ep.params.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-mono font-bold text-gray-400 uppercase tracking-wider">
                  Query Parameters
                </h4>
                <div className="grid grid-cols-1 gap-1.5">
                  {ep.params.map((p) => (
                    <div
                      key={p.name}
                      className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 text-xs bg-gray-900/60 p-2 rounded-lg border border-gray-800"
                    >
                      <code className="font-mono text-cyan-400 font-semibold min-w-[90px]">
                        {p.name}
                      </code>
                      <span className="font-mono text-[10px] text-gray-500 min-w-[60px]">
                        ({p.type})
                      </span>
                      <span className="text-gray-300">{p.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Curl Command */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-mono text-gray-400">
                <span>Example cURL Request</span>
                <button
                  onClick={() => copyCode(`${ep.id}-curl`, ep.curl)}
                  className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300"
                >
                  {copiedId === `${ep.id}-curl` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedId === `${ep.id}-curl` ? 'Copied' : 'Copy cURL'}</span>
                </button>
              </div>
              <pre className="bg-gray-950 border border-gray-800 p-3 rounded-xl text-xs font-mono text-gray-200 overflow-x-auto">
                {ep.curl}
              </pre>
            </div>

            {/* JSON Response Preview */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-mono text-gray-400">
                <span>Example Response (200 OK)</span>
                <button
                  onClick={() => copyCode(`${ep.id}-json`, ep.example)}
                  className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300"
                >
                  {copiedId === `${ep.id}-json` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedId === `${ep.id}-json` ? 'Copied' : 'Copy JSON'}</span>
                </button>
              </div>
              <pre className="bg-gray-950 border border-gray-800 p-3 rounded-xl text-xs font-mono text-emerald-400 overflow-x-auto max-h-56">
                {ep.example}
              </pre>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
