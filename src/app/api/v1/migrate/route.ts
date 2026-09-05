import { NextRequest, NextResponse } from 'next/server';
import { getModelCurrentList } from '@/lib/db/queries';
import { findMigrationAlternatives } from '@/lib/migration-advisor';
import { trackEvent } from '@/lib/analytics';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const model = request.nextUrl.searchParams.get('model');
    if (!model) {
      return NextResponse.json(
        { error: 'Missing required query parameter: model' },
        { status: 400 }
      );
    }

    const { models: allModels } = await getModelCurrentList({ limit: 100 });
    const report = findMigrationAlternatives(model, allModels);

    if (!report) {
      return NextResponse.json(
        { error: `No migration alternatives found for model: ${model}` },
        { status: 404 }
      );
    }

    trackEvent('migration_api_query', { model });

    return NextResponse.json({
      success: true,
      target_model: report.target_model,
      alternatives: report.alternatives,
      compare_url: report.compare_url,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error(`Migration API error: ${error.message}`);
    return NextResponse.json(
      { error: 'Failed to generate migration recommendations' },
      { status: 500 }
    );
  }
}
