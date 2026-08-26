/**
 * Privacy-preserving analytics tracker.
 * Fully GDPR compliant, zero-cookie, and respects browser Do-Not-Track (DNT).
 */

export type AnalyticsAction =
  | 'page_view'
  | 'compare_add'
  | 'compare_remove'
  | 'compare_view'
  | 'watchlist_add'
  | 'watchlist_remove'
  | 'stack_view'
  | 'cli_command_invoked'
  | 'bot_command_invoked'
  | 'migration_view_alternatives'
  | 'badge_rendered';

export interface AnalyticsEvent {
  event: AnalyticsAction | string;
  properties?: Record<string, string | number | boolean>;
  timestamp?: string;
}

// Server-side aggregated event counter for baseline measurement
const serverEventCounters: Record<string, number> = {};

export function trackServerEvent(action: AnalyticsAction | string, properties?: Record<string, any>): void {
  const key = String(action);
  serverEventCounters[key] = (serverEventCounters[key] || 0) + 1;
}

export function getServerEventCounts(): Record<string, number> {
  return { ...serverEventCounters };
}

export function trackEvent(name: AnalyticsAction | string, properties?: Record<string, string | number | boolean>): boolean {
  if (typeof window !== 'undefined') {
    // Respect Do Not Track
    if (navigator.doNotTrack === '1') {
      return false;
    }

    // Support Plausible if installed
    if ((window as any).plausible) {
      (window as any).plausible(name, { props: properties });
      return true;
    }

    // Support PostHog if installed
    if ((window as any).posthog) {
      (window as any).posthog.capture(name, properties);
      return true;
    }
  }

  trackServerEvent(name, properties);

  // In non-production or test environments, log cleanly
  if (process.env.NODE_ENV !== 'production') {
    console.debug(`[Analytics] Event: ${name}`, properties);
    return true;
  }

  return true;
}
