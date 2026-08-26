import { ModelEvent } from '@/types/events';
import { AlertRuleConfig, GeneratedDigest } from '@/types/alerts';
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
};

/**
 * Filters market events according to user-configured alert criteria
 */
export function evaluateAlertRules(
  events: ModelEvent[],
  config: AlertRuleConfig,
  watchedModelIds: Set<string> = new Set()
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
