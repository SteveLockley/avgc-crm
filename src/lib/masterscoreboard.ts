// Master Scoreboard API v8 client
// JWT-authenticated (HS256) via Web Crypto API — Cloudflare Workers compatible, no npm deps

const MSB_BASE_URL = 'https://www.masterscoreboard.co.uk/api/v8';

export interface MsbEnv {
  MSB_CLUB_WEB_ID: string;
  MSB_SECRET_KEY: string;
}

export function isMsbConfigured(env: any): boolean {
  return !!(env?.MSB_CLUB_WEB_ID && env?.MSB_SECRET_KEY);
}

// --- JWT signing (HS256 via Web Crypto) ---

function base64url(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlEncode(str: string): string {
  return base64url(new TextEncoder().encode(str));
}

async function generateMsbToken(env: MsbEnv): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    aud: 'msb-api',
    iss: env.MSB_CLUB_WEB_ID,
    iat: Math.floor(Date.now() / 1000),
  };

  const headerB64 = base64urlEncode(JSON.stringify(header));
  const payloadB64 = base64urlEncode(JSON.stringify(payload));
  const headerPayload = `${headerB64}.${payloadB64}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.MSB_SECRET_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(headerPayload));
  const signatureB64 = base64url(new Uint8Array(signature));

  return `${headerPayload}.${signatureB64}`;
}

// --- Fetch wrapper ---

async function msbFetch(
  env: MsbEnv,
  endpoint: string,
  params?: Record<string, string | number | undefined>
): Promise<any> {
  const token = await generateMsbToken(env);

  const url = new URL(`${MSB_BASE_URL}/${endpoint}`);
  url.searchParams.set('CWID', env.MSB_CLUB_WEB_ID);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MSB API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

// --- Typed wrapper functions ---

// Handicaps
export async function getHandicapList(env: MsbEnv): Promise<any> {
  return msbFetch(env, 'handicap_list.php');
}

// Player records
export async function getPlayerPlayRecord(env: MsbEnv, playerId: number): Promise<any> {
  return msbFetch(env, 'player_play_record.php', { PlayerID: playerId });
}

export async function getPlayerHandicapRecord(env: MsbEnv, playerId: number): Promise<any> {
  return msbFetch(env, 'player_hcap_record.php', { PlayerID: playerId });
}

export async function getPlayerScores(env: MsbEnv, playerId: number): Promise<any> {
  return msbFetch(env, 'player_scores.php', { PlayerID: playerId });
}

// Fixtures
export async function getFixtureList(env: MsbEnv): Promise<any> {
  return msbFetch(env, 'fixture_list.php');
}

// Live leaderboards
export async function getLiveLeaderboardList(env: MsbEnv): Promise<any> {
  return msbFetch(env, 'competitions_leaderboard_list.php');
}

export async function getLiveLeaderboard(
  env: MsbEnv,
  compId: number,
  reportId: number
): Promise<any> {
  return msbFetch(env, 'competition_leaderboard.php', {
    CompID: compId,
    ReportID: reportId,
  });
}

// Closed competitions
export async function getClosedCompetitionList(
  env: MsbEnv,
  opts?: { count?: number; offset?: number; gender?: string; date?: string }
): Promise<any> {
  return msbFetch(env, 'competitions_closed_list.php', {
    Count: opts?.count,
    Offset: opts?.offset,
    Gender: opts?.gender,
    Date: opts?.date,
  });
}

export async function getClosedCompetitionResult(
  env: MsbEnv,
  compId: number,
  reportId: number
): Promise<any> {
  return msbFetch(env, 'competition_closed_result.php', {
    CompID: compId,
    ReportID: reportId,
  });
}

// Best of series
export async function getBestOfList(env: MsbEnv): Promise<any> {
  return msbFetch(env, 'competitions_bestof_list.php');
}

export async function getBestOfResult(env: MsbEnv, compId: number): Promise<any> {
  return msbFetch(env, 'competition_bestof_result.php', { CompID: compId });
}

// Match play
export async function getMatchplayList(env: MsbEnv): Promise<any> {
  return msbFetch(env, 'competitions_matchplay_list.php');
}

export async function getMatchplayDraw(env: MsbEnv, compId: number): Promise<any> {
  return msbFetch(env, 'competition_matchplay_draw.php', { CompID: compId });
}

// Orders of merit
export async function getOrdersOfMeritList(env: MsbEnv): Promise<any> {
  return msbFetch(env, 'ordersofmerit_list.php');
}

export async function getOrderOfMerit(env: MsbEnv, meritId: number): Promise<any> {
  return msbFetch(env, 'orderofmerit.php', { MeritID: meritId });
}

// Eclectics
export async function getEclecticsList(env: MsbEnv): Promise<any> {
  return msbFetch(env, 'eclectics_list.php');
}

export async function getEclecticResult(
  env: MsbEnv,
  eclecticId: number,
  reportId: number
): Promise<any> {
  return msbFetch(env, 'eclectic_result.php', {
    EclecticID: eclecticId,
    ReportID: reportId,
  });
}

// --- Helpers ---

export function findPlayerByNationalId(
  handicapList: any,
  nationalId: string
): any | null {
  if (!handicapList?.Players || !nationalId) return null;
  return (
    handicapList.Players.find(
      (p: any) => p.NationalID === nationalId || p.nationalId === nationalId
    ) ?? null
  );
}

export function formatHandicap(hcap: number | string | null): string {
  if (hcap === null || hcap === undefined || hcap === '') return 'N/A';
  const num = typeof hcap === 'string' ? parseFloat(hcap) : hcap;
  if (isNaN(num)) return 'N/A';
  if (num < 0) return `+${Math.abs(num).toFixed(1)}`;
  return num.toFixed(1);
}
