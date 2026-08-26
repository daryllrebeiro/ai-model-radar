import { describe, it, expect } from 'vitest';
import {
  createOrGetUser,
  getUserWatchlist,
  addToWatchlist,
  removeFromWatchlist,
} from '../src/lib/db/queries';

describe('Phase P7: Server-Side User Watchlists', () => {
  it('1. Manages user watchlist items with add and remove operations', async () => {
    const user = await createOrGetUser({ email: `watcher_${Date.now()}@example.com` });

    // Initial watchlist empty
    let list = await getUserWatchlist(user.id);
    expect(list).toEqual([]);

    // Add model
    await addToWatchlist(user.id, 'deepseek/deepseek-r1');
    await addToWatchlist(user.id, 'meta-llama/llama-3.3-70b-instruct');

    list = await getUserWatchlist(user.id);
    expect(list.length).toBe(2);
    expect(list).toContain('deepseek/deepseek-r1');
    expect(list).toContain('meta-llama/llama-3.3-70b-instruct');

    // Duplicate add is idempotent
    await addToWatchlist(user.id, 'deepseek/deepseek-r1');
    list = await getUserWatchlist(user.id);
    expect(list.length).toBe(2);

    // Remove model
    await removeFromWatchlist(user.id, 'deepseek/deepseek-r1');
    list = await getUserWatchlist(user.id);
    expect(list.length).toBe(1);
    expect(list).toContain('meta-llama/llama-3.3-70b-instruct');
    expect(list).not.toContain('deepseek/deepseek-r1');
  });

  it('2. Maintains user isolation for watchlists', async () => {
    const userA = await createOrGetUser({ email: `user_a_${Date.now()}@example.com` });
    const userB = await createOrGetUser({ email: `user_b_${Date.now()}@example.com` });

    await addToWatchlist(userA.id, 'anthropic/claude-3.5-sonnet');
    await addToWatchlist(userB.id, 'openai/gpt-4o');

    const listA = await getUserWatchlist(userA.id);
    const listB = await getUserWatchlist(userB.id);

    expect(listA).toEqual(['anthropic/claude-3.5-sonnet']);
    expect(listB).toEqual(['openai/gpt-4o']);
  });
});
