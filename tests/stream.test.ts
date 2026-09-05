import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createOrGetUser, createApiKey } from '../src/lib/db/queries';
import { generateApiKey } from '../src/lib/api-keys';
import { GET as streamRoute } from '../src/app/api/v1/stream/route';

afterEach(() => {
  delete process.env.FEATURE_ENFORCEMENT;
});

async function createAuthedUser(tier: string, tag: string) {
  const email = `stream_${tag}_${tier}_${Date.now()}@test.com`;
  const user = await createOrGetUser({ email, tier });
  const { plaintextKey, keyRecord } = generateApiKey(email, 'production');
  await createApiKey(keyRecord);
  return { email, key: plaintextKey };
}

async function readFirstChunks(res: Response, maxChunks = 3): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let acc = '';
  for (let i = 0; i < maxChunks; i++) {
    const { value, done } = await reader.read();
    if (done) break;
    acc += decoder.decode(value, { stream: true });
    if (acc.includes('event:')) break;
  }
  await reader.cancel();
  return acc;
}

describe('Phase 2.5: Real-time Stream (Enterprise, SSE)', () => {
  it('1. Stream requires authentication (401)', async () => {
    const req = new NextRequest('http://localhost:3000/api/v1/stream');
    const res = await streamRoute(req);
    expect(res.status).toBe(401);
  });

  it('2. Authenticated request returns text/event-stream', async () => {
    const { key } = await createAuthedUser('enterprise', 'ok');
    const req = new NextRequest('http://localhost:3000/api/v1/stream', {
      headers: { Authorization: `Bearer ${key}` },
    });
    const res = await streamRoute(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
  });

  it('3. Stream emits an initial snapshot chunk', async () => {
    const { key } = await createAuthedUser('enterprise', 'snap');
    const req = new NextRequest('http://localhost:3000/api/v1/stream', {
      headers: { Authorization: `Bearer ${key}` },
    });
    const res = await streamRoute(req);
    expect(res.status).toBe(200);

    const text = await readFirstChunks(res);
    expect(text).toContain('event: snapshot');
    expect(text).toContain('connectedAt');
    expect(text).toContain('modelCount');
  });

  it('4. Enforcement ON: free user blocked (403)', async () => {
    process.env.FEATURE_ENFORCEMENT = 'true';
    const { key } = await createAuthedUser('free', 'blocked');
    const req = new NextRequest('http://localhost:3000/api/v1/stream', {
      headers: { Authorization: `Bearer ${key}` },
    });
    const res = await streamRoute(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.requiredTier).toBe('enterprise');
  });

  it('5. Enforcement ON: enterprise user streams (200)', async () => {
    process.env.FEATURE_ENFORCEMENT = 'true';
    const { key } = await createAuthedUser('enterprise', 'ent');
    const req = new NextRequest('http://localhost:3000/api/v1/stream', {
      headers: { Authorization: `Bearer ${key}` },
    });
    const res = await streamRoute(req);
    expect(res.status).toBe(200);
    const text = await readFirstChunks(res);
    expect(text).toContain('event: snapshot');
  });
});