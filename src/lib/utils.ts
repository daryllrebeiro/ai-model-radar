import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatDistanceToNow, format } from 'date-fns';
import { EventType } from '@/types/events';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats a raw per-token price into USD per 1 Million tokens.
 * e.g. 0.000002 -> "$2.00 / 1M"
 */
export function formatPricePerMillion(pricePerToken: number | null | undefined): string {
  if (pricePerToken === null || pricePerToken === undefined) {
    return 'N/A';
  }
  if (pricePerToken === 0) {
    return '$0.00 (Free)';
  }

  const perMillion = pricePerToken * 1_000_000;
  if (perMillion < 0.01) {
    return `$${perMillion.toFixed(4)} / 1M`;
  }
  if (perMillion < 1) {
    return `$${perMillion.toFixed(3)} / 1M`;
  }
  return `$${perMillion.toFixed(2)} / 1M`;
}

/**
 * Formats context window lengths nicely (e.g. 128000 -> "128k", 1000000 -> "1M")
 */
export function formatContextLength(tokens: number | null | undefined): string {
  if (!tokens || tokens <= 0) return 'Unknown';
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    const thousands = tokens / 1_000;
    return `${thousands % 1 === 0 ? thousands.toFixed(0) : thousands.toFixed(1)}k`;
  }
  return tokens.toLocaleString();
}

/**
 * Returns human-readable relative time string
 */
export function formatRelativeTime(dateString: string | Date | null | undefined): string {
  if (!dateString) return 'Unknown';
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return 'Recently';
    return formatDistanceToNow(d, { addSuffix: true });
  } catch {
    return 'Recently';
  }
}

/**
 * Returns formatted absolute timestamp
 */
export function formatExactDate(dateString: string | Date | null | undefined): string {
  if (!dateString) return 'N/A';
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return 'N/A';
    return format(d, 'MMM d, yyyy HH:mm:ss');
  } catch {
    return 'N/A';
  }
}

/**
 * Generates clear, human-readable summary text for an event
 */
export function getEventSummary(event: {
  event_type: EventType;
  model_name?: string;
  model_id: string;
  pct_change: number | null;
  old_value?: Record<string, any> | null;
  new_value?: Record<string, any> | null;
}): { title: string; subtitle: string; isDrop: boolean } {
  const name = event.model_name || event.model_id;

  switch (event.event_type) {
    case 'NEW_MODEL':
      return {
        title: `New Model Release: ${name}`,
        subtitle: `Added to OpenRouter with context ${formatContextLength(event.new_value?.context_length)}`,
        isDrop: false,
      };

    case 'MODEL_REMOVED':
      return {
        title: `Model Delisted: ${name}`,
        subtitle: 'No longer available in the latest OpenRouter models catalog',
        isDrop: false,
      };

    case 'BECAME_FREE':
      return {
        title: `${name} is now 100% Free`,
        subtitle: `Prompt and completion prices dropped to $0.00`,
        isDrop: true,
      };

    case 'LEFT_FREE':
      return {
        title: `${name} Free Tier Ended`,
        subtitle: `Now priced at ${formatPricePerMillion(event.new_value?.price_prompt)} prompt / ${formatPricePerMillion(event.new_value?.price_completion)} completion`,
        isDrop: false,
      };

    case 'PRICE_CHANGE': {
      const pct = event.pct_change || 0;
      const isDrop = pct < 0;
      const pctFormatted = Math.abs(pct).toFixed(1);
      const oldPrompt = formatPricePerMillion(event.old_value?.price_prompt);
      const newPrompt = formatPricePerMillion(event.new_value?.price_prompt);
      const oldComp = formatPricePerMillion(event.old_value?.price_completion);
      const newComp = formatPricePerMillion(event.new_value?.price_completion);

      if (isDrop) {
        return {
          title: `${name} price dropped by ${pctFormatted}%`,
          subtitle: `Prompt: ${oldPrompt} → ${newPrompt} | Comp: ${oldComp} → ${newComp}`,
          isDrop: true,
        };
      } else {
        return {
          title: `${name} price increased by ${pctFormatted}%`,
          subtitle: `Prompt: ${oldPrompt} → ${newPrompt} | Comp: ${oldComp} → ${newComp}`,
          isDrop: false,
        };
      }
    }

    case 'CONTEXT_CHANGED': {
      const oldCtx = formatContextLength(event.old_value?.context_length);
      const newCtx = formatContextLength(event.new_value?.context_length);
      return {
        title: `${name} context window updated`,
        subtitle: `Context expanded/adjusted from ${oldCtx} to ${newCtx} tokens`,
        isDrop: false,
      };
    }

    default:
      return {
        title: `${name} updated`,
        subtitle: 'Model specifications updated',
        isDrop: false,
      };
  }
}

/**
 * Returns badge styling details for each event type
 */
export function getEventTypeBadgeConfig(eventType: EventType): {
  label: string;
  badgeClass: string;
  dotClass: string;
  glowClass: string;
} {
  switch (eventType) {
    case 'NEW_MODEL':
      return {
        label: 'New Release',
        badgeClass: 'bg-cyan-950/70 text-cyan-400 border-cyan-500/30',
        dotClass: 'bg-cyan-400',
        glowClass: 'shadow-cyan-500/20',
      };
    case 'PRICE_CHANGE':
      return {
        label: 'Price Change',
        badgeClass: 'bg-emerald-950/70 text-emerald-400 border-emerald-500/30',
        dotClass: 'bg-emerald-400',
        glowClass: 'shadow-emerald-500/20',
      };
    case 'BECAME_FREE':
      return {
        label: 'Became Free',
        badgeClass: 'bg-emerald-950/80 text-emerald-300 border-emerald-400/40 ring-1 ring-emerald-400/30',
        dotClass: 'bg-emerald-300 animate-pulse',
        glowClass: 'shadow-emerald-400/30',
      };
    case 'LEFT_FREE':
      return {
        label: 'Left Free',
        badgeClass: 'bg-rose-950/70 text-rose-400 border-rose-500/30',
        dotClass: 'bg-rose-400',
        glowClass: 'shadow-rose-500/20',
      };
    case 'CONTEXT_CHANGED':
      return {
        label: 'Context Changed',
        badgeClass: 'bg-amber-950/70 text-amber-400 border-amber-500/30',
        dotClass: 'bg-amber-400',
        glowClass: 'shadow-amber-500/20',
      };
    case 'MODEL_REMOVED':
      return {
        label: 'Delisted',
        badgeClass: 'bg-gray-800 text-gray-400 border-gray-700',
        dotClass: 'bg-gray-500',
        glowClass: 'shadow-gray-700/20',
      };
    default:
      return {
        label: eventType,
        badgeClass: 'bg-gray-800 text-gray-300 border-gray-700',
        dotClass: 'bg-gray-400',
        glowClass: '',
      };
  }
}

/**
 * Extracts clean provider name from model ID (e.g. "openai/gpt-4o" -> "OpenAI")
 */
export function extractProvider(modelId: string): string {
  if (!modelId) return 'Unknown';
  const parts = modelId.split('/');
  if (parts.length > 1) {
    const raw = parts[0];
    const mappings: Record<string, string> = {
      openai: 'OpenAI',
      anthropic: 'Anthropic',
      google: 'Google',
      meta: 'Meta',
      'meta-llama': 'Meta',
      mistralai: 'Mistral',
      deepseek: 'DeepSeek',
      qwen: 'Qwen / Alibaba',
      cohere: 'Cohere',
      microsoft: 'Microsoft',
      nousresearch: 'Nous Research',
      gryphe: 'Gryphe',
      perplexity: 'Perplexity',
      amazon: 'Amazon',
      nvidia: 'NVIDIA',
      xai: 'xAI',
      liquid: 'Liquid AI',
    };
    return mappings[raw.toLowerCase()] || raw.charAt(0).toUpperCase() + raw.slice(1);
  }
  return 'OpenRouter';
}
