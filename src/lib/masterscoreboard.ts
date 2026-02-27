// Master Scoreboard API v1 client
// JWT-authenticated (HS256) via Web Crypto API — Cloudflare Workers compatible, no npm deps

const MSB_BASE_URL = 'https://www.masterscoreboard.co.uk/api/public/v1';

export interface MsbEnv {
  MSB_CWID: string;         // numeric club ID — used in URL params AND as JWT issuer
  MSB_SECRET_KEY: string;
}

export function isMsbConfigured(env: any): boolean {
  return !!(env?.MSB_CWID && env?.MSB_SECRET_KEY);
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
    iss: env.MSB_CWID,
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
  url.searchParams.set('CWID', env.MSB_CWID);

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
      'User-Agent': 'AVGC-CRM/1.0',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MSB API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return decodeHtmlEntities(data);
}

// MSB API returns HTML entities (e.g. &#163; for £) in string fields — decode them
function decodeHtmlEntities(value: any): any {
  if (typeof value === 'string') {
    return value.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
               .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
               .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  }
  if (Array.isArray(value)) return value.map(decodeHtmlEntities);
  if (value && typeof value === 'object') {
    const result: any = {};
    for (const key of Object.keys(value)) {
      result[key] = decodeHtmlEntities(value[key]);
    }
    return result;
  }
  return value;
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

// Start sheet
export async function getStartSheet(env: MsbEnv, compId: number): Promise<any> {
  return msbFetch(env, 'competition_start_sheet.php', { Comp_ID: compId });
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
  division: number = 0,
  gross: boolean = false
): Promise<any> {
  return msbFetch(env, 'competition_leaderboard.php', {
    Comp_ID: compId,
    Division: division,
    Gross: gross ? 'True' : 'False',
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
    Comp_ID: compId,
    ReportID: reportId,
  });
}

// Best of series
export async function getBestOfList(env: MsbEnv): Promise<any> {
  return msbFetch(env, 'competitions_bestof_list.php');
}

export async function getBestOfResult(env: MsbEnv, seriesId: number): Promise<any> {
  return msbFetch(env, 'competition_bestof_result.php', { Series_ID: seriesId });
}

// Match play
export async function getMatchplayList(env: MsbEnv): Promise<any> {
  return msbFetch(env, 'competitions_matchplay_list.php');
}

export async function getMatchplayDraw(env: MsbEnv, compId: number): Promise<any> {
  return msbFetch(env, 'competition_matchplay_draw.php', { Comp_ID: compId });
}

// Orders of merit
export async function getOrdersOfMeritList(env: MsbEnv): Promise<any> {
  return msbFetch(env, 'ordersofmerit_list.php');
}

export async function getOrderOfMerit(env: MsbEnv, seriesId: number): Promise<any> {
  return msbFetch(env, 'orderofmerit.php', { Series_ID: seriesId });
}

// Eclectics
export async function getEclecticsList(env: MsbEnv): Promise<any> {
  return msbFetch(env, 'eclectics_list.php');
}

export async function getEclecticResult(
  env: MsbEnv,
  eclecticId: number
): Promise<any> {
  return msbFetch(env, 'eclectic_result.php', {
    Eclectic_ID: eclecticId,
  });
}

// --- Helpers ---

export function findPlayerByNationalId(
  handicapList: any,
  nationalId: string
): any | null {
  const players = handicapList?.players || handicapList?.Players;
  if (!players || !nationalId) return null;
  return (
    players.find(
      (p: any) => p.nationalId === nationalId || p.NationalID === nationalId
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
