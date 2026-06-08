/**
 * /api/debug — one-shot diagnostics. Shows env var presence, API
 * connectivity, and a raw sample response from each source so you can
 * see exactly where the zeros come from.
 *
 * Hit: GET /api/debug
 * Remove this file once you've diagnosed the problem.
 */

const APISPORTS_KEY = process.env.APISPORTS_KEY

async function probe(label, url, headers = {}) {
  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10000),
    })
    const body = await res.json().catch(() => null)
    return {
      ok: res.ok,
      status: res.status,
      results: body?.results ?? null,
      errors: body?.errors ?? null,
      // First item of response array (or raw body if no .response field)
      sample: body?.response?.[0] ?? (Array.isArray(body) ? body[0] : body),
    }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

export default async function handler(req, res) {
  const today = new Date().toISOString().slice(0, 10)
  const to    = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  const year  = new Date().getUTCFullYear()
  const month = new Date().getUTCMonth() + 1
  const footballSeason = month >= 7 ? year : year - 1
  const nbaSeason      = month >= 10 ? year : year - 1

  const apiHdr = { 'x-apisports-key': APISPORTS_KEY ?? '' }

  const [
    apiStatus,
    worldCup,
    premierLeague,
    f1,
    nba,
    mma,
  ] = await Promise.all([
    // Account status — tells us if the key is valid and how many requests remain
    probe('api-status',
      'https://v3.football.api-sports.io/status',
      apiHdr),

    // World Cup 2026
    probe('world-cup',
      `https://v3.football.api-sports.io/fixtures?league=1&season=${year}&from=${today}&to=${to}&timezone=UTC`,
      apiHdr),

    // Premier League (quickest sanity check for team filtering)
    probe('premier-league',
      `https://v3.football.api-sports.io/fixtures?league=39&season=${footballSeason}&from=${today}&to=${to}&timezone=UTC`,
      apiHdr),

    // F1 races
    probe('f1',
      `https://v1.formula-1.api-sports.io/races?season=${year}&timezone=UTC`,
      { 'x-apisports-key': APISPORTS_KEY ?? '' }),

    // NBA games (one day as a representative check)
    probe('nba',
      `https://v2.nba.api-sports.io/games?season=${nbaSeason}&date=${today}`,
      { 'x-apisports-key': APISPORTS_KEY ?? '' }),

    // MMA events
    probe('mma',
      `https://v1.mma.api-sports.io/events?season=${year}`,
      { 'x-apisports-key': APISPORTS_KEY ?? '' }),
  ])

  return res.status(200).json({
    computed: { today, to, year, footballSeason, nbaSeason },
    env: {
      APISPORTS_KEY:           !!process.env.APISPORTS_KEY,
      ANTHROPIC_KEY:           !!process.env.ANTHROPIC_KEY,
      UPSTASH_REDIS_REST_URL:  !!process.env.UPSTASH_REDIS_REST_URL,
      UPSTASH_REDIS_REST_TOKEN:!!process.env.UPSTASH_REDIS_REST_TOKEN,
      CRON_SECRET:             !!process.env.CRON_SECRET,
    },
    api_sports: {
      account_status: apiStatus,
      world_cup_2026: worldCup,
      premier_league: premierLeague,
      f1,
      nba,
      mma,
    },
  })
}
