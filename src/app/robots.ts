import { MetadataRoute } from 'next';
import { baseUrl } from '@/lib/env';

export default function robots(): MetadataRoute.Robots {
  const siteUrl = baseUrl();
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/admin/',
        '/compare/',
        '/checkout',
        '/auth/',
      ],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}