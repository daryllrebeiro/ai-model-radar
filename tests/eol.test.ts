import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { eolStatus, daysRemaining, buildEolReport } from '@/lib/eol';
import type { ModelEvent } from '@/types/events';
import {
  createOrGetUser,
  createApiKey,
  registerEol,
  getEolRegistry,
  deleteEol,
} from '@/lib/db/queries';
import { generateApiKey } from '@/lib/api-keys';
import {
  GET as eolRoute,
  POST as registerRoute,
  DELETE as deleteRoute,
} from '@/app/api/v1/governance/eol/route';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 5, 1);

function removal(modelId: string, atMs: number): ModelEvent {
  return {
    model_id: modelId,
    event_type: 'MODEL_REMOVED',
    old_value: null,
    new_value: null,
    pct_change: null,
    source: 'eol-seed',
    detected_at: new Date(atMs).toISOString(),
  };
}

describe('eolStatus', () => {
  it('classifies active / approaching / expired around the 90-day line', () => {
    expect(eolStatus(NOW + 200 * DAY_MS, NOW)).toBe('active');
    expect(eolStatus(NOW + 90 * DAY_MS, NOW)).toBe('approaching');
    expect(eolStatus(NOW + DAY_MS, NOW)).toBe('approaching');
    expect(eolStatus(NOW, NOW)).toBe('expired');
    expect(eolStatus(NOW - DAY_MS, NOW)).toBe('expired');
  });

  it('rounds remaining days up', () => {
    expect(daysRemaining(NOW + 12 * 3_600_000, NOW)).toBe(1);
    expect(daysRemaining(NOW - DAY_MS, NOW)).toBe(-1);
  });
});

describe('buildEolReport', () => {
  it('merges registry with unregistered removals, expired first', () => {
    const entries = buildEolReport(
      [
        { model_id: 'acme/old', eol_at: new Date(NOW - DAY_MS).toISOString() },
        { model_id: 'acme/soon', eol_at: new Date(NOW + 10 * DAY_MS).toISOString() },
        { model_id: 'acme/later', eol_at: new Date(NOW + 200 * DAY_MS).toISOString() },
      ],
      [removal('ghost/gone', NOW - 5 * DAY_MS)],
      new Date(NOW)
    );
    expect(entries.map((e) => e.model_id)).toEqual([
      'acme/old',
      'ghost/gone',
      'acme/soon',
      'acme/later',
    ]);
    expect(entries[0].status).toBe('expired');
    expect(entries[1].status).toBe('removed');
    expect(entries[2].status).toBe('approaching');
    expect(entries[2].days_remaining).toBe(10);
  });

  it('attaches observed removal to registered rows case-insensitively', () => {
    const entries = buildEolReport(
      [{ model_id: 'Acme/Old', eol_at: new Date(NOW + 200 * DAY_MS).toISOString() }],
      [removal('acme/old', NOW - DAY_MS)],
      new Date(NOW)
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].observed_removed_at).toBe(new Date(NOW - DAY_MS).toISOString());
  });
});

describe('EOL registry + routes', () => {
  async function keyFor(email: string): Promise<string> {
    await createOrGetUser({ email });
    const { plaintextKey, keyRecord } = generateApiKey(email, 'production');
    await createApiKey(keyRecord);
    return plaintextKey;
  }

  it('registers, validates, lists, and deletes', async () => {
    const stamp = Date.now();
    const email = `eol.${stamp}@test.dev`;
    const key = await keyFor(email);
    const model = `eol-model/${stamp}`;
    const authed = (url: string, init?: { method?: string; body?: string }) =>
      new NextRequest(url, {
        method: init?.method,
        body: init?.body,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      });

    const badDate = await registerRoute(
      authed('http://localhost/api/v1/governance/eol', {
        method: 'POST',
        body: JSON.stringify({ model_id: model, eol_at: 'not-a-date' }),
      })
    );
    expect(badDate.status).toBe(400);

    const inverted = await registerRoute(
      authed('http://localhost/api/v1/governance/eol', {
        method: 'POST',
        body: JSON.stringify({
          model_id: model,
          eol_at: new Date(Date.now() + DAY_MS).toISOString(),
          announced_at: new Date(Date.now() + 2 * DAY_MS).toISOString(),
        }),
      })
    );
    expect(inverted.status).toBe(400);

    const created = await registerRoute(
      authed('http://localhost/api/v1/governance/eol', {
        method: 'POST',
        body: JSON.stringify({
          model_id: model,
          eol_at: new Date(Date.now() + 30 * DAY_MS).toISOString(),
          source: 'vendor blog',
        }),
      })
    );
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.entry.model_id).toBe(model);
    expect(createdBody.catalog_match).toBe(false);

    // Re-announcement upserts the same row.
    const reannounced = await registerRoute(
      authed('http://localhost/api/v1/governance/eol', {
        method: 'POST',
        body: JSON.stringify({
          model_id: model,
          eol_at: new Date(Date.now() + 60 * DAY_MS).toISOString(),
        }),
      })
    );
    expect(reannounced.status).toBe(201);

    const listed = await eolRoute(authed('http://localhost/api/v1/governance/eol'));
    expect(listed.status).toBe(200);
    const body = await listed.json();
    const row = body.entries.find((e: any) => e.model_id === model);
    expect(row?.status).toBe('approaching');
    expect(body.counts.approaching).toBeGreaterThanOrEqual(1);

    const registry = await getEolRegistry();
    expect(registry.some((r) => r.model_id === model)).toBe(true);

    const deleted = await deleteRoute(
      authed('http://localhost/api/v1/governance/eol', {
        method: 'DELETE',
        body: JSON.stringify({ model_id: model }),
      })
    );
    expect(deleted.status).toBe(200);

    const missing = await deleteRoute(
      authed('http://localhost/api/v1/governance/eol', {
        method: 'DELETE',
        body: JSON.stringify({ model_id: model }),
      })
    );
    expect(missing.status).toBe(404);
  });

  it('registerEol rejects empty ids and inverted dates at the data layer', async () => {
    await expect(registerEol({ model_id: '  ', eol_at: new Date().toISOString() })).rejects.toThrow();
    await expect(
      registerEol({ model_id: 'x/y', eol_at: new Date(NOW).toISOString(), announced_at: new Date(NOW + DAY_MS).toISOString() })
    ).rejects.toThrow();
    expect(await deleteEol('  ')).toBe(false);
  });
});
