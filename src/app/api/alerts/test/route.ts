import { NextRequest, NextResponse } from 'next/server';
import { deliverWebhookPayload } from '@/lib/webhooks';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const testWebhookSchema = z.object({
  destinationUrl: z.string().url(),
  secret: z.string().optional(),
  event: z.record(z.any()).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = testWebhookSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        },
        { status: 400 }
      );
    }

    const { destinationUrl, secret, event } = parsed.data;

    const samplePayload = {
      event_type: 'PRICE_CHANGE',
      model_id: 'anthropic/claude-3-7-sonnet',
      model_name: 'Claude 3.7 Sonnet',
      provider: 'Anthropic',
      old_prompt_price: '$3.00 / 1M',
      new_prompt_price: '$2.50 / 1M',
      pct_change: -16.67,
      detected_at: new Date().toISOString(),
      source: 'ai-model-radar-test',
      ...event,
    };

    const deliveryResult = await deliverWebhookPayload(destinationUrl, samplePayload, {
      secret,
      ruleId: 'rule-test-ping',
      maxRetries: 2,
      baseDelayMs: 100,
      timeoutMs: 4000,
    });

    return NextResponse.json({
      success: deliveryResult.success,
      destination_url: destinationUrl,
      http_status: deliveryResult.httpStatus || null,
      attempts: deliveryResult.attempts,
      duration_ms: deliveryResult.durationMs,
      signature: deliveryResult.signature || null,
      error: deliveryResult.error || null,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: 'Failed to trigger test webhook delivery',
        message: error.message || String(error),
      },
      { status: 500 }
    );
  }
}
