import { NextRequest, NextResponse } from 'next/server';
import { verifyUnsubscribeToken } from '@/lib/email/resend';
import { getActiveAlertRules, updateAlertRuleStatus } from '@/lib/db/queries';
import { escapeHtml } from '@/lib/sanitize';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  const token = request.nextUrl.searchParams.get('token');

  if (!email || !token) {
    return NextResponse.json({ error: 'Email and unsubscribe token are required.' }, { status: 400 });
  }

  const isValid = verifyUnsubscribeToken(email, token);
  if (!isValid) {
    return NextResponse.json({ error: 'Invalid or expired unsubscribe token.' }, { status: 403 });
  }

  try {
    const rules = await getActiveAlertRules();
    const userRules = rules.filter((r) => r.destination?.toLowerCase() === email.toLowerCase());

    for (const rule of userRules) {
      if (rule.id) {
        await updateAlertRuleStatus(rule.id, false);
      }
    }

    // Return friendly HTML confirmation page
    const safeEmail = escapeHtml(email);
    const htmlResponse = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Unsubscribed — AI Model Radar</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0B0F17; color: #F3F4F6; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #111827; border: 1px solid #1F2937; padding: 32px; border-radius: 16px; max-width: 440px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    h1 { color: #38BDF8; font-size: 22px; margin-bottom: 8px; }
    p { color: #9CA3AF; font-size: 14px; line-height: 1.5; }
    a { display: inline-block; margin-top: 16px; color: #38BDF8; text-decoration: none; font-size: 13px; font-weight: bold; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Successfully Unsubscribed</h1>
    <p>You have been unsubscribed from AI Model Radar email digests for <strong>${safeEmail}</strong>.</p>
    <p>You will no longer receive periodic email updates.</p>
    <a href="/">Return to AI Model Radar &rarr;</a>
  </div>
</body>
</html>
`;

    return new NextResponse(htmlResponse, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch {
    return NextResponse.json({ error: 'Failed to process unsubscribe request' }, { status: 500 });
  }
}
