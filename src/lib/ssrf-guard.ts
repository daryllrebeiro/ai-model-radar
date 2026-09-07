/**
 * SSRF guard for server-initiated outbound fetches (webhook dispatch,
 * endpoint probes). User-influenced URLs must never reach internal
 * infrastructure: cloud metadata endpoints, loopback, or RFC 1918/link-local
 * ranges. DNS-rebinding (record changes between check and fetch) is a
 * residual risk without an egress proxy — noted, not solved here.
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
]);

function ipv4Octets(host: string): number[] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  if (octets.some((o) => o > 255)) return null;
  return octets;
}

function expandIpv6(hextets: string[]): number[] | null {
  // Expands :: compression; returns 8 hextet values or null if malformed.
  const out: number[] = [];
  const gap = hextets.indexOf('');
  if (gap === -1) {
    if (hextets.length !== 8) return null;
    for (const h of hextets) {
      if (!/^[0-9a-f]{1,4}$/.test(h)) return null;
      out.push(parseInt(h, 16));
    }
    return out;
  }
  const head = hextets.slice(0, gap).filter((h) => h !== '');
  const tail = hextets.slice(gap + 1).filter((h) => h !== '');
  if (head.length + tail.length > 7) return null;
  const zeros = new Array(8 - head.length - tail.length).fill(0);
  for (const h of [...head, ...tail]) {
    if (!/^[0-9a-f]{1,4}$/.test(h)) return null;
  }
  return [...head.map((h) => parseInt(h, 16)), ...zeros, ...tail.map((h) => parseInt(h, 16))];
}

function isBlockedIp(host: string): boolean {
  const lower = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (lower === 'localhost' || lower === '::1' || lower === '::ffff:127.0.0.1') return true;
  // IPv6: expand fully, then map IPv4-mapped (::ffff:a.b.c.d) back into the
  // IPv4 checks so mapped private ranges can't slip past the v6 branch.
  if (lower.includes(':')) {
    // Dotted-quad mapped form ::ffff:10.0.0.1
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]);
    const parts = expandIpv6(lower.split(':'));
    if (!parts) return true; // malformed IP literal: fail closed
    // ::ffff:0:0/96 with hex tail, e.g. ::ffff:7f00:1
    if (parts[0] === 0 && parts[1] === 0 && parts[2] === 0 && parts[3] === 0 && parts[4] === 0 && parts[5] === 0xffff) {
      const a = (parts[6] >> 8) & 0xff, b = parts[6] & 0xff, c = (parts[7] >> 8) & 0xff, d = parts[7] & 0xff;
      return isBlockedIp(`${a}.${b}.${c}.${d}`);
    }
    if (parts.every((p) => p === 0)) return true; // ::
    if (parts[0] === 0 && parts.slice(1).every((p) => p === 0)) return true;
    // loopback ::1, unique-local fc00::/7, link-local fe80::/10
    const first = parts[0];
    if (parts.slice(0, 7).every((p) => p === 0) && parts[7] === 1) return true;
    if ((first & 0xfe00) === 0xfc00) return true;
    if ((first & 0xffc0) === 0xfe80) return true;
    return false;
  }
  const o = ipv4Octets(lower);
  if (!o) return false;
  const [a, b] = o;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // RFC 1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a === 169 && b === 254) return true; // link-local (cloud metadata)
  if (a === 0 || a >= 224) return true; // unspecified / multicast / reserved
  return false;
}

export class SsrfBlockedError extends Error {
  constructor(url: string) {
    super(`Blocked outbound request to non-public URL: ${url}`);
    this.name = 'SsrfBlockedError';
  }
}

const MAX_REDIRECT_HOPS = 3;

/**
 * Server-side fetch with per-hop SSRF re-validation. Follows up to 3
 * redirects, re-running assertPublicHttpUrl on every Location header, so a
 * benign initial URL cannot 302 into loopback/metadata/private ranges.
 * Non-redirect responses are returned as-is; over-limit chains throw.
 */
export async function fetchWithSsrfRedirects(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit = {},
  maxHops: number = MAX_REDIRECT_HOPS
): Promise<Response> {
  let current = assertPublicHttpUrl(url).toString();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const response = await fetchFn(current, { ...init, redirect: 'manual' });
    const location = response.headers?.get?.('location');
    if (
      maxHops > 0 &&
      location &&
      [301, 302, 303, 307, 308].includes(response.status)
    ) {
      current = assertPublicHttpUrl(new URL(location, current).toString()).toString();
      maxHops -= 1;
      continue;
    }
    if (location && [301, 302, 303, 307, 308].includes(response.status)) {
      throw new SsrfBlockedError(`redirect chain exceeded ${MAX_REDIRECT_HOPS} hops: ${url}`);
    }
    return response;
  }
}

/**
 * Validates that a URL is safe for server-side fetch: http(s) only, public
 * routable host, no credentials in URL. Throws SsrfBlockedError otherwise.
 */
export function assertPublicHttpUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(rawUrl);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SsrfBlockedError(rawUrl);
  }
  if (parsed.username || parsed.password) {
    throw new SsrfBlockedError(rawUrl);
  }
  const host = parsed.hostname.toLowerCase();
  if (!host || BLOCKED_HOSTNAMES.has(host) || isBlockedIp(host)) {
    throw new SsrfBlockedError(rawUrl);
  }
  return parsed;
}
