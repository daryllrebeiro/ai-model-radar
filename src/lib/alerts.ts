import { ModelEvent } from '@/types/events';
import { AlertRuleConfig, GeneratedDigest, AdvancedAlertResult, AlertScore } from '@/types/alerts';
import { extractProvider } from './utils';

export const DEFAULT_ALERT_CONFIG: AlertRuleConfig = {
  minPriceDropPct: 15,
  alertOnFreeTier: true,
  alertOnNewModels: true,
  alertOnContextExpansion: false,
  watchedProvidersOnly: false,
  selectedProviders: ['OpenAI', 'Anthropic', 'Google', 'DeepSeek', 'Meta'],
  digestFrequency: 'daily',
  notificationChannel: 'in_app',
  webhookUrl: '',
  mode: 'basic',
};

const FAMOUS_FAMILIES = [
  'claude',
  'gpt',
  'gemini',
  'llama',
  'deepseek',
  'mistral',
  'qwen',
  'command',
  'phi',
  'olmo',
];

function isFamousFamily(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return FAMOUS_FAMILIES.some((f) => lower.includes(f));
}

/**
 * Advanced (Pro) alert rule engine: applies compound criteria beyond the
 * basic boolean switches and returns a relevance score per matching event.
 */
export function evaluateAdvancedAlertRules(
  events: ModelEvent[],
  config: AlertRuleConfig,
  watchedModelIds: Set<string> = new Set()
): AdvancedAlertResult {
  const scored: AlertScore[] = [];

  for (const event of events) {
    const provider = event.provider || extractProvider(event.model_id);
    let score = 0;
    const reasons: string[] = [];
    let failed = false;

    // 1. Provider suppression
    if (config.suppressProviders?.length) {
      const suppressed = config.suppressProviders.some(
        (p) => p.toLowerCase() === provider.toLowerCase()
      );
      if (suppressed) {
        failed = true;
        reasons.push(`Suppressed provider: ${provider}`);
      }
    }

    // 2. model_id match (substring)
    if (!failed && config.matchModelId) {
      const needle = config.matchModelId.toLowerCase();
      if (!event.model_id.toLowerCase().includes(needle)) {
        failed = true;
      } else {
        score += 20;
        reasons.push(`Matches model filter "${config.matchModelId}"`);
      }
    }

    // 3. Context window constraints
    const ctx = event.context_length ?? event.new_value?.context_length;
    const hasContextConstraint = Boolean(config.minContextWindowTokens || config.maxContextWindowTokens);
    if (!failed && hasContextConstraint) {
      if (typeof ctx === 'number') {
        if (config.minContextWindowTokens && ctx < config.minContextWindowTokens) {
          failed = true;
        } else if (config.maxContextWindowTokens && ctx > config.maxContextWindowTokens) {
          failed = true;
        } else {
          score += 15;
          reasons.push(`Context ${ctx.toLocaleString()} tokens within range`);
        }
      } else {
        // No context data available — cannot satisfy a context filter
        failed = true;
      }
    }

    // 4. Famous families filter
    if (!failed && config.requireFamousFamilies) {
      if (isFamousFamily(event.model_id)) {
        score += 10;
        reasons.push('Recognized model family');
      } else {
        failed = true;
      }
    }

    // 5. Absolute USD drop threshold (price cuts)
    if (!failed && config.minAbsoluteDropUsd) {
      const oldPrompt = event.old_value?.prompt as number | undefined;
      const newPrompt = event.new_value?.prompt as number | undefined;
      if (typeof oldPrompt === 'number' && typeof newPrompt === 'number') {
        const dropUsd = (oldPrompt - newPrompt) * 1_000_000;
        if (dropUsd >= config.minAbsoluteDropUsd) {
          score += 25;
          reasons.push(`Absolute drop ≥ $${config.minAbsoluteDropUsd}/1M ($${dropUsd.toFixed(2)})`);
        } else {
          failed = true;
        }
      } else {
        // Cannot evaluate the absolute threshold without price-change data
        failed = true;
      }
    }

    // 6. Watched-model signal
    if (!failed && watchedModelIds.size > 0 && watchedModelIds.has(event.model_id)) {
      score += 30;
      reasons.push('On your watchlist');
    }

    if (!failed) {
      scored.push({ event, score, reasons, matchedAdvanced: score > 0 });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return { events: scored, total: scored.length };
}

/**
 * Filters market events according to user-configured alert criteria
 */
export function evaluateAlertRules(
  events: ModelEvent[],
  config: AlertRuleConfig
): GeneratedDigest {
  const priceDropEvents: ModelEvent[] = [];
  const freeTierEvents: ModelEvent[] = [];
  const newModelEvents: ModelEvent[] = [];
  const otherEvents: ModelEvent[] = [];

  for (const event of events) {
    const provider = event.provider || extractProvider(event.model_id);

    // Provider filter check
    if (config.watchedProvidersOnly && config.selectedProviders.length > 0) {
      const match = config.selectedProviders.some(
        (p) => p.toLowerCase() === provider.toLowerCase()
      );
      if (!match) continue;
    }

    // 1. Free Tier Transition
    if (event.event_type === 'BECAME_FREE') {
      if (config.alertOnFreeTier) {
        freeTierEvents.push(event);
      }
      continue;
    }

    // 2. Price Change (Check threshold)
    if (event.event_type === 'PRICE_CHANGE' && event.pct_change && event.pct_change < 0) {
      const absDrop = Math.abs(event.pct_change);
      if (absDrop >= config.minPriceDropPct) {
        priceDropEvents.push(event);
      }
      continue;
    }

    // 3. New Model
    if (event.event_type === 'NEW_MODEL') {
      if (config.alertOnNewModels) {
        newModelEvents.push(event);
      }
      continue;
    }

    // 4. Context Changed
    if (event.event_type === 'CONTEXT_CHANGED') {
      if (config.alertOnContextExpansion) {
        otherEvents.push(event);
      }
      continue;
    }
  }

  const totalMatchingEvents =
    priceDropEvents.length +
    freeTierEvents.length +
    newModelEvents.length +
    otherEvents.length;

  return {
    generatedAt: new Date().toISOString(),
    totalMatchingEvents,
    priceDropEvents,
    freeTierEvents,
    newModelEvents,
    otherEvents,
  };
}
