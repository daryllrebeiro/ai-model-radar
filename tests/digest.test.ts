import { describe, it, expect } from 'vitest';
import {
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
  renderDigestHtml,
  sendEmailDigest,
} from '../src/lib/email/resend';
import { ModelEvent } from '../src/types/events';
import { PriceDropForecast } from '../src/types/forecast';

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

  it('4. Includes a RadarForecast section when forecasts are provided', () => {
    const forecasts: PriceDropForecast[] = [
      {
        id: 'f-test-acme-cloud-3-flash',
        model_id: 'acme/cloud-3-flash',
        model_name: 'Cloud 3 Flash',
        provider: 'acme',
        family: 'acme/cloud-3',
        probability: 0.93,
        confidence: 'high',
        expected_window_days: 7,
        expected_pct_change: 35,
        cadence_days: 80,
        cadence_samples: 5,
        days_since_last_cut: null,
        model_age_days: 200,
        factors: ['Never observed a price cut (est. age 200d)'],
        generated_at: new Date().toISOString(),
      },
    ];

    const html = renderDigestHtml({
      recipientEmail: 'subscriber@company.com',
      recentEvents: [],
      timeframe: 'daily',
      forecasts,
    });

    expect(html).toContain('RadarForecast: Price Cuts Likely Soon');
    expect(html).toContain('Cloud 3 Flash');
    expect(html).toContain('93% likely within 7d');
  });

  it('5. Omits the RadarForecast section when no forecasts are available', () => {
    const html = renderDigestHtml({
      recipientEmail: 'subscriber@company.com',
      recentEvents: [],
      timeframe: 'daily',
    });
    expect(html).not.toContain('RadarForecast: Price Cuts Likely Soon');
  });

  it('6. Includes a migration-savings callout with the best switch', () => {
    const html = renderDigestHtml({
      recipientEmail: 'subscriber@company.com',
      recentEvents: [],
      timeframe: 'weekly',
      savings: {
        monthly_usd: 650,
        model_name: 'Cloud 3 Haiku',
        model_id: 'acme/cloud-3-haiku',
        compare_url: '/compare?models=acme%2Fcloud-3-opus%2Cacme%2Fcloud-3-haiku',
      },
    });

    expect(html).toContain('You could have saved $650 this month');
    expect(html).toContain('Cloud 3 Haiku');
    expect(html).toContain('/compare?models=');
  });

  it('7. Omits the savings callout when none is available', () => {
    const html = renderDigestHtml({
      recipientEmail: 'subscriber@company.com',
      recentEvents: [],
      timeframe: 'weekly',
    });
    expect(html).not.toContain('You could have saved $');
  });

  it('8. Renders upstream-derived strings as inert text, never executable markup', () => {
    const payload = `"><script>alert('xss')</script><img src=x onerror=alert(1)>`;
    const html = renderDigestHtml({
      recipientEmail: 'subscriber@company.com',
      recentEvents: [
        {
          id: 1,
          model_id: 'evil/model',
          model_name: payload,
          provider: payload,
          event_type: 'PRICE_CHANGE',
          old_value: { price_prompt: 0.000004 },
          new_value: { price_prompt: 0.000003 },
          pct_change: -25,
          source: 'openrouter',
          detected_at: new Date().toISOString(),
        },
        {
          id: 2,
          model_id: 'evil/model-2',
          model_name: `Free ${payload}`,
          provider: 'EvilHub',
          event_type: 'NEW_MODEL',
          old_value: null,
          new_value: { is_free: true },
          pct_change: null,
          source: 'openrouter',
          detected_at: new Date().toISOString(),
        },
      ],
      timeframe: 'daily',
      forecasts: [
        {
          id: 'F-evil',
          model_id: 'evil/model',
          provider: payload,
          model_name: payload,
          family: 'evil',
          probability: 0.9,
          confidence: 'high',
          expected_pct_change: 10,
          expected_window_days: 7,
          model_age_days: 10,
          days_since_last_cut: null,
          cadence_days: null,
          cadence_samples: 0,
          factors: [],
          generated_at: new Date().toISOString(),
        },
      ],
      savings: {
        monthly_usd: 100,
        model_name: payload,
        model_id: 'evil/model',
        compare_url: '/compare',
      },
      briefs: [
        {
          generated_at: new Date().toISOString(),
          scope: 'watchlist',
          window_days: 7,
          watchlist: ['evil/model'],
          headline: `Dropped ${payload}`,
          models: [
            {
              model_id: 'evil/model',
              name: payload,
              provider: 'EvilHub',
              window_pct_change: -25,
              old_prompt_1m: 4,
              new_prompt_1m: 3,
              became_free: false,
              eol: false,
              forecast_probability: null,
              cited_events: 1,
            },
          ],
          citations: [],
        },
      ],
    });

    // No raw executable markup from upstream strings may survive rendering
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('onerror=alert(1)>');
    // The payload text itself is still present, HTML-escaped and inert
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
  });
});
