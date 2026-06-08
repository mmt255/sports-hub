/**
 * /api/fetch-events  — daily cron job (06:00 UTC via Vercel Cron)
 *
 * Fetches events from:
 *   1. API-Sports (Football, Formula-1, NBA, MMA/UFC)
 *   2. Claude agent (Tennis, Boxing, Lebanese Basketball)
 *   3. LiveSoccerTV (broadcast channel lookup per event)
 *
 * Saves result to Vercel KV (production) or data/events-cache.json (dev).
 * Then triggers On-Demand ISR so the home page regenerates immediately.
 *
 * REQUIRED ENV VARS:
 *   APISPORTS_KEY        — api-sports.io API key
 *   ANTHROPIC_KEY        — Anthropic API key
 *   CRON_SECRET          — set in Vercel project settings (auto-used by Vercel Cron)
 *   KV_REST_API_URL      — auto-injected when you create a Vercel KV database
 *   KV_REST_API_TOKEN    — auto-injected when you create a Vercel KV database
 *   REVALIDATE_SECRET    — any random string; used for ISR revalidation
 */

// Tell Vercel this function can run up to 300 seconds (requires Pro plan)
export const maxDuration = 300

import { writeCache } from '../../lib/cache'
import { fetchClaudeEvents } from '../../lib/claudeAgent'
import { getBroadcastChannels, getFallbackChannels } from '../../lib/broadcast'
import {
  FOOTBALL_TEAM_IDS,
  FOOTBALL_TEAM_ALIASES,
  FOOTBALL_LEAGUES,
  OPEN_LEAGUES,
  CUP_LEAGUES,
  ALL_FOOTBALL_LEAGUES,
  TOP_FIFA_NATIONS,
  NBA_PLAYOFF_KEYWORDS,
  UFC_NUMBERED_RE,
} from '../../data/curation-rules'

const API_KEY = process.env.APISPORTS_KEY

// ─── Date helpers ─────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10)
}

function dateStr(offsetDays) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

function currentYear() {
  return new Date().getUTCFullYear()
}

function footballSeason() {
  const m = new Date().getUTCMonth() + 1
  return m >= 7 ? currentYear() : currentYear() - 1
}

function nbaSeason() {
  const m = new Date().getUTCMonth() + 1
  return m >= 10 ? currentYear() : currentYear() - 1
}

// ─── API-Sports base fetcher ───────────────────────────────────────────────────

async function apiSports(subdomain, endpoint, params = {}) {
  const url = new URL(`https://${subdomain}/${endpoint}`)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)))

  try {
    const res = await fetch(url.toString(), {
      headers: { 'x-apisports-key': API_KEY },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      console.warn(`[api-sports] ${subdomain}/${endpoint} HTTP ${res.status}`)
      return null
    }
    const json = await res.json()
    if (json.errors && Object.keys(json.errors).length) {
      console.warn(`[api-sports] ${endpoint} error:`, JSON.stringify(json.errors))
    }
    return json
  } catch (err) {
    console.error(`[api-sports] ${subdomain}/${endpoint} fetch error:`, err.message)
    return null
  }
}

// ─── Normalisers ──────────────────────────────────────────────────────────────

function canonicalTeamName(name) {
  if (!name) return name
  return FOOTBALL_TEAM_ALIASES[name.toLowerCase()] || name
}

function isWantedTeam(teamId, teamName) {
  if (FOOTBALL_TEAM_IDS.has(teamId)) return true
  const alias = canonicalTeamName(teamName)
  return FOOTBALL_TEAM_IDS.has(alias?.id)
}

function isCupFinal(roundStr) {
  if (!roundStr) return false
  const r = roundStr.toLowerCase()
  return r.includes('final') && !r.includes('semi') && !r.includes('quarter')
}

function isFriendlyBetweenTopNations(home, away) {
  return (
    TOP_FIFA_NATIONS.has(home.toLowerCase()) &&
    TOP_FIFA_NATIONS.has(away.toLowerCase())
  )
}

// ─── Football ─────────────────────────────────────────────────────────────────

async function fetchFootball(from, to) {
  const season = footballSeason()
  const events = []

  // World Cup uses current year regardless of season logic
  const wcSeason = currentYear()

  const leagueSeasons = ALL_FOOTBALL_LEAGUES.map(leagueId =>
    leagueId === FOOTBALL_LEAGUES.world_cup
      ? [leagueId, wcSeason]
      : [leagueId, season]
  )

  // Fetch all leagues in parallel
  const results = await Promise.all(
    leagueSeasons.map(([leagueId, s]) =>
      apiSports('v3.football.api-sports.io', 'fixtures', {
        league: leagueId,
        season: s,
        from,
        to,
        timezone: 'UTC',
      })
    )
  )

  let fetched = 0
  let included = 0
  let excluded = 0

  for (let i = 0; i < leagueSeasons.length; i++) {
    const [leagueId] = leagueSeasons[i]
    const data = results[i]
    if (!data?.response) continue

    for (const f of data.response) {
      fetched++
      const fixture   = f.fixture
      const league    = f.league
      const homeTeam  = f.teams?.home
      const awayTeam  = f.teams?.away

      if (!fixture || !homeTeam || !awayTeam) continue

      // Skip postponed / cancelled
      const status = fixture.status?.short
      if (['CANC', 'AWD', 'ABD', 'WO', 'INT'].includes(status)) {
        excluded++
        continue
      }

      const homeId   = homeTeam.id
      const awayId   = awayTeam.id
      const homeName = homeTeam.name
      const awayName = awayTeam.name
      const round    = league.round || ''

      const inCupLeague  = CUP_LEAGUES.has(leagueId)
      const isWorldCup   = leagueId === FOOTBALL_LEAGUES.world_cup
      const isFriendly   = leagueId === FOOTBALL_LEAGUES.int_friendlies
      const hasWantedTeam = isWantedTeam(homeId, homeName) || isWantedTeam(awayId, awayName)

      let include = false

      if (isWorldCup) {
        include = true
      } else if (isFriendly) {
        include = hasWantedTeam || isFriendlyBetweenTopNations(homeName, awayName)
      } else if (inCupLeague) {
        // Include cup finals regardless of teams, or if a wanted team is playing
        include = isCupFinal(round) || hasWantedTeam
      } else {
        include = hasWantedTeam
      }

      if (!include) {
        excluded++
        continue
      }

      included++
      const kickoff = new Date(fixture.date)
      const dateOnly = kickoff.toISOString().slice(0, 10)
      const timeUTC  = kickoff.toISOString().slice(11, 16)

      events.push({
        id: `football-${fixture.id}`,
        title: `${homeName} vs ${awayName}`,
        sport: 'football',
        competition: league.name || 'Football',
        date: dateOnly,
        time_utc: timeUTC,
        timestamp: kickoff.getTime(),
        home_team: homeName,
        away_team: awayName,
        channels: [],
        source: 'api-sports',
        is_lebanese_basketball: false,
      })
    }
  }

  console.log(`[football] fetched=${fetched} included=${included} excluded=${excluded}`)
  return events
}

// ─── Formula-1 ────────────────────────────────────────────────────────────────

const F1_SESSION_LABELS = {
  'Race':              'Grand Prix',
  'Qualifying':        'Qualifying',
  'Sprint':            'Sprint Race',
  'Sprint Qualifying': 'Sprint Qualifying',
  'Practice 1':        'Practice 1',
  'Practice 2':        'Practice 2',
  'Practice 3':        'Practice 3',
}

async function fetchF1(from, to) {
  const season = currentYear()
  const data = await apiSports('v1.formula-1.api-sports.io', 'races', { season, timezone: 'UTC' })
  if (!data?.response) return []

  const events = []

  for (const race of data.response) {
    const raceName    = race.competition?.name || 'F1 Race'
    const circuitCity = race.circuit?.location?.city || ''

    // Each race has multiple sessions as sub-objects
    const sessions = {
      'Practice 1':        race.practice1,
      'Practice 2':        race.practice2,
      'Practice 3':        race.practice3,
      'Qualifying':        race.qualifying,
      'Sprint Qualifying': race.sprint_qualifying,
      'Sprint':            race.sprint,
      'Race':              race.race,
    }

    for (const [sessionName, session] of Object.entries(sessions)) {
      if (!session?.date || !session?.time) continue

      const sessionDateTime = `${session.date}T${session.time}`
      const dt = new Date(sessionDateTime)
      const dateOnly = dt.toISOString().slice(0, 10)

      // Only include sessions in our window
      if (dateOnly < from || dateOnly > to) continue

      const label = F1_SESSION_LABELS[sessionName] || sessionName
      const title = `F1 ${raceName} — ${label}`
      const timeUTC = dt.toISOString().slice(11, 16)

      events.push({
        id: `f1-${race.id}-${sessionName.replace(/\s+/g, '_')}`,
        title,
        sport: 'f1',
        competition: 'Formula 1',
        date: dateOnly,
        time_utc: timeUTC,
        timestamp: dt.getTime(),
        home_team: null,
        away_team: null,
        channels: [],
        source: 'api-sports',
        is_lebanese_basketball: false,
        detail: circuitCity,
      })
    }
  }

  console.log(`[f1] events in window: ${events.length}`)
  return events
}

// ─── NBA ──────────────────────────────────────────────────────────────────────

async function fetchNBA(from, to) {
  const season = nbaSeason()
  const data = await apiSports('v2.nba.api-sports.io', 'games', {
    season,
    date: from, // Many NBA endpoints accept a date range
  })

  // The NBA API might need per-day fetching; collect unique days
  const days = []
  const start = new Date(from + 'T00:00:00Z')
  const end   = new Date(to   + 'T00:00:00Z')
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10))
  }

  const results = await Promise.all(
    days.map(day => apiSports('v2.nba.api-sports.io', 'games', { season, date: day }))
  )

  const events = []
  const seen = new Set()

  for (const data of results) {
    if (!data?.response) continue

    for (const game of data.response) {
      const gameId = game.id
      if (seen.has(gameId)) continue

      // Only playoffs / finals / all-star / play-in
      const stage = (game.stage || game.league?.name || '').toLowerCase()
      const isWanted = NBA_PLAYOFF_KEYWORDS.some(kw => stage.includes(kw))
      if (!isWanted) continue

      seen.add(gameId)

      const startDate = game.date?.start
      if (!startDate) continue

      const dt       = new Date(startDate)
      const dateOnly = dt.toISOString().slice(0, 10)
      const timeUTC  = dt.toISOString().slice(11, 16)
      const home     = game.teams?.home?.name || 'Home'
      const away     = game.teams?.visitors?.name || 'Away'

      events.push({
        id: `nba-${gameId}`,
        title: `${home} vs ${away}`,
        sport: 'nba',
        competition: game.league?.name || 'NBA',
        date: dateOnly,
        time_utc: timeUTC,
        timestamp: dt.getTime(),
        home_team: home,
        away_team: away,
        channels: [],
        source: 'api-sports',
        is_lebanese_basketball: false,
      })
    }
  }

  console.log(`[nba] playoff/finals/all-star games: ${events.length}`)
  return events
}

// ─── MMA / UFC ────────────────────────────────────────────────────────────────

async function fetchMMA(from, to) {
  const season = currentYear()
  const data = await apiSports('v1.mma.api-sports.io', 'events', { season })
  if (!data?.response) return []

  const events = []

  for (const event of data.response) {
    const name = event.name || ''
    if (!UFC_NUMBERED_RE.test(name)) continue

    const eventDate = event.date
    if (!eventDate) continue

    const dateOnly = eventDate.slice(0, 10)
    if (dateOnly < from || dateOnly > to) continue

    const dt      = new Date(eventDate)
    const timeUTC = dt.toISOString().slice(11, 16)

    events.push({
      id: `ufc-${event.id}`,
      title: name,
      sport: 'ufc',
      competition: 'UFC MMA',
      date: dateOnly,
      time_utc: timeUTC,
      timestamp: dt.getTime(),
      home_team: null,
      away_team: null,
      channels: [],
      source: 'api-sports',
      is_lebanese_basketball: false,
    })
  }

  console.log(`[mma] numbered UFC events in window: ${events.length}`)
  return events
}

// ─── Broadcast enrichment ─────────────────────────────────────────────────────

async function enrichBroadcasts(events) {
  // Process in batches of 5 to avoid hammering LiveSoccerTV
  const enriched = []
  const batchSize = 5

  for (let i = 0; i < events.length; i += batchSize) {
    const batch = events.slice(i, i + batchSize)
    const resolved = await Promise.all(
      batch.map(async ev => {
        try {
          const channels = await getBroadcastChannels(ev)
          return { ...ev, channels }
        } catch {
          return { ...ev, channels: getFallbackChannels(ev) }
        }
      })
    )
    enriched.push(...resolved)
    // Small rate-limit pause between batches
    if (i + batchSize < events.length) {
      await new Promise(r => setTimeout(r, 500))
    }
  }

  return enriched
}

// ─── Core sync logic (shared by /api/fetch-events and /api/sync) ─────────────

export async function runSync(res) {
  const from = today()
  const to   = dateStr(6)

  console.log(`[sync] Starting run for ${from} → ${to}`)

  const settled = await Promise.allSettled([
    fetchFootball(from, to),
    fetchF1(from, to),
    fetchNBA(from, to),
    fetchMMA(from, to),
  ])

  const [football, f1, nba, mma] = settled.map(r =>
    r.status === 'fulfilled' ? r.value : []
  )

  const errors = []
  settled.forEach((r, i) => {
    if (r.status === 'rejected') {
      const label = ['football', 'f1', 'nba', 'mma'][i]
      errors.push(`${label}: ${r.reason?.message ?? r.reason}`)
      console.error(`[sync] ${label} fetch failed:`, r.reason)
    }
  })

  let claudeEvents = []
  try {
    claudeEvents = await fetchClaudeEvents(from, to)
  } catch (err) {
    errors.push(`claude: ${err.message}`)
    console.error('[sync] Claude agent failed:', err.message)
  }

  const allEvents = [...football, ...f1, ...nba, ...mma, ...claudeEvents]
  allEvents.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))

  console.log(`[sync] Total before broadcast enrichment: ${allEvents.length}`)

  const enriched = await enrichBroadcasts(allEvents)

  await writeCache({
    last_updated: new Date().toISOString(),
    events: enriched,
  })

  try {
    await res.revalidate('/')
    console.log('[sync] ISR revalidation triggered')
  } catch {
    // Not fatal — page regenerates on next visit
  }

  return {
    from,
    to,
    counts: {
      football: football.length,
      f1: f1.length,
      nba: nba.length,
      mma: mma.length,
      claude: claudeEvents.length,
      total: enriched.length,
    },
    ...(errors.length ? { errors } : {}),
  }
}

// ─── Cron handler (requires CRON_SECRET) ─────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).end()
  }

  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.authorization || ''
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }

  try {
    const result = await runSync(res)
    return res.status(200).json({ success: true, ...result })
  } catch (err) {
    console.error('[fetch-events] Fatal error:', err)
    return res.status(500).json({ error: err.message })
  }
}
