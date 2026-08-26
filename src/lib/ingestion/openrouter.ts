import { OpenRouterRawModel, ModelSnapshot } from '@/types/models';
import { extractProvider } from '@/lib/utils';

const DEFAULT_OPENROUTER_URL = 'https://openrouter.ai/api/v1/models';

/**
 * Fetches the latest models list from OpenRouter's public API
 */
export async function fetchOpenRouterModels(customUrl?: string): Promise<OpenRouterRawModel[]> {
  const url = customUrl || process.env.OPENROUTER_API_URL || DEFAULT_OPENROUTER_URL;
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'AI-Model-Radar/1.0',
      Accept: 'application/json',
    },
    // Don't cache in serverless / node
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch OpenRouter models: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  if (!json || !Array.isArray(json.data)) {
    throw new Error('Invalid OpenRouter response format: missing data array');
  }

  return json.data as OpenRouterRawModel[];
}

/**
 * Converts a raw OpenRouter API model object into a normalized ModelSnapshot record
 */
export function normalizeOpenRouterModel(raw: OpenRouterRawModel, polledAt = new Date().toISOString()): ModelSnapshot {
  const modelId = raw.id;
  const provider = extractProvider(modelId);
  const name = raw.name || modelId;

  // Extract prompt & completion pricing per token
  let pricePrompt: number | null = null;
  let priceCompletion: number | null = null;

  if (raw.pricing) {
    const promptStr = String(raw.pricing.prompt ?? '');
    const compStr = String(raw.pricing.completion ?? '');

    const pVal = parseFloat(promptStr);
    const cVal = parseFloat(compStr);

    if (!isNaN(pVal)) pricePrompt = pVal;
    if (!isNaN(cVal)) priceCompletion = cVal;
  }

  // Determine context length
  let contextLength: number | null = null;
  if (typeof raw.context_length === 'number' && raw.context_length > 0) {
    contextLength = raw.context_length;
  } else if (raw.top_provider && typeof raw.top_provider.context_length === 'number') {
    contextLength = raw.top_provider.context_length;
  }

  // Modality
  let modality = 'text->text';
  if (raw.architecture?.modality) {
    modality = raw.architecture.modality;
  }

  // Check if free
  const isFree = pricePrompt === 0 && priceCompletion === 0;

  return {
    model_id: modelId,
    provider,
    name,
    price_prompt: pricePrompt,
    price_completion: priceCompletion,
    context_length: contextLength,
    modality,
    is_free: isFree,
    raw_json: raw as Record<string, any>,
    polled_at: polledAt,
  };
}
