import { ModelSnapshot } from '@/types/models';
import { formatPricePerMillion } from './utils';

export interface ArbitrageProviderOption {
  model_id: string;
  provider: string;
  price_prompt: number | null;
  price_completion: number | null;
  context_length: number | null;
  is_free: boolean;
  prompt_per_1m: number;
  comp_per_1m: number;
}

export interface ArbitrageCluster {
  family_key: string;
  display_name: string;
  provider_count: number;
  cheapest_option: ArbitrageProviderOption;
  expensive_option: ArbitrageProviderOption;
  max_prompt_savings_pct: number;
  max_comp_savings_pct: number;
  prompt_spread_per_1m: number;
  comp_spread_per_1m: number;
  all_options: ArbitrageProviderOption[];
}

/**
 * Normalizes model ID into a canonical family key to cluster identical weights
 */
export function extractModelFamily(modelId: string, modelName: string): string {
  const lowerId = modelId.toLowerCase().replace(/:free$/, '').replace(/:nitro$/, '').replace(/:extended$/, '');
  const lowerName = modelName.toLowerCase();

  if (lowerId.includes('llama-3.3-70b') || lowerName.includes('llama 3.3 70b')) {
    return 'Llama 3.3 70B';
  }
  if (lowerId.includes('llama-3.1-405b') || lowerName.includes('llama 3.1 405b')) {
    return 'Llama 3.1 405B';
  }
  if (lowerId.includes('llama-3.1-70b') || lowerName.includes('llama 3.1 70b')) {
    return 'Llama 3.1 70B';
  }
  if (lowerId.includes('llama-3.1-8b') || lowerName.includes('llama 3.1 8b')) {
    return 'Llama 3.1 8B';
  }
  if (lowerId.includes('deepseek-r1') || lowerName.includes('deepseek r1')) {
    return 'DeepSeek R1';
  }
  if (lowerId.includes('deepseek-chat') || lowerId.includes('deepseek-v3') || lowerName.includes('deepseek v3')) {
    return 'DeepSeek V3';
  }
  if (lowerId.includes('qwen-2.5-72b') || lowerName.includes('qwen 2.5 72b')) {
    return 'Qwen 2.5 72B';
  }
  if (lowerId.includes('qwen-2.5-coder-32b') || lowerName.includes('qwen 2.5 coder 32b')) {
    return 'Qwen 2.5 Coder 32B';
  }
  if (lowerId.includes('mistral-large') || lowerName.includes('mistral large')) {
    return 'Mistral Large';
  }
  if (lowerId.includes('mistral-small') || lowerName.includes('mistral small')) {
    return 'Mistral Small';
  }
  if (lowerId.includes('gemini-2.0-flash') || lowerName.includes('gemini 2.0 flash')) {
    return 'Gemini 2.0 Flash';
  }
  if (lowerId.includes('gpt-4o-mini') || lowerName.includes('gpt-4o mini')) {
    return 'GPT-4o Mini';
  }
  if (lowerId.includes('gpt-4o') || lowerName.includes('gpt-4o')) {
    return 'GPT-4o';
  }
  if (lowerId.includes('claude-3-5-haiku') || lowerName.includes('claude 3.5 haiku')) {
    return 'Claude 3.5 Haiku';
  }
  if (lowerId.includes('claude-3-7-sonnet') || lowerName.includes('claude 3.7 sonnet')) {
    return 'Claude 3.7 Sonnet';
  }

  // Generic fallback: strip provider prefix and common tags
  const parts = modelId.split('/');
  return parts.length > 1 ? parts[1].split(':')[0] : modelId;
}

/**
 * Computes price arbitrage clusters across all current snapshots
 */
export function computeArbitrageOpportunities(snapshots: ModelSnapshot[]): ArbitrageCluster[] {
  const clustersMap = new Map<string, ModelSnapshot[]>();

  for (const s of snapshots) {
    const familyKey = extractModelFamily(s.model_id, s.name);
    const existing = clustersMap.get(familyKey) || [];
    existing.push(s);
    clustersMap.set(familyKey, existing);
  }

  const result: ArbitrageCluster[] = [];

  for (const [familyKey, models] of clustersMap.entries()) {
    // Only include clusters where multiple endpoints/options exist
    if (models.length < 2) continue;

    const options: ArbitrageProviderOption[] = models.map((m) => {
      const p1m = m.price_prompt !== null ? m.price_prompt * 1_000_000 : 0;
      const c1m = m.price_completion !== null ? m.price_completion * 1_000_000 : 0;
      return {
        model_id: m.model_id,
        provider: m.provider,
        price_prompt: m.price_prompt,
        price_completion: m.price_completion,
        context_length: m.context_length,
        is_free: m.is_free,
        prompt_per_1m: p1m,
        comp_per_1m: c1m,
      };
    });

    // Sort cheapest to most expensive (by total prompt + completion price)
    options.sort((a, b) => a.prompt_per_1m + a.comp_per_1m - (b.prompt_per_1m + b.comp_per_1m));

    const cheapest = options[0];
    const expensive = options[options.length - 1];

    // Compute savings
    const promptSpread = expensive.prompt_per_1m - cheapest.prompt_per_1m;
    const compSpread = expensive.comp_per_1m - cheapest.comp_per_1m;

    let maxPromptSavingsPct = 0;
    if (expensive.prompt_per_1m > 0) {
      maxPromptSavingsPct = Math.round(((expensive.prompt_per_1m - cheapest.prompt_per_1m) / expensive.prompt_per_1m) * 100);
    } else if (cheapest.prompt_per_1m === 0 && expensive.prompt_per_1m === 0) {
      maxPromptSavingsPct = 0;
    }

    let maxCompSavingsPct = 0;
    if (expensive.comp_per_1m > 0) {
      maxCompSavingsPct = Math.round(((expensive.comp_per_1m - cheapest.comp_per_1m) / expensive.comp_per_1m) * 100);
    }

    // Only surface meaningful price spread
    if (promptSpread > 0 || compSpread > 0 || cheapest.is_free !== expensive.is_free) {
      result.push({
        family_key: familyKey,
        display_name: familyKey,
        provider_count: options.length,
        cheapest_option: cheapest,
        expensive_option: expensive,
        max_prompt_savings_pct: maxPromptSavingsPct,
        max_comp_savings_pct: maxCompSavingsPct,
        prompt_spread_per_1m: promptSpread,
        comp_spread_per_1m: compSpread,
        all_options: options,
      });
    }
  }

  // Sort by highest prompt spread descending
  result.sort((a, b) => b.prompt_spread_per_1m + b.comp_spread_per_1m - (a.prompt_spread_per_1m + a.comp_spread_per_1m));

  return result;
}
