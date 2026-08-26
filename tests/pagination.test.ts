import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor } from '../src/lib/pagination';
import { getEvents } from '../src/lib/db/queries';

describe('Phase P3: Keyset Cursor Pagination', () => {
  it('1. Correctly encodes and decodes URL-safe base64 cursors', () => {
    const timestamp = '2026-08-25T12:00:00.000Z';
    const id = 1042;

    const cursor = encodeCursor({ detected_at: timestamp, id });
    expect(cursor).toBeDefined();
    expect(typeof cursor).toBe('string');

    const decoded = decodeCursor(cursor);
    expect(decoded).not.toBeNull();
    expect(decoded?.detected_at).toBe(timestamp);
    expect(decoded?.id).toBe(id);
  });

  it('2. Returns null when decoding invalid or malformed cursor strings', () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor('invalid-base64-payload')).toBeNull();
  });

  it('3. Supports sequential page traversal through getEvents using cursors', async () => {
    // Fetch page 1 (limit: 2)
    const page1 = await getEvents({ limit: 2 });
    expect(page1.events.length).toBeLessThanOrEqual(2);

    if (page1.hasMore && page1.nextCursor) {
      // Fetch page 2 using nextCursor
      const page2 = await getEvents({ limit: 2, cursor: page1.nextCursor });
      expect(page2.events.length).toBeGreaterThan(0);

      // Verify no duplicate IDs across sequential cursor pages
      const page1Ids = new Set(page1.events.map((e) => e.id));
      for (const e of page2.events) {
        expect(page1Ids.has(e.id)).toBe(false);
      }
    }
  });
});
