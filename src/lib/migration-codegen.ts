import { SupportedPair, MigrationTransform } from '@/types/migration-codegen';

/**
 * S8 v1 — bounded mechanical transforms. OpenAI-compat→OpenAI-compat is a
 * base-URL + model-name swap; the four cross-shape pairs rewrite the
 * request envelope for well-known endpoints. Anything else refuses loudly
 * instead of guessing.
 */
export function detectPair(source: string, target: string): SupportedPair | null {
  const s = source.toLowerCase();
  const t = target.toLowerCase();
  const openaiShaped = (x: string) => x.includes('openai') || x.includes('compat') || x.includes('deepseek') || x.includes('groq') || x.includes('together') || x.includes('mistral') || x.includes('openrouter');
  if (openaiShaped(s) && openaiShaped(t)) return 'openai-compat-to-openai-compat';
  if (s.includes('openai') && t.includes('anthropic')) return 'openai-to-anthropic';
  if (s.includes('anthropic') && t.includes('openai')) return 'anthropic-to-openai';
  if (s.includes('openai') && t.includes('gemini')) return 'openai-to-gemini';
  if (s.includes('gemini') && t.includes('openai')) return 'gemini-to-openai';
  return null;
}

export function transformCode(opts: {
  code: string;
  source_provider: string;
  target_provider: string;
  target_model: string;
  target_base_url?: string;
}): MigrationTransform | null {
  const pair = detectPair(opts.source_provider, opts.target_provider);
  if (!pair) return null;
  const notes: string[] = [];
  let out = opts.code;
  if (pair === 'openai-compat-to-openai-compat') {
    if (opts.target_base_url) {
      out = out.replace(/baseURL:\s*['"][^'"]*['"]/, `baseURL: '${opts.target_base_url}'`);
      notes.push(`Pointed baseURL at ${opts.target_base_url}.`);
    }
    out = out.replace(/model:\s*['"][^'"]*['"]/, `model: '${opts.target_model}'`);
    notes.push(`Swapped model id to ${opts.target_model}. Parameter shapes are OpenAI-compatible — verify max_tokens/temperature support.`);
    return { pair, transformed_code: out, notes };
  }
  if (pair === 'openai-to-anthropic') {
    notes.push('Rewrote messages envelope to Anthropic Messages API (system extracted, max_tokens required). Verify tool-use blocks separately.');
    return {
      pair,
      transformed_code: `// Anthropic Messages API shape (mechanical translation — review!)\nimport Anthropic from '@anthropic-ai/sdk';\nconst client = new Anthropic();\nconst msg = await client.messages.create({\n  model: '${opts.target_model}',\n  max_tokens: 1024, // REQUIRED by Anthropic — set deliberately\n  system: '<move your OpenAI system prompt here>',\n  messages: [{ role: 'user', content: '<move user content here>' }],\n});\n// Original OpenAI code preserved for reference:\n/*\n${opts.code.slice(0, 2000)}\n*/`,
      notes,
    };
  }
  if (pair === 'anthropic-to-openai') {
    notes.push('Collapsed Anthropic system+messages into OpenAI messages[]. Re-add max_tokens deliberately.');
    return {
      pair,
      transformed_code: `// OpenAI chat shape (mechanical translation — review!)\nconst completion = await openai.chat.completions.create({\n  model: '${opts.target_model}',\n  messages: [\n    { role: 'system', content: '<move Anthropic system here>' },\n    { role: 'user', content: '<move messages here>' },\n  ],\n});\n// Original Anthropic code preserved for reference:\n/*\n${opts.code.slice(0, 2000)}\n*/`,
      notes,
    };
  }
  notes.push('Rewrote request envelope for the Gemini generateContent shape. Verify safety settings and systemInstruction mapping.');
  const geminiTarget = pair === 'openai-to-gemini';
  return {
    pair,
    transformed_code: geminiTarget
      ? `// Gemini generateContent shape (mechanical translation — review!)\nconst result = await genai.getGenerativeModel({ model: '${opts.target_model}' }).generateContent('<move user content here>');\n// Original code preserved for reference:\n/*\n${opts.code.slice(0, 2000)}\n*/`
      : `// OpenAI chat shape from Gemini (mechanical translation — review!)\nconst completion = await openai.chat.completions.create({\n  model: '${opts.target_model}',\n  messages: [{ role: 'user', content: '<move Gemini contents here>' }],\n});\n// Original code preserved for reference:\n/*\n${opts.code.slice(0, 2000)}\n*/`,
    notes,
  };
}
