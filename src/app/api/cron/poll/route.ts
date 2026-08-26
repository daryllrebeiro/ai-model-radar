import { NextRequest, NextResponse } from 'next/server';
import { runIngestionCycle } from '@/lib/ingestion/runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Allow full runtime for serverless execution

export async function GET(request: NextRequest) {
  return handlePoll(request);
}

export async function POST(request: NextRequest) {
  return handlePoll(request);
}

async function handlePoll(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // If CRON_SECRET is configured, enforce bearer token
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await runIngestionCycle();

  if (!result.success) {
    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json(result);
}
