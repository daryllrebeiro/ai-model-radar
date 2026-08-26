/**
 * Global Feature Flags
 */

/**
 * Returns whether Stripe billing and new subscription checkouts are enabled.
 * Defaults to false if unset.
 */
export function isBillingEnabled(): boolean {
  return process.env.STRIPE_ENABLED === 'true';
}
