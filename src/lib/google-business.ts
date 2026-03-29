import type { OpeningHours } from './opening-hours';

export interface GoogleEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REFRESH_TOKEN?: string;
  GOOGLE_LOCATION_ID?: string;
  GOOGLE_APPS_SCRIPT_URL?: string;
  GOOGLE_APPS_SCRIPT_SECRET?: string;
}

function isProxyMode(env: any): boolean {
  return !!(env?.GOOGLE_APPS_SCRIPT_URL && env?.GOOGLE_APPS_SCRIPT_SECRET);
}

function isDirectMode(env: any): boolean {
  return !!(env?.GOOGLE_CLIENT_ID && env?.GOOGLE_CLIENT_SECRET &&
            env?.GOOGLE_REFRESH_TOKEN && env?.GOOGLE_LOCATION_ID);
}

export function isGoogleConfigured(env: any): boolean {
  return isProxyMode(env) || isDirectMode(env);
}

export function getGoogleMode(env: any): 'proxy' | 'direct' | null {
  if (isProxyMode(env)) return 'proxy';
  if (isDirectMode(env)) return 'direct';
  return null;
}

// --- Apps Script Proxy ---

async function callProxy(env: any, action: string, payload?: any): Promise<any> {
  const response = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: env.GOOGLE_APPS_SCRIPT_SECRET,
      action,
      payload,
    }),
  });

  // Apps Script web apps return 200 even for errors, with JSON body
  // But redirects (302) happen on first deploy — follow them
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { success: false, error: `Proxy returned non-JSON (${response.status}): ${text.slice(0, 200)}` };
  }
}

// --- Direct API ---

const DAY_MAP: Record<number, string> = {
  0: 'SUNDAY', 1: 'MONDAY', 2: 'TUESDAY', 3: 'WEDNESDAY',
  4: 'THURSDAY', 5: 'FRIDAY', 6: 'SATURDAY'
};

async function getGoogleAccessToken(env: GoogleEnv): Promise<string> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      refresh_token: env.GOOGLE_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google token refresh failed (${response.status}): ${errorText}`);
  }

  const data = await response.json() as { access_token: string };
  return data.access_token;
}

function isValidTime(time: string): boolean {
  return /^\d{1,2}:\d{2}$/.test(time);
}

function convertToGoogleHours(hours: OpeningHours[]) {
  const periods = hours
    .filter(h => !h.is_closed && h.day_of_week !== null && isValidTime(h.open_time) && isValidTime(h.close_time))
    .map(h => {
      const [openH, openM] = h.open_time.split(':').map(Number);
      const [closeH, closeM] = h.close_time.split(':').map(Number);
      return {
        openDay: DAY_MAP[h.day_of_week!],
        openTime: { hours: openH, minutes: openM },
        closeDay: DAY_MAP[h.day_of_week!],
        closeTime: { hours: closeH, minutes: closeM },
      };
    });

  return { periods };
}

// --- Exported Functions ---

export async function updateGoogleBusinessHours(
  hours: OpeningHours[],
  env: GoogleEnv
): Promise<{ success: boolean; error?: string; skippedDays?: string[] }> {
  try {
    const skippedDays = hours
      .filter(h => !h.is_closed && h.day_of_week !== null && (!isValidTime(h.open_time) || !isValidTime(h.close_time)))
      .map(h => DAY_MAP[h.day_of_week!]);

    const regularHours = convertToGoogleHours(hours);

    if (isProxyMode(env)) {
      const result = await callProxy(env, 'updateHours', { regularHours });
      if (result.success && skippedDays.length > 0) result.skippedDays = skippedDays;
      return result;
    }

    const accessToken = await getGoogleAccessToken(env);
    const locationId = env.GOOGLE_LOCATION_ID;

    const response = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${locationId}?updateMask=regularHours`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ regularHours }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `Google API error (${response.status}): ${errorText}` };
    }

    return { success: true, ...(skippedDays.length > 0 ? { skippedDays } : {}) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function getGoogleBusinessProfile(
  env: GoogleEnv
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    if (isProxyMode(env)) {
      return await callProxy(env, 'getProfile');
    }

    const accessToken = await getGoogleAccessToken(env);
    const locationId = env.GOOGLE_LOCATION_ID;

    const response = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${locationId}?readMask=title,profile,phoneNumbers,websiteUri`,
      {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `Google API error (${response.status}): ${errorText}` };
    }

    const data = await response.json() as any;
    return {
      success: true,
      data: {
        title: data.title || '',
        description: data.profile?.description || '',
        primaryPhone: data.phoneNumbers?.primaryPhone || '',
        websiteUri: data.websiteUri || '',
      }
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function updateGoogleBusinessInfo(
  env: GoogleEnv,
  info: { description?: string; primaryPhone?: string; websiteUri?: string }
): Promise<{ success: boolean; error?: string }> {
  try {
    if (isProxyMode(env)) {
      return await callProxy(env, 'updateProfile', info);
    }

    const accessToken = await getGoogleAccessToken(env);
    const locationId = env.GOOGLE_LOCATION_ID;

    const body: any = {};
    const masks: string[] = [];

    if (info.description !== undefined) {
      body.profile = { description: info.description };
      masks.push('profile.description');
    }
    if (info.primaryPhone !== undefined) {
      body.phoneNumbers = { primaryPhone: info.primaryPhone };
      masks.push('phoneNumbers.primaryPhone');
    }
    if (info.websiteUri !== undefined) {
      body.websiteUri = info.websiteUri;
      masks.push('websiteUri');
    }

    if (masks.length === 0) {
      return { success: false, error: 'No fields to update' };
    }

    const response = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${locationId}?updateMask=${masks.join(',')}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `Google API error (${response.status}): ${errorText}` };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export interface SpecialHourEntry {
  date: string; // YYYY-MM-DD
  open_time?: string;
  close_time?: string;
  is_closed: boolean;
}

export async function updateGoogleSpecialHours(
  env: GoogleEnv,
  entries: SpecialHourEntry[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const specialHourPeriods = entries.map(entry => {
      const [year, month, day] = entry.date.split('-').map(Number);
      const period: any = {
        startDate: { year, month, day },
        closed: !!entry.is_closed,
      };
      if (!entry.is_closed && entry.open_time && entry.close_time) {
        const [openH, openM] = entry.open_time.split(':').map(Number);
        const [closeH, closeM] = entry.close_time.split(':').map(Number);
        period.openTime = { hours: openH, minutes: openM };
        period.closeTime = { hours: closeH, minutes: closeM };
      }
      return period;
    });

    if (isProxyMode(env)) {
      return await callProxy(env, 'updateSpecialHours', { specialHours: { specialHourPeriods } });
    }

    const accessToken = await getGoogleAccessToken(env);
    const locationId = env.GOOGLE_LOCATION_ID;

    const response = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${locationId}?updateMask=specialHours`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ specialHours: { specialHourPeriods } }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `Google API error (${response.status}): ${errorText}` };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
