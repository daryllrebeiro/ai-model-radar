/**
 * Tier-Based Feature Flag System
 *
 * Every feature in the app is gated by a minimum access tier.
 * Free tier users get the core product. Pro/Enterprise unlock power-user features.
 * Payment enforcement comes later — for now, all tiers are accessible.
 */

export type AccessTier = 'free' | 'pro' | 'enterprise';

export interface FeatureFlag {
  key: string;
  minTier: AccessTier;
  label: string;
}

export const TIER_ORDER: AccessTier[] = ['free', 'pro', 'enterprise'];

export const FEATURES = {
  // ─── FREE TIER ───────────────────────────────────────────────
  DASHBOARD:              { key: 'dashboard',              minTier: 'free',       label: 'Dashboard' },
  EVENT_FEED:             { key: 'event_feed',             minTier: 'free',       label: 'Event Feed' },
  MODEL_LISTING:          { key: 'model_listing',          minTier: 'free',       label: 'Model Listing' },
  MODEL_DETAIL:           { key: 'model_detail',           minTier: 'free',       label: 'Model Detail' },
  PRICE_COMPARISON:       { key: 'price_comparison',       minTier: 'free',       label: 'Price Comparison' },
  DEALS_AND_FREE:         { key: 'deals_and_free',         minTier: 'free',       label: 'Deals & Free Models' },
  BENCHMARK_MATRIX:       { key: 'benchmark_matrix',       minTier: 'free',       label: 'Benchmark Matrix' },
  RSS_FEED:               { key: 'rss_feed',               minTier: 'free',       label: 'RSS Feed' },
  JSON_FEED:              { key: 'json_feed',              minTier: 'free',       label: 'JSON Feed' },
  SVG_BADGES:             { key: 'svg_badges',             minTier: 'free',       label: 'SVG Badges' },
  PUBLIC_API_READ:        { key: 'public_api_read',        minTier: 'free',       label: 'Public API' },
  MIGRATION_ADVISOR:      { key: 'migration_advisor',      minTier: 'free',       label: 'Migration Advisor' },
  LABS_ACTIVITY:          { key: 'labs_activity',          minTier: 'free',       label: 'Lab Activity' },
  COMMUNITY_RADAR:        { key: 'community_radar',        minTier: 'free',       label: 'Community Radar' },
  CHANGELOG:              { key: 'changelog',              minTier: 'free',       label: 'Changelog' },
  WATCHLISTS:             { key: 'watchlists',             minTier: 'free',       label: 'Watchlists' },
  BASIC_ALERTS:           { key: 'basic_alerts',           minTier: 'free',       label: 'Basic Alerts' },

  // ─── PRO TIER ($29/mo) ──────────────────────────────────────
  PRICE_ALERTS_WEBHOOK:   { key: 'price_alerts_webhook',   minTier: 'pro',        label: 'Webhook Alerts' },
  PRICE_ALERTS_EMAIL:     { key: 'price_alerts_email',     minTier: 'pro',        label: 'Email Digests' },
  ADVANCED_ALERT_RULES:   { key: 'advanced_alert_rules',   minTier: 'pro',        label: 'Advanced Alert Rules' },
  PRICE_HISTORY_CHARTS:   { key: 'price_history_charts',   minTier: 'pro',        label: 'Price History Charts' },
  COST_OPTIMIZER:         { key: 'cost_optimizer',         minTier: 'pro',        label: 'Cost Optimizer' },
  ARBITRAGE_ANALYTICS:    { key: 'arbitrage_analytics',    minTier: 'pro',        label: 'Arbitrage Analytics' },
  MARKET_SIGNALS:         { key: 'market_signals',         minTier: 'pro',        label: 'Market Signals' },
  API_KEY_MANAGEMENT:     { key: 'api_key_management',     minTier: 'pro',        label: 'API Key Dashboard' },
  ADVANCED_SEARCH:        { key: 'advanced_search',        minTier: 'pro',        label: 'Advanced Search' },
  DATA_EXPORT:            { key: 'data_export',            minTier: 'pro',        label: 'Data Export' },
  UNLIMITED_WATCHLISTS:   { key: 'unlimited_watchlists',   minTier: 'pro',        label: 'Unlimited Watchlists' },
  CUSTOM_BRAND_BADGES:    { key: 'custom_brand_badges',    minTier: 'pro',        label: 'Custom Badge Branding' },

  // ─── ENTERPRISE TIER ($199/mo) ──────────────────────────────
  REALTIME_STREAM:        { key: 'realtime_stream',        minTier: 'enterprise', label: 'Real-time Stream' },
  CUSTOM_WEBHOOKS:        { key: 'custom_webhooks',        minTier: 'enterprise', label: 'Custom Webhooks' },
  PRIORITY_SUPPORT:       { key: 'priority_support',       minTier: 'enterprise', label: 'Priority Support' },
  SLA_MONITORING:         { key: 'sla_monitoring',         minTier: 'enterprise', label: 'SLA Monitoring' },
  BULK_API_ACCESS:        { key: 'bulk_api_access',        minTier: 'enterprise', label: 'Bulk API Access' },
  TEAM_MANAGEMENT:        { key: 'team_management',        minTier: 'enterprise', label: 'Team Workspaces' },
  WHITE_LABEL_BADGES:     { key: 'white_label_badges',     minTier: 'enterprise', label: 'White-label Badges' },
} as const;

export type FeatureKey = keyof typeof FEATURES;

/**
 * Check if a user's tier grants access to a feature.
 */
export function hasAccess(userTier: AccessTier | string, feature: FeatureKey): boolean {
  const flag = FEATURES[feature];
  if (!flag) return false;

  const requiredIndex = TIER_ORDER.indexOf(flag.minTier);
  const userIndex = TIER_ORDER.indexOf(userTier as AccessTier);
  if (userIndex === -1) return false;
  return userIndex >= requiredIndex;
}

/**
 * Returns whether Stripe billing and paid subscription checkouts are enabled.
 * Defaults to false if unset.
 */
export function isBillingEnabled(): boolean {
  return process.env.STRIPE_ENABLED === 'true';
}

/**
 * Get all features available for a given tier (inclusive of lower tiers).
 */
export function getFeaturesForTier(tier: AccessTier): FeatureFlag[] {
  const tierIndex = TIER_ORDER.indexOf(tier);
  return Object.values(FEATURES).filter(
    (f) => TIER_ORDER.indexOf(f.minTier) <= tierIndex
  );
}

/**
 * Get features locked behind a higher tier (not accessible to user).
 */
export function getLockedFeatures(tier: AccessTier): FeatureFlag[] {
  const tierIndex = TIER_ORDER.indexOf(tier);
  return Object.values(FEATURES).filter(
    (f) => TIER_ORDER.indexOf(f.minTier) > tierIndex
  );
}
