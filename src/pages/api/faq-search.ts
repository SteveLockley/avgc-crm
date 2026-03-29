import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime?.env?.DB;

  if (!db) {
    return new Response(
      JSON.stringify({ success: false, error: 'Database unavailable' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await request.json();
    const { query } = body;

    if (!query || typeof query !== 'string') {
      return new Response(
        JSON.stringify({ success: false, error: 'Query is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get all published FAQs
    const result = await db.prepare(
      `SELECT id, category, question, answer, keywords
       FROM website_faq
       WHERE published = 1`
    ).all();

    const faqs = result.results || [];

    // Simple keyword matching
    const queryWords = query.toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove punctuation
      .split(/\s+/)
      .filter(word => word.length > 2); // Ignore very short words

    // Score each FAQ based on keyword matches
    const scoredFaqs = faqs.map((faq: any) => {
      const questionLower = faq.question.toLowerCase();
      const keywordsLower = (faq.keywords || '').toLowerCase();
      const answerLower = faq.answer.toLowerCase();

      let score = 0;

      for (const word of queryWords) {
        // Question matches are worth more
        if (questionLower.includes(word)) {
          score += 3;
        }
        // Keyword matches
        if (keywordsLower.includes(word)) {
          score += 2;
        }
        // Answer matches (less weight)
        if (answerLower.includes(word)) {
          score += 1;
        }
      }

      return { ...faq, score };
    });

    // Filter and sort by score
    const matches = scoredFaqs
      .filter((faq: any) => faq.score > 0)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, 3) // Return top 3 matches
      .map((faq: any) => ({
        id: faq.id,
        question: faq.question,
        answer: faq.answer,
        category: faq.category
      }));

    return new Response(
      JSON.stringify({
        success: true,
        matches,
        hasMore: scoredFaqs.filter((f: any) => f.score > 0).length > 3
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('FAQ search error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Search failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
