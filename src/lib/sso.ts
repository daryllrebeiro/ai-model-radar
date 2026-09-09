/**
 * Enterprise SSO (OIDC) configuration + SCIM helpers.
 *
 * SSO is env-gated and inert unless all three are set:
 *   SSO_OIDC_ISSUER      e.g. https://myorg.okta.com (or any OIDC issuer)
 *   SSO_OIDC_CLIENT_ID
 *   SSO_OIDC_CLIENT_SECRET
 * Optional:
 *   SSO_NAME             IdP display name (default "Single Sign-On")
 *   SSO_ALLOWED_DOMAINS  comma list, e.g. "acme.com,acme.dev" — IdP users
 *                        outside these domains are refused at sign-in.
 *
 * Any OIDC-conformant IdP works (Okta, Entra ID, Keycloak, Auth0) via
 * standard discovery (`<issuer>/.well-known/openid-configuration`).
 * SAML is intentionally out of scope: OIDC covers the same IdPs without
 * XML signature-handling risk. SCIM 2.0 provisioning lives under
 * /api/scim/v2 (token: SCIM_TOKEN).
 */

export interface SsoConfig {
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecret: string;
  name: string;
  allowedDomains: string[];
}

export function getSsoConfig(env: NodeJS.ProcessEnv = process.env): SsoConfig {
  const issuer = (env.SSO_OIDC_ISSUER || '').trim().replace(/\/+$/, '');
  const clientId = (env.SSO_OIDC_CLIENT_ID || '').trim();
  const clientSecret = (env.SSO_OIDC_CLIENT_SECRET || '').trim();
  const name = (env.SSO_NAME || '').trim() || 'Single Sign-On';
  const allowedDomains = (env.SSO_ALLOWED_DOMAINS || '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  if (!issuer || !clientId || !clientSecret) {
    return { enabled: false, issuer, clientId, clientSecret, name, allowedDomains };
  }
  return { enabled: true, issuer, clientId, clientSecret, name, allowedDomains };
}

/** Domain allowlist check. Empty allowlist = IdP authentication suffices. */
export function isSsoEmailAllowed(email: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true;
  const domain = email.trim().toLowerCase().split('@')[1] || '';
  return allowedDomains.includes(domain);
}

/**
 * Builds the NextAuth provider options for the configured IdP. Returns
 * null when SSO is not configured (caller keeps email-only auth).
 * Shape matches NextAuth's OAuth provider options; typed loosely to avoid
 * coupling this module to next-auth versions.
 */
export function buildSsoProviderOptions(config: SsoConfig): Record<string, unknown> | null {
  if (!config.enabled) return null;
  return {
    id: 'sso',
    name: config.name,
    type: 'oauth',
    wellKnown: `${config.issuer}/.well-known/openid-configuration`,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    authorization: { params: { scope: 'openid email profile' } },
    idToken: true,
    checks: ['pkce', 'state'],
    profile(profile: any) {
      return {
        id: String(profile.sub || profile.id || ''),
        email: (profile.email || '').toLowerCase(),
        name: profile.name || profile.preferred_username || null,
      };
    },
  };
}
