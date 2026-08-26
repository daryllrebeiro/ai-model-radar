export interface EventCursor {
  detected_at: string;
  id: number;
}

/**
 * Encodes an event's detected_at and id into a URL-safe Base64 cursor
 */
export function encodeCursor(cursor: EventCursor): string {
  const payload = JSON.stringify({ d: cursor.detected_at, i: cursor.id });
  return Buffer.from(payload, 'utf-8').toString('base64url');
}

/**
 * Decodes a URL-safe Base64 cursor into EventCursor
 */
export function decodeCursor(cursorString?: string | null): EventCursor | null {
  if (!cursorString) return null;
  try {
    const raw = Buffer.from(cursorString, 'base64url').toString('utf-8');
    const parsed = JSON.parse(raw);
    if (parsed.d && typeof parsed.i === 'number') {
      return { detected_at: parsed.d, id: parsed.i };
    }
    return null;
  } catch {
    return null;
  }
}
