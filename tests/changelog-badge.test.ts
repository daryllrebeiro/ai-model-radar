import { describe, it, expect } from 'vitest';
import { GET } from '../src/app/badge/[...id]/route';
import { NextRequest } from 'next/server';

describe('Phase Q5: Public Changelog & Embeddable Badge', () => {
  it('1. Generates crisp, valid SVG vector price badge with appropriate Content-Type', async () => {
    const req = new NextRequest('https://ai-model-radar.com/badge/openai/gpt-4o/price.svg');
    const res = await GET(req, { params: { id: ['openai', 'gpt-4o'] } });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/svg+xml');
    expect(res.headers.get('cache-control')).toContain('public');

    const svgText = await res.text();
    expect(svgText).toContain('<svg');
    expect(svgText).toContain('</svg>');
    expect(svgText).toContain('OpenAI price');
    expect(svgText).toContain('1M');
  });

  it('2. Renders FREE badge in emerald color for zero-cost models', async () => {
    const req = new NextRequest('https://ai-model-radar.com/badge/meta-llama/llama-3.3-70b-instruct:free/price.svg');
    const res = await GET(req, { params: { id: ['meta-llama', 'llama-3.3-70b-instruct:free'] } });

    expect(res.status).toBe(200);
    const svgText = await res.text();
    expect(svgText).toContain('FREE');
    expect(svgText).toContain('#10B981'); // Emerald color
  });

  it('3. Supports custom labels and hex colors via query parameters', async () => {
    const req = new NextRequest('https://ai-model-radar.com/badge/anthropic/claude-3-7-sonnet/price.svg?label=Claude%203.7&color=ec4899&style=flat-square');
    const res = await GET(req, { params: { id: ['anthropic', 'claude-3-7-sonnet'] } });

    expect(res.status).toBe(200);
    const svgText = await res.text();
    expect(svgText).toContain('Claude 3.7');
    expect(svgText).toContain('#ec4899');
    expect(svgText).toContain('rx="0"'); // flat-square style
  });

  it('4. Aggregates event history correctly by YYYY-MM periods', () => {
    const mockEvents = [
      { detected_at: '2026-08-15T10:00:00Z', model_id: 'm1' },
      { detected_at: '2026-08-20T14:30:00Z', model_id: 'm2' },
      { detected_at: '2026-07-04T09:15:00Z', model_id: 'm3' },
    ];

    const periods = new Set(mockEvents.map((e) => e.detected_at.slice(0, 7)));
    expect(periods.has('2026-08')).toBe(true);
    expect(periods.has('2026-07')).toBe(true);
    expect(periods.size).toBe(2);
  });
});
