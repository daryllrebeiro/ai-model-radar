import { describe, it, expect } from 'vitest';
import {
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
  renderDigestHtml,
  sendEmailDigest,
} from '../src/lib/email/resend';
import { ModelEvent } from '../src/types/events';

describe('Phase P7: Resend Email Digests & Unsubscribe Flow', () => {
  it('1. Generates and cryptographically verifies HMAC-SHA256 unsubscribe tokens', () => {
    const email = 'subscriber@company.com';
    const token = generateUnsubscribeToken(email);

    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyUnsubscribeToken(email, token)).toBe(true);

    // Tampered token or wrong email
    expect(verifyUnsubscribeToken('other@company.com', token)).toBe(false);
    expect(verifyUnsubscribeToken(email, 'invalid_token_1234567890123456789012345678901234567890123456789012345678901234')).toBe(false);
  });

  it('2. Renders structured responsive HTML digest including price drops and unsubscribe links', () => {
    const mockEvents: ModelEvent[] = [
      {
        id: 1,
        model_id: 'meta-llama/llama-3.3-70b-instruct',
        provider: 'openrouter',
        event_type: 'PRICE_CHANGE',
        old_value: { price_prompt: '0.00000020' },
        new_value: { price_prompt: '0.00000012' },
        pct_change: -40,
        source: 'openrouter',
        detected_at: new Date().toISOString(),
      },
      {
        id: 2,
        model_id: 'deepseek/deepseek-r1',
        provider: 'openrouter',
        event_type: 'NEW_MODEL',
        old_value: null,
        new_value: { is_free: false },
        pct_change: null,
        source: 'openrouter',
        detected_at: new Date().toISOString(),
      },
    ];

    const html = renderDigestHtml({
      recipientEmail: 'subscriber@company.com',
      recentEvents: mockEvents,
      timeframe: 'daily',
    });

    expect(html).toContain('AI Model Radar');
    expect(html).toContain('meta-llama/llama-3.3-70b-instruct');
    expect(html).toContain('deepseek/deepseek-r1');
    expect(html).toContain('/api/alerts/unsubscribe');
  });

  it('3. Dispatches digest email via driver with success acknowledgment', async () => {
    const res = await sendEmailDigest({
      to: 'recipient@test.com',
      subject: '⚡ AI Model Radar Daily Digest',
      html: '<h1>Digest</h1>',
    });

    expect(res.success).toBe(true);
    expect(res.id).toBeDefined();
  });
});
