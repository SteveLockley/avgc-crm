import type { OpeningHours } from './opening-hours';

export interface GoogleEnv {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REFRESH_TOKEN: string;
  GOOGLE_LOCATION_ID: string;
}

export function isGoogleConfigured(env: any): boolean {
  return !!(env?.GOOGLE_CLIENT_ID && env?.GOOGLE_CLIENT_SECRET &&
            env?.GOOGLE_REFRESH_TOKEN && env?.GOOGLE_LOCATION_ID);
}

const DAY_MAP: Record<number, string> = {
  0: 'SUNDAY', 1: 'MONDAY', 2: 'TUESDAY', 3: 'WEDNESDAY',
  4: 'THURSDAY', 5: 'FRIDAY', 6: 'SATURDAY'
};

async function getGoogleAccessToken(env: GoogleEnv): Promise<string> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
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

export async function updateGoogleBusinessHours(
  hours: OpeningHours[],
  env: GoogleEnv
): Promise<{ success: boolean; error?: string; skippedDays?: string[] }> {
  try {
    // Check for non-numeric close times that can't be sent to Google
    const skippedDays = hours
      .filter(h => !h.is_closed && h.day_of_week !== null && (!isValidTime(h.open_time) || !isValidTime(h.close_time)))
      .map(h => DAY_MAP[h.day_of_week!]);

    const accessToken = await getGoogleAccessToken(env);
    const regularHours = convertToGoogleHours(hours);
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
