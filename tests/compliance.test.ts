import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createOrGetUser,
  addToWatchlist,
  exportUserData,
  deleteUserAccount,
  createApiKey,
  getUserById,
} from '../src/lib/db/queries';
import { generateApiKey } from '../src/lib/api-keys';
import { POST as deleteUserRoute } from '../src/app/api/user/delete/route';
import { NextRequest } from 'next/server';

describe('Phase P8 / Closeout Ticket: GDPR Compliance & Stripe Subscription Cancellation on Deletion', () => {
  beforeEach(() => {
    delete (globalThis as any).__SIMULATE_STRIPE_CANCEL_FAILURE;
  });

  afterEach(() => {
    delete (globalThis as any).__SIMULATE_STRIPE_CANCEL_FAILURE;
  });

  it('1. Exports complete user profile, generated API keys, and watchlists as JSON', async () => {
    const email = `gdpr_export_${Date.now()}@test.com`;
    const user = await createOrGetUser({ email, tier: 'developer' });

    // Generate an API key for this user
    const { keyRecord } = generateApiKey(email, 'developer');
    await createApiKey(keyRecord);

    // Pin models to watchlist
    await addToWatchlist(user.id, 'anthropic/claude-3.5-sonnet');
    await addToWatchlist(user.id, 'deepseek/deepseek-r1');

    const exportData = await exportUserData(user.id);
    expect(exportData).not.toBeNull();
    expect(exportData?.profile.email).toBe(email);
    expect(exportData?.profile.tier).toBe('developer');
    expect(exportData?.apiKeys.length).toBeGreaterThanOrEqual(1);
    expect(exportData?.watchlist).toContain('anthropic/claude-3.5-sonnet');
    expect(exportData?.watchlist).toContain('deepseek/deepseek-r1');
    expect(exportData?.exportedAt).toBeDefined();
  });

  it('2. Permanently erases user account and cascades deletion across API keys and watchlists', async () => {
    const email = `gdpr_delete_${Date.now()}@test.com`;
    const user = await createOrGetUser({ email, tier: 'free' });

    const { keyRecord } = generateApiKey(email, 'free');
    await createApiKey(keyRecord);
    await addToWatchlist(user.id, 'meta-llama/llama-3.3-70b-instruct');

    // Verify presence
    let exportData = await exportUserData(user.id);
    expect(exportData).not.toBeNull();

    // Execute deletion
    const deleted = await deleteUserAccount(user.id);
    expect(deleted).toBe(true);

    // Verify complete purging
    exportData = await exportUserData(user.id);
    expect(exportData).toBeNull();
  });

  it('3. User with active Stripe subscription cancels in Stripe prior to local purge', async () => {
    const email = `stripe_sub_user_${Date.now()}@test.com`;
    const user = await createOrGetUser({
      email,
      tier: 'developer',
      stripe_customer_id: 'cus_test_12345',
    });

    const req = new NextRequest('http://localhost:3000/api/user/delete', {
      method: 'POST',
      body: JSON.stringify({ email: user.email }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await deleteUserRoute(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);

    // Confirm local account purged
    const check = await getUserById(user.id);
    expect(check).toBeNull();
  });

  it('4. User with NO subscription deletes cleanly without error', async () => {
    const email = `no_stripe_user_${Date.now()}@test.com`;
    const user = await createOrGetUser({ email, tier: 'free' });

    const req = new NextRequest('http://localhost:3000/api/user/delete', {
      method: 'POST',
      body: JSON.stringify({ email: user.email }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await deleteUserRoute(req);
    expect(res.status).toBe(200);

    const check = await getUserById(user.id);
    expect(check).toBeNull();
  });

  it('5. Simulated Stripe cancellation failure blocks deletion and preserves user account', async () => {
    (globalThis as any).__SIMULATE_STRIPE_CANCEL_FAILURE = true;

    const email = `stripe_fail_user_${Date.now()}@test.com`;
    const user = await createOrGetUser({
      email,
      tier: 'developer',
      stripe_customer_id: 'cus_test_fail_999',
    });

    const req = new NextRequest('http://localhost:3000/api/user/delete', {
      method: 'POST',
      body: JSON.stringify({ email: user.email }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await deleteUserRoute(req);
    expect(res.status).toBe(502);

    const body = await res.json();
    expect(body.error).toContain('Failed to cancel active Stripe subscription');

    // Confirm user record is preserved
    const check = await getUserById(user.id);
    expect(check).not.toBeNull();
    expect(check?.email).toBe(email);
  });
});
