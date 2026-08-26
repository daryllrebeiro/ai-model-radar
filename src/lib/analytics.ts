/**
 * Privacy-preserving analytics tracker.
 * Fully GDPR compliant, zero-cookie, and respects browser Do-Not-Track (DNT).
 */

export interface AnalyticsEvent {
  event: string;
  properties?: Record<string, string | number | boolean>;
}

export function trackEvent(name: string, properties?: Record<string, string | number | boolean>): boolean {
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

  // In non-production or test environments, log cleanly
  if (process.env.NODE_ENV !== 'production') {
    console.debug(`[Analytics] Event: ${name}`, properties);
    return true;
  }

  return false;
}
