import { ModelEvent } from './events';

export interface AlertRuleConfig {
  minPriceDropPct: number; // e.g. 20 (alert if drop >= 20%)
  alertOnFreeTier: boolean; // alert if BECAME_FREE
  alertOnNewModels: boolean; // alert on NEW_MODEL
  alertOnContextExpansion: boolean; // alert on CONTEXT_CHANGED
  watchedProvidersOnly: boolean; // restrict to selected providers
  selectedProviders: string[]; // ['Anthropic', 'OpenAI', 'DeepSeek']
  digestFrequency: 'instant' | 'daily' | 'weekly';
  notificationChannel: 'in_app' | 'email' | 'webhook';
  webhookUrl?: string;
}

export interface GeneratedDigest {
  generatedAt: string;
  totalMatchingEvents: number;
  priceDropEvents: ModelEvent[];
  freeTierEvents: ModelEvent[];
  newModelEvents: ModelEvent[];
  otherEvents: ModelEvent[];
}
