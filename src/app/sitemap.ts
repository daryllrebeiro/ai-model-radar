import { MetadataRoute } from 'next';
import { getModelCurrentList, getEvents } from '@/lib/db/queries';
import { baseUrl } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = baseUrl();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: siteUrl, changeFrequency: 'hourly', priority: 1 },
    { url: `${siteUrl}/deals`, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${siteUrl}/labs`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${siteUrl}/community`, changeFrequency: 'daily', priority: 0.7 },
    { url: `${siteUrl}/signals`, changeFrequency: 'hourly', priority: 0.8 },
    { url: `${siteUrl}/benchmarks`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${siteUrl}/arbitrage`, changeFrequency: 'daily', priority: 0.7 },
    { url: `${siteUrl}/advisor`, changeFrequency: 'weekly', priority: 0.5 },
    { url: `${siteUrl}/docs`, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${siteUrl}/pricing`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${siteUrl}/contact`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${siteUrl}/privacy`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${siteUrl}/terms`, changeFrequency: 'yearly', priority: 0.2 },
  ];

  const [modelList, recentEvents] = await Promise.all([
    getModelCurrentList(),
    getEvents({ limit: 500 }).catch(() => ({ events: [] })),
  ]);

  const modelRoutes: MetadataRoute.Sitemap = modelList.models.map((m) => ({
    url: `${siteUrl}/models/${encodeURIComponent(m.model_id)}`,
    changeFrequency: 'daily' as const,
    priority: 0.9,
  }));

  const eventRoutes: MetadataRoute.Sitemap = recentEvents.events.map((e) => ({
    url: `${siteUrl}/changelog/${encodeURIComponent(e.detected_at.slice(0, 10))}`,
    changeFrequency: 'daily' as const,
    priority: 0.6,
  }));

  return [...staticRoutes, ...modelRoutes, ...eventRoutes];
}