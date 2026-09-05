import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const SupportRequestSchema = z.object({
  email: z.string().email(),
  category: z.enum(['support', 'billing', 'model_request', 'privacy', 'security']),
  message: z.string().min(10).max(2000),
});

export async function POST(request: NextRequest) {
  try {
    const json = await request.json();
    const parsed = SupportRequestSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid submission data', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { email, category } = parsed.data;

    logger.info(`Support ticket created: [${category}] from ${email}`);

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
