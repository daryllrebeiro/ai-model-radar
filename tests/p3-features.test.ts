import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { detectSpendAnomalies } from '../src/lib/anomaly';
import { createInviteToken, verifyInviteToken } from '../src/lib/team-invites';
import { meterUsage } from '../src/lib/metering';
import {
  isSourceAvailable,
  recordSourceSuccess,
  recordSourceFailure,
  breakerState,
  resetSourceBreakers,
} from '../src/lib/ingestion/circuit';
import { GET as quotasRoute } from '../src/app/api/v1/quotas/route';
import { POST as inviteRoute } from '../src/app/api/teams/[teamId]/invites/route';
import { POST as joinRoute } from '../src/app/api/teams/join/route';
import { GET as signalsRoute } from '../src/app/api/v1/signals/route';
import {
  createOrGetUser,
  createApiKey,
  createTeam,
} from '../src/lib/db/queries';
import { generateApiKey } from '../src/lib/api-keys';
import { uniqueEmail } from './helpers';
import type { ModelEvent } from '../src/types/events';

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
  resetSourceBreakers();
});

function evt(partial: Partial<ModelEvent>, id: number): ModelEvent {
  return {
    id,
    model_id: 'a/m',
    event_type: 'PRICE_CHANGE',
    old_value: null,
    new_value: null,
    pct_change: -5,
    source: 't',
    detected_at: new Date().toISOString(),
    provider: 'Acme',
    ...partial,
  } as unknown as ModelEvent;
}

describe('P3 anomaly alerts (evidence, no confidence scores)', () => {
  it('detects churn, deep cuts, and provider free-flurries with cited events', () => {
    const now = Date.now();
    const iso = (minsAgo: number) => new Date(now - minsAgo * 60000).toISOString();
    const events = [
      evt({ pct_change: -6, detected_at: iso(60) }, 1),
      evt({ pct_change: -7, detected_at: iso(120) }, 2),
      evt({ pct_change: -8, detected_at: iso(180) }, 3),
      evt({ model_id: 'b/n', pct_change: -60, detected_at: iso(30) }, 4),
      evt({ model_id: 'c/o', event_type: 'BECAME_FREE', pct_change: null, detected_at: iso(10) }, 5),
      evt({ model_id: 'c/p', event_type: 'BECAME_FREE', pct_change: null, detected_at: iso(20) }, 6),
    ];
    const out = detectSpendAnomalies(events, { nowMs: now });
    expect(out.some((a) => a.kind === 'price_churn' && a.model_id === 'a/m')).toBe(true);
    expect(out.some((a) => a.kind === 'deep_cut' && a.model_id === 'b/n')).toBe(true);
    expect(out.some((a) => a.kind === 'free_flurry' && a.provider === 'Acme')).toBe(true);
    for (const a of out) {
      expect(a.event_ids.length).toBeGreaterThan(0);
      expect((a as any).confidence).toBeUndefined();
      expect((a as any).score).toBeUndefined();
    }
  });

  it('quiet streams produce nothing', () => {
    expect(detectSpendAnomalies([evt({ pct_change: -2 }, 1)])).toHaveLength(0);
    expect(detectSpendAnomalies([])).toHaveLength(0);
  });
});

describe('P3 team invites (HMAC tokens, no new table)', () => {
  const ENV = { TEAM_INVITE_SECRET: 'p3-test-invite-secret' } as any;

  it('mint → verify round-trips; tampering/expiry/transfer fail', () => {
    const token = createInviteToken({ teamId: 9, email: 'New@x.dev' }, ENV, 1000);
    const verified = verifyInviteToken(token, ENV, 2000)!;
    expect(verified).toMatchObject({
      teamId: 9, email: 'new@x.dev', role: 'member', exp: 1000 + 7 * 24 * 3600 * 1000,
    });
    expect(verified.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(verifyInviteToken(token + 'x', ENV, 2000)).toBeNull();
    expect(verifyInviteToken(token, ENV, 1000 + 7 * 24 * 3600 * 1000 + 1)).toBeNull();
    expect(verifyInviteToken(token, { TEAM_INVITE_SECRET: 'other' } as any, 2000)).toBeNull();
    expect(verifyInviteToken('garbage', ENV, 2000)).toBeNull();
  });

  it('join binds the token to the session email; invites need admin', async () => {
    process.env.TEAM_INVITE_SECRET = 'p3-route-secret';
    const owner = uniqueEmail('p3.owner');
    const member = uniqueEmail('p3.member');
    const stranger = uniqueEmail('p3.stranger');
    await createOrGetUser({ email: owner });
    await createOrGetUser({ email: member });
    const ownerPair = generateApiKey(owner, 'production');
    await createApiKey(ownerPair.keyRecord);
    const team = await createTeam(`p3 team ${Date.now()}`, owner);
    const teamId = (team as any).id;
    const auth = (email: string, key: string, url: string, body: unknown) =>
      new NextRequest(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });

    const strangerPair = generateApiKey(stranger, 'free');
    await createApiKey(strangerPair.keyRecord);
    // Non-admin cannot mint.
    const denied = await inviteRoute(
      auth(stranger, strangerPair.plaintextKey, `http://localhost/api/teams/${teamId}/invites`, { email: member }),
      { params: { teamId: String(teamId) } }
    );
    expect([401, 403]).toContain(denied.status);

    // Admin mints; wrong session email cannot redeem.
    const minted = await inviteRoute(
      auth(owner, ownerPair.plaintextKey, `http://localhost/api/teams/${teamId}/invites`, { email: member }),
      { params: { teamId: String(teamId) } }
    );
    expect(minted.status).toBe(201);
    const { invite_token } = await minted.json();

    const wrongEmail = await joinRoute(
      auth(stranger, strangerPair.plaintextKey, 'http://localhost/api/teams/join', { token: invite_token })
    );
    expect(wrongEmail.status).toBe(403);

    const memberPair = generateApiKey(member, 'free');
    await createApiKey(memberPair.keyRecord);
    const joined = await joinRoute(
      auth(member, memberPair.plaintextKey, 'http://localhost/api/teams/join', { token: invite_token })
    );
    expect(joined.status).toBe(201);

    // REPLAY: the same token is now consumed — second redemption fails.
    const replay = await joinRoute(
      auth(member, memberPair.plaintextKey, 'http://localhost/api/teams/join', { token: invite_token })
    );
    expect(replay.status).toBe(400);
  });

  it('audit: expired ledger rows reject; non-owner cannot mint admin; tampered role fails', async () => {
    process.env.TEAM_INVITE_SECRET = 'p3-route-secret';
    const owner = uniqueEmail('p3a.owner');
    const member = uniqueEmail('p3a.member');
    await createOrGetUser({ email: owner });
    await createOrGetUser({ email: member });
    const ownerPair = generateApiKey(owner, 'production');
    await createApiKey(ownerPair.keyRecord);
    const memberPair = generateApiKey(member, 'production');
    await createApiKey(memberPair.keyRecord);
    const team = await createTeam(`p3a team ${Date.now()}`, owner);
    const teamId = (team as any).id;
    const auth = (key: string, url: string, body: unknown) =>
      new NextRequest(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });

    // Member (non-owner) minting an admin invite → 403.
    const { addTeamMember } = await import('../src/lib/db/queries');
    await addTeamMember(teamId, member, 'admin');
    const esc = await inviteRoute(
      auth(memberPair.plaintextKey, `http://localhost/api/teams/${teamId}/invites`, { email: uniqueEmail('p3a.victim'), role: 'admin' }),
      { params: { teamId: String(teamId) } }
    );
    expect(esc.status).toBe(403);

    // Expired ledger row: mint with negative TTL, ledger it as expired, join → 400.
    const { createInviteToken } = await import('../src/lib/team-invites');
    const { createTeamInvite, hashInviteToken } = await import('../src/lib/db/team-invites');
    const stale = createInviteToken({ teamId, email: member, role: 'member', ttlMs: -1000 });
    await createTeamInvite({
      teamId, email: member, role: 'member', tokenHash: hashInviteToken(stale),
      createdByEmail: owner, expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const expired = await joinRoute(
      auth(memberPair.plaintextKey, 'http://localhost/api/teams/join', { token: stale })
    );
    expect(expired.status).toBe(400);

    // Tampered role (member→admin) breaks the signature → 400, never privesc.
    const minted = await inviteRoute(
      auth(ownerPair.plaintextKey, `http://localhost/api/teams/${teamId}/invites`, { email: member }),
      { params: { teamId: String(teamId) } }
    );
    const { invite_token } = await minted.json();
    const [payloadB64] = String(invite_token).split('.');
    const payload = JSON.parse(Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    payload.role = 'admin';
    const forged = `${Buffer.from(JSON.stringify(payload)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.${String(invite_token).split('.')[1]}`;
    const forgedRes = await joinRoute(
      auth(memberPair.plaintextKey, 'http://localhost/api/teams/join', { token: forged })
    );
    expect(forgedRes.status).toBe(400);
  });
});

describe('P3 quotas + metering (offline math)', () => {
  it('quotas reflect the caller key tier with honest hourly math', async () => {
    const email = uniqueEmail('p3.quota');
    await createOrGetUser({ email });
    const pair = generateApiKey(email, 'developer');
    await createApiKey(pair.keyRecord);
    const res = await quotasRoute(
      new NextRequest('http://localhost/api/v1/quotas', {
        headers: { Authorization: `Bearer ${pair.plaintextKey}`, 'x-forwarded-for': `10.90.${Math.floor(Math.random() * 200) + 1}.5` },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key_tier).toBe('developer');
    expect(body.access_tier).toBe('pro');
    expect(body.quota.requests_per_window).toBe(300);
    expect(body.quota.max_requests_per_hour).toBe(300 * 60);
    expect(body.features).toContain('public_api_read');
  });

  it('metering rolls attempts + deliveries into billable units', () => {
    const m = meterUsage({
      window: '2026-09',
      attempts: [
        { policy: 'cheapest', success: true, latency_ms: 100 },
        { policy: 'cheapest', success: true, latency_ms: 120 },
        { policy: 'benchmark', success: false, latency_ms: null },
      ],
      digestDeliveries: 20,
    });
    expect(m.proxied_calls).toBe(3);
    expect(m.successful_proxied_calls).toBe(2);
    expect(m.by_policy).toEqual({ cheapest: 2, benchmark: 1 });
    expect(m.billable_units).toBe(3 + 2);
  });
});

describe('P3 source breaker (consensus prerequisite)', () => {
  it('opens after 3 consecutive failures, half-opens after cooldown', () => {
    expect(isSourceAvailable('s1')).toBe(true);
    expect(recordSourceFailure('s1', 'e1')).toBe('closed');
    expect(recordSourceFailure('s1', 'e2')).toBe('closed');
    expect(recordSourceFailure('s1', 'e3')).toBe('open');
    expect(isSourceAvailable('s1')).toBe(false);
    expect(breakerState('s1', Date.now() + 6 * 60 * 1000)).toBe('half-open');
    expect(isSourceAvailable('s1', Date.now() + 6 * 60 * 1000)).toBe(true);
    recordSourceSuccess('s1');
    expect(breakerState('s1')).toBe('closed');
  });
});

describe('P3 signals route carries anomalies separately', () => {
  it('response has anomalies array alongside unchanged signals', async () => {
    const email = uniqueEmail('p3.sig');
    await createOrGetUser({ email });
    const pair = generateApiKey(email, 'production');
    await createApiKey(pair.keyRecord);
    const res = await signalsRoute(
      new NextRequest('http://localhost/api/v1/signals?limit=5', {
        headers: { Authorization: `Bearer ${pair.plaintextKey}`, 'x-forwarded-for': `10.91.${Math.floor(Math.random() * 200) + 1}.5` },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.signals)).toBe(true);
    expect(Array.isArray(body.anomalies)).toBe(true);
    expect(typeof body.summary.anomalies).toBe('number');
  });
});
