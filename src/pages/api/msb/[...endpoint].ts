// Catch-all proxy for Master Scoreboard API
// Forwards client-side requests through server-side JWT-authenticated client
// Leaderboard endpoints are public; player endpoints require member auth; others require member auth

import type { APIRoute } from 'astro';
import {
  isMsbConfigured,
  getHandicapList,
  getPlayerPlayRecord,
  getPlayerHandicapRecord,
  getPlayerScores,
  getFixtureList,
  getLiveLeaderboardList,
  getLiveLeaderboard,
  getClosedCompetitionList,
  getClosedCompetitionResult,
  getBestOfList,
  getBestOfResult,
  getMatchplayList,
  getMatchplayDraw,
  getOrdersOfMeritList,
  getOrderOfMerit,
  getEclecticsList,
  getEclecticResult,
  type MsbEnv,
} from '../../../lib/masterscoreboard';

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function err(message: string, status = 400) {
  return json({ error: message }, status);
}

export const GET: APIRoute = async ({ params, url, locals }) => {
  const env = (locals as any).runtime?.env;

  if (!isMsbConfigured(env)) {
    return err('Master Scoreboard not configured', 503);
  }

  const msbEnv: MsbEnv = {
    MSB_CLUB_WEB_ID: env.MSB_CLUB_WEB_ID,
    MSB_SECRET_KEY: env.MSB_SECRET_KEY,
  };

  const endpoint = params.endpoint || '';
  const parts = endpoint.split('/');
  const member = (locals as any).member;

  // Public endpoints (no auth required) — for clubhouse leaderboard display
  const isPublicEndpoint = parts[0] === 'leaderboard';

  // All other endpoints require member auth
  if (!isPublicEndpoint && !member) {
    return err('Authentication required', 401);
  }

  try {
    let data: any;

    switch (parts[0]) {
      // GET /api/msb/handicap-list
      case 'handicap-list':
        data = await getHandicapList(msbEnv);
        break;

      // GET /api/msb/player/:playerId/play-record
      // GET /api/msb/player/:playerId/handicap-record
      // GET /api/msb/player/:playerId/scores
      case 'player': {
        const playerId = parseInt(parts[1], 10);
        if (isNaN(playerId)) return err('Invalid player ID');

        const sub = parts[2];
        if (sub === 'play-record') {
          data = await getPlayerPlayRecord(msbEnv, playerId);
        } else if (sub === 'handicap-record') {
          data = await getPlayerHandicapRecord(msbEnv, playerId);
        } else if (sub === 'scores') {
          data = await getPlayerScores(msbEnv, playerId);
        } else {
          return err('Unknown player endpoint', 404);
        }
        break;
      }

      // GET /api/msb/fixtures
      case 'fixtures':
        data = await getFixtureList(msbEnv);
        break;

      // GET /api/msb/leaderboard
      // GET /api/msb/leaderboard/:compId/:reportId
      case 'leaderboard':
        if (parts.length >= 3) {
          const compId = parseInt(parts[1], 10);
          const reportId = parseInt(parts[2], 10);
          if (isNaN(compId) || isNaN(reportId)) return err('Invalid competition or report ID');
          data = await getLiveLeaderboard(msbEnv, compId, reportId);
        } else {
          data = await getLiveLeaderboardList(msbEnv);
        }
        break;

      // GET /api/msb/results?count=&offset=&gender=&date=
      // GET /api/msb/results/:compId/:reportId
      case 'results':
        if (parts.length >= 3) {
          const compId = parseInt(parts[1], 10);
          const reportId = parseInt(parts[2], 10);
          if (isNaN(compId) || isNaN(reportId)) return err('Invalid competition or report ID');
          data = await getClosedCompetitionResult(msbEnv, compId, reportId);
        } else {
          const count = url.searchParams.get('count');
          const offset = url.searchParams.get('offset');
          const gender = url.searchParams.get('gender');
          const date = url.searchParams.get('date');
          data = await getClosedCompetitionList(msbEnv, {
            count: count ? parseInt(count, 10) : undefined,
            offset: offset ? parseInt(offset, 10) : undefined,
            gender: gender || undefined,
            date: date || undefined,
          });
        }
        break;

      // GET /api/msb/bestof
      // GET /api/msb/bestof/:compId
      case 'bestof':
        if (parts.length >= 2 && parts[1]) {
          const compId = parseInt(parts[1], 10);
          if (isNaN(compId)) return err('Invalid competition ID');
          data = await getBestOfResult(msbEnv, compId);
        } else {
          data = await getBestOfList(msbEnv);
        }
        break;

      // GET /api/msb/matchplay
      // GET /api/msb/matchplay/:compId
      case 'matchplay':
        if (parts.length >= 2 && parts[1]) {
          const compId = parseInt(parts[1], 10);
          if (isNaN(compId)) return err('Invalid competition ID');
          data = await getMatchplayDraw(msbEnv, compId);
        } else {
          data = await getMatchplayList(msbEnv);
        }
        break;

      // GET /api/msb/merit
      // GET /api/msb/merit/:meritId
      case 'merit':
        if (parts.length >= 2 && parts[1]) {
          const meritId = parseInt(parts[1], 10);
          if (isNaN(meritId)) return err('Invalid merit ID');
          data = await getOrderOfMerit(msbEnv, meritId);
        } else {
          data = await getOrdersOfMeritList(msbEnv);
        }
        break;

      // GET /api/msb/eclectics
      // GET /api/msb/eclectics/:eclecticId/:reportId
      case 'eclectics':
        if (parts.length >= 3) {
          const eclecticId = parseInt(parts[1], 10);
          const reportId = parseInt(parts[2], 10);
          if (isNaN(eclecticId) || isNaN(reportId)) return err('Invalid eclectic or report ID');
          data = await getEclecticResult(msbEnv, eclecticId, reportId);
        } else {
          data = await getEclecticsList(msbEnv);
        }
        break;

      default:
        return err('Unknown endpoint', 404);
    }

    return json(data);
  } catch (error) {
    console.error('MSB API error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return err(message, 502);
  }
};
