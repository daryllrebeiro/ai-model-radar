import { NextRequest, NextResponse } from 'next/server';
import { getModelDetail } from '@/lib/db/queries';
import { RAW_BENCHMARK_DATA } from '@/lib/benchmarks';
import { trackEvent } from '@/lib/analytics';
import { escapeXml, sanitizeColor } from '@/lib/sanitize';

export const dynamic = 'force-dynamic';

interface BadgeRouteProps {
  params: {
    id: string[];
  };
}

function calculateTextWidth(text: string): number {
  // Approximate average character width in sans-serif font
  return Math.round(text.length * 6.8) + 12;
}

export async function GET(request: NextRequest, { params }: BadgeRouteProps) {
  try {
    const rawPath = Array.isArray(params.id) ? params.id.join('/') : params.id;
    // Strip trailing /price.svg, /price, or .svg
    const modelId = decodeURIComponent(rawPath)
      .replace(/\/price\.svg$/, '')
      .replace(/\/price$/, '')
      .replace(/\.svg$/, '');

    const searchParams = request.nextUrl.searchParams;
    const customLabel = searchParams.get('label');
    const customColor = searchParams.get('color');
    const style = searchParams.get('style') || 'flat';

    // Look up model in DB or benchmark fallback (exact match first)
    const detail = await getModelDetail(modelId);
    const benchmark =
      RAW_BENCHMARK_DATA.find((b) => b.model_id.toLowerCase() === modelId.toLowerCase()) ||
      RAW_BENCHMARK_DATA.find(
        (b) =>
          modelId.toLowerCase().includes(b.model_id.toLowerCase()) ||
          b.name.toLowerCase().includes(modelId.toLowerCase())
      );

    let leftLabel = customLabel || 'AI Price';
    let rightText = 'Not Found';
    let rightColor = customColor ? `#${customColor.replace(/^#/, '')}` : '#4B5563';

    if (detail?.current || benchmark || modelId.endsWith(':free')) {
      const current = detail?.current;
      const isFree = current?.is_free || modelId.endsWith(':free') || benchmark?.pricing_prompt_1m === 0;

      if (isFree) {
        rightText = 'FREE';
        rightColor = customColor ? `#${customColor.replace(/^#/, '')}` : '#10B981';
      } else {
        const prompt1m = current?.price_prompt !== null && current?.price_prompt !== undefined
          ? current.price_prompt * 1_000_000
          : benchmark?.pricing_prompt_1m || 0;
        const comp1m = current?.price_completion !== null && current?.price_completion !== undefined
          ? current.price_completion * 1_000_000
          : benchmark?.pricing_comp_1m || 0;

        if (prompt1m > 0 && comp1m > 0) {
          rightText = `$${prompt1m.toFixed(prompt1m < 0.1 ? 3 : 2)} / $${comp1m.toFixed(comp1m < 0.1 ? 3 : 2)} / 1M`;
        } else if (prompt1m > 0) {
          rightText = `$${prompt1m.toFixed(prompt1m < 0.1 ? 3 : 2)} / 1M`;
        } else {
          rightText = 'Usage-Based';
        }
        rightColor = customColor ? `#${customColor.replace(/^#/, '')}` : '#0284C7';
      }

      if (!customLabel && (current?.provider || benchmark?.provider)) {
        leftLabel = `${current?.provider || benchmark?.provider} price`;
      }
    }

    trackEvent('badge_render', { modelId, isFree: rightText === 'FREE' });

    const leftWidth = calculateTextWidth(leftLabel);
    const rightWidth = calculateTextWidth(rightText);
    const totalWidth = leftWidth + rightWidth;
    const radius = style === 'flat-square' ? 0 : 3;

    const safeLabel = escapeXml(leftLabel);
    const safeText = escapeXml(rightText);
    const safeColor = sanitizeColor(rightColor);

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalWidth}" height="20" role="img" aria-label="${safeLabel}: ${safeText}">
  <title>${safeLabel}: ${safeText}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="20" rx="${radius}" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${leftWidth}" height="20" fill="#1F2937"/>
    <rect x="${leftWidth}" width="${rightWidth}" height="20" fill="${safeColor}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" text-rendering="geometricPrecision" font-size="110">
    <text aria-hidden="true" x="${(leftWidth / 2) * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(leftWidth - 10) * 10}">${safeLabel}</text>
    <text x="${(leftWidth / 2) * 10}" y="140" transform="scale(.1)" fill="#F3F4F6" textLength="${(leftWidth - 10) * 10}">${safeLabel}</text>
    <text aria-hidden="true" x="${(leftWidth + rightWidth / 2) * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(rightWidth - 10) * 10}">${safeText}</text>
    <text x="${(leftWidth + rightWidth / 2) * 10}" y="140" transform="scale(.1)" fill="#FFFFFF" font-weight="bold" textLength="${(rightWidth - 10) * 10}">${safeText}</text>
  </g>
</svg>
`.trim();

    return new NextResponse(svg, {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=43200',
      },
    });
  } catch {
    const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="90" height="20"><rect width="90" height="20" fill="#E11D48"/><text x="45" y="14" fill="#fff" font-family="sans-serif" font-size="11" text-anchor="middle">error</text></svg>`;
    return new NextResponse(fallbackSvg, {
      status: 500,
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
      },
    });
  }
}
