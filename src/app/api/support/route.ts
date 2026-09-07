import { NextRequest, NextResponse } from 'next/server';
import { logger, hashEmail } from '@/lib/logger';
import { globalRateLimiter, getClientIp } from '@/lib/api-auth';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const SupportRequestSchema = z.object({
  email: z.string().email(),
  category: z.enum(['support', 'billing', 'model_request', 'privacy', 'security']),
  message: z.string().min(10).max(2000),
});

// Unauthenticated intake: per-IP brake against ticket/log spam (10/min).
const SUPPORT_IP_LIMIT = 10;
const SUPPORT_IP_WINDOW_MS = 60 * 1000;

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const ipCheck = await globalRateLimiter.check(`ip:support:${ip}`, SUPPORT_IP_LIMIT, SUPPORT_IP_WINDOW_MS);
    if (!ipCheck.allowed) {
      return NextResponse.json(
        { error: 'Too Many Requests', retry_after_seconds: ipCheck.resetInSec },
        { status: 429, headers: { 'Retry-After': ipCheck.resetInSec.toString() } }
      );
    }

    const json = await request.json();
    const parsed = SupportRequestSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid submission data', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { email, category } = parsed.data;

    logger.info(`Support ticket created: [${category}] from ${hashEmail(email)}`);

    return NextResponse.json({
      success: true,
      ticketId: `tkt_${Date.now()}`,
      message: 'Support request received. Engineering will review your inquiry.',
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ error: 'Failed to submit support request' }, { status: 500 });
  }
}
