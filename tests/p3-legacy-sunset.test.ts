import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as legacyModels } from '../src/app/api/models/route';

describe('P3 legacy sunset (ADR-4 freeze, machine-readable)', () => {
  it('legacy models twin carries Deprecation + Sunset + successor Link', async () => {
    const res = await legacyModels(new NextRequest('http://localhost/api/models?limit=5'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Deprecation')).toBe('true');
    expect(res.headers.get('Sunset')).toContain('2026');
    expect(res.headers.get('Link')).toContain('/api/v1/models');
  });
});
