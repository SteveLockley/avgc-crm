import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ locals }) => {
  const site = 'https://www.alnmouthvillage.golf';
  const db = (locals as any).runtime?.env?.DB;

  let articles: any[] = [];
  if (db) {
    try {
      const result = await db.prepare(
        `SELECT slug, title, excerpt, publish_date
         FROM website_news
         WHERE published = 1 AND (publish_date IS NULL OR publish_date <= date('now'))
         ORDER BY publish_date DESC
         LIMIT 20`
      ).all();
      articles = result.results || [];
    } catch (e) {
      console.error('RSS: Error fetching news:', e);
    }
  }

  const items = articles.map(a => `
    <item>
      <title><![CDATA[${a.title}]]></title>
      <link>${site}/news/${a.slug}</link>
      <guid>${site}/news/${a.slug}</guid>
      <description><![CDATA[${a.excerpt || a.title}]]></description>${a.publish_date ? `
      <pubDate>${new Date(a.publish_date).toUTCString()}</pubDate>` : ''}
    </item>`);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Alnmouth Village Golf Club - News</title>
    <link>${site}/news</link>
    <description>Latest news and events from Alnmouth Village Golf Club</description>
    <language>en-gb</language>
    <atom:link href="${site}/rss.xml" rel="self" type="application/rss+xml" />${items.join('')}
  </channel>
</rss>`;

  return new Response(xml.trim(), {
    headers: {
      'Content-Type': 'application/rss+xml',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
