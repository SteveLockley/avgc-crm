const GRAPH_API = 'https://graph.facebook.com/v25.0';

export interface MetaEnv {
  META_PAGE_ACCESS_TOKEN?: string;
  META_PAGE_ID?: string;
  META_IG_USER_ID?: string;
}

export function isMetaConfigured(env: any): boolean {
  return !!(env?.META_PAGE_ACCESS_TOKEN && env?.META_PAGE_ID);
}

export function isInstagramConfigured(env: any): boolean {
  return isMetaConfigured(env) && !!env?.META_IG_USER_ID;
}

interface PublishResult {
  success: boolean;
  postId?: string;
  error?: string;
}

export async function publishToFacebook(
  env: MetaEnv,
  message: string,
  imageUrl?: string
): Promise<PublishResult> {
  try {
    const token = env.META_PAGE_ACCESS_TOKEN!;
    const pageId = env.META_PAGE_ID!;

    let url: string;
    const params = new URLSearchParams({ access_token: token });

    if (imageUrl) {
      url = `${GRAPH_API}/${pageId}/photos`;
      params.set('url', imageUrl);
      params.set('message', message);
    } else {
      url = `${GRAPH_API}/${pageId}/feed`;
      params.set('message', message);
    }

    const response = await fetch(url, {
      method: 'POST',
      body: params,
    });

    const data = await response.json() as any;

    if (data.error) {
      return { success: false, error: `Facebook: ${data.error.message}` };
    }

    return { success: true, postId: data.id || data.post_id };
  } catch (error) {
    return { success: false, error: `Facebook: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

export async function publishToInstagram(
  env: MetaEnv,
  message: string,
  imageUrl: string
): Promise<PublishResult> {
  try {
    const token = env.META_PAGE_ACCESS_TOKEN!;
    const igUserId = env.META_IG_USER_ID!;

    // Step 1: Create media container
    const containerParams = new URLSearchParams({
      access_token: token,
      image_url: imageUrl,
      caption: message,
    });

    const containerRes = await fetch(`${GRAPH_API}/${igUserId}/media`, {
      method: 'POST',
      body: containerParams,
    });

    const containerData = await containerRes.json() as any;

    if (containerData.error) {
      return { success: false, error: `Instagram container: ${containerData.error.message}` };
    }

    const containerId = containerData.id;

    // Step 2: Poll for container to be ready (up to 30 seconds)
    let ready = false;
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 3000));

      const statusRes = await fetch(
        `${GRAPH_API}/${containerId}?fields=status_code&access_token=${token}`
      );
      const statusData = await statusRes.json() as any;

      if (statusData.status_code === 'FINISHED') {
        ready = true;
        break;
      }
      if (statusData.status_code === 'ERROR') {
        return { success: false, error: `Instagram processing failed` };
      }
    }

    if (!ready) {
      return { success: false, error: 'Instagram: container processing timed out' };
    }

    // Step 3: Publish
    const publishParams = new URLSearchParams({
      access_token: token,
      creation_id: containerId,
    });

    const publishRes = await fetch(`${GRAPH_API}/${igUserId}/media_publish`, {
      method: 'POST',
      body: publishParams,
    });

    const publishData = await publishRes.json() as any;

    if (publishData.error) {
      return { success: false, error: `Instagram publish: ${publishData.error.message}` };
    }

    return { success: true, postId: publishData.id };
  } catch (error) {
    return { success: false, error: `Instagram: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

export interface SocialPublishResult {
  fb?: PublishResult;
  ig?: PublishResult;
}

export async function publishToSocial(
  env: MetaEnv,
  message: string,
  imageUrl?: string,
  platforms?: { facebook: boolean; instagram: boolean }
): Promise<SocialPublishResult> {
  const result: SocialPublishResult = {};
  const doFb = platforms?.facebook !== false;
  const doIg = platforms?.instagram !== false && !!imageUrl && isInstagramConfigured(env);

  const promises: Promise<void>[] = [];

  if (doFb && isMetaConfigured(env)) {
    promises.push(
      publishToFacebook(env, message, imageUrl).then(r => { result.fb = r; })
    );
  }

  if (doIg) {
    promises.push(
      publishToInstagram(env, message, imageUrl!).then(r => { result.ig = r; })
    );
  }

  await Promise.all(promises);
  return result;
}
