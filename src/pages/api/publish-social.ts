import type { APIRoute } from 'astro';
import { publishToSocial, isMetaConfigured, isInstagramConfigured } from '../../lib/meta-api';

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  const db = env?.DB;

  if (!db) {
    return new Response(JSON.stringify({ error: 'Database not available' }), { status: 500 });
  }

  if (!isMetaConfigured(env)) {
    return new Response(JSON.stringify({ error: 'Meta API not configured' }), { status: 500 });
  }

  try {
    const { postId } = await request.json();

    if (!postId) {
      return new Response(JSON.stringify({ error: 'postId is required' }), { status: 400 });
    }

    const post = await db.prepare('SELECT * FROM social_posts WHERE id = ?').bind(postId).first<any>();

    if (!post) {
      return new Response(JSON.stringify({ error: 'Post not found' }), { status: 404 });
    }

    const result = await publishToSocial(env, post.message, post.image_url || undefined);

    const fbSuccess = result.fb?.success ?? false;
    const igSuccess = result.ig?.success ?? false;
    const anySuccess = fbSuccess || igSuccess;

    const errors: string[] = [];
    if (result.fb && !result.fb.success) errors.push(result.fb.error || 'Facebook failed');
    if (result.ig && !result.ig.success) errors.push(result.ig.error || 'Instagram failed');

    const status = anySuccess ? 'published' : 'failed';
    const errorMessage = errors.length > 0 ? errors.join('; ') : null;

    await db.prepare(
      `UPDATE social_posts
       SET status = ?, fb_post_id = ?, ig_media_id = ?, error_message = ?,
           published_at = CASE WHEN ? = 'published' THEN datetime('now') ELSE published_at END,
           updated_at = datetime('now')
       WHERE id = ?`
    ).bind(
      status,
      result.fb?.postId || post.fb_post_id || null,
      result.ig?.postId || post.ig_media_id || null,
      errorMessage,
      status,
      postId
    ).run();

    return new Response(JSON.stringify({
      success: anySuccess,
      status,
      fb: result.fb || null,
      ig: result.ig || null,
      errors: errors.length > 0 ? errors : undefined,
    }));
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Unknown error' }), { status: 500 });
  }
};
