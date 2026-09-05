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
  // ── Advanced Alert Rules (Pro, ADVANCED_ALERT_RULES) ──────────
  mode?: 'basic' | 'advanced';
  minAbsoluteDropUsd?: number; // require prompt $/1M drop >= N
  maxContextWindowTokens?: number; // only models with context <= N
  minContextWindowTokens?: number; // only models with context >= N
  requireFamousFamilies?: boolean; // only well-known model families
  suppressProviders?: string[]; // never alert on these providers
  matchModelId?: string; // optional exact/partial model_id match
}

export interface AlertScore {
  event: ModelEvent;
  score: number;
  reasons: string[];
  matchedAdvanced: boolean;
}

export interface AdvancedAlertResult {
  events: AlertScore[];
  total: number;
}

export interface GeneratedDigest {
  generatedAt: string;
  totalMatchingEvents: number;
  priceDropEvents: ModelEvent[];
  freeTierEvents: ModelEvent[];
  newModelEvents: ModelEvent[];
  otherEvents: ModelEvent[];
}
