import type { APIRoute } from 'astro';

const staticPages = [
  { url: '/', priority: '1.0', changefreq: 'weekly' },
  { url: '/course', priority: '0.9', changefreq: 'monthly' },
  { url: '/visitors', priority: '0.9', changefreq: 'monthly' },
  { url: '/membership', priority: '0.8', changefreq: 'monthly' },
  { url: '/clubhouse', priority: '0.7', changefreq: 'monthly' },
  { url: '/contact', priority: '0.8', changefreq: 'monthly' },
  { url: '/faq', priority: '0.6', changefreq: 'monthly' },
  { url: '/news', priority: '0.7', changefreq: 'weekly' },
  { url: '/privacy-policy', priority: '0.3', changefreq: 'yearly' },
  { url: '/terms', priority: '0.3', changefreq: 'yearly' },
  { url: '/refund-policy', priority: '0.3', changefreq: 'yearly' },
];

export const GET: APIRoute = async ({ locals }) => {
  const site = 'https://www.alnmouthvillage.golf';
  const db = (locals as any).runtime?.env?.DB;

  let newsArticles: { slug: string; updated_at: string | null; publish_date: string | null }[] = [];
  if (db) {
    try {
      const result = await db.prepare(
        `SELECT slug, updated_at, publish_date
         FROM website_news
         WHERE published = 1 AND (publish_date IS NULL OR publish_date <= date('now'))
         ORDER BY publish_date DESC`
      ).all();
      newsArticles = result.results || [];
    } catch (e) {
      console.error('Sitemap: Error fetching news:', e);
    }
  }

  const urls = [
    ...staticPages.map(p => `
  <url>
    <loc>${site}${p.url}</loc>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`),
    ...newsArticles.map(a => `
  <url>
    <loc>${site}/news/${a.slug}</loc>${a.updated_at || a.publish_date ? `
    <lastmod>${a.updated_at || a.publish_date}</lastmod>` : ''}
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}
</urlset>`;

  return new Response(xml.trim(), {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
