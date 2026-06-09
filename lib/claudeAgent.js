import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-sonnet-4-6'

// Shared output instruction appended to every sport prompt
const OUTPUT_RULES = `
[
  {
    "title": "event title",
    "sport": "SPORT_PLACEHOLDER",
    "date": "YYYY-MM-DD",
    "time_utc": "HH:MM",
    "competition": "competition name",
    "home_team": "team name or null",
    "away_team": "team name or null"
  }
]

Return only a raw JSON array, no explanation, no markdown, starting with [ and ending with ]`

// ─── Per-sport prompt builders ────────────────────────────────────────────────

function footballPrompt(from, to) {
  return `Today is ${from}. List football (soccer) matches between ${from} and ${to} (inclusive).

Include ONLY matches where at least one of these clubs is playing (all competitions):
  Manchester United, Manchester City, Arsenal, Liverpool, Chelsea,
  Real Madrid, Barcelona, Bayern München, Inter Milan, AC Milan,
  Juventus, Napoli, PSG

Also include these regardless of which clubs are playing:
  • FIFA World Cup — every match, every team
  • International friendlies where BOTH teams are top-20 FIFA ranked
  • Domestic cup finals only: FA Cup, Copa del Rey, Coppa Italia, DFB-Pokal, Coupe de France

sport field: "football"
competition field: exact league or competition name
${OUTPUT_RULES.replace('SPORT_PLACEHOLDER', 'football')}`
}

function f1Prompt(from, to) {
  return `Today is ${from}. List every Formula 1 session between ${from} and ${to} (inclusive).

Include ALL session types: Practice 1, Practice 2, Practice 3, Sprint Qualifying, Sprint Race, Qualifying, Grand Prix.
Title format: "F1 [Grand Prix Name] — [Session]"  e.g. "F1 British Grand Prix — Qualifying"

sport field: "f1"
competition field: "Formula 1"
${OUTPUT_RULES.replace('SPORT_PLACEHOLDER', 'f1')}`
}

function nbaPrompt(from, to) {
  return `Today is ${from}. List NBA games between ${from} and ${to} (inclusive).

Include ONLY: Playoffs (all rounds, all games), NBA Finals, All-Star Game, Play-In Tournament.
Exclude regular season games entirely.

sport field: "nba"
competition field: "NBA Playoffs" | "NBA Finals" | "NBA All-Star" | "NBA Play-In"
${OUTPUT_RULES.replace('SPORT_PLACEHOLDER', 'nba')}`
}

function ufcPrompt(from, to) {
  return `Today is ${from}. List UFC events between ${from} and ${to} (inclusive).

Include ONLY numbered UFC events: UFC 300, UFC 301, UFC 302, etc.
Exclude all UFC Fight Night events and all other MMA promotions.

sport field: "ufc"
competition field: "UFC"
${OUTPUT_RULES.replace('SPORT_PLACEHOLDER', 'ufc')}`
}

function tennisPrompt(from, to) {
  return `Today is ${from}. List tennis events between ${from} and ${to} (inclusive).

Include ONLY:
  • Grand Slams: Australian Open, Roland Garros, Wimbledon, US Open
  • ATP Finals, WTA Finals

For an active Grand Slam or Finals, add ONE entry per active day (not individual matches).
Title format: "Wimbledon 2026 — Day 4"

sport field: "tennis"
competition field: exact tournament name
${OUTPUT_RULES.replace('SPORT_PLACEHOLDER', 'tennis')}`
}

function lebaneseBBPrompt(from, to) {
  return `Today is ${from}. List Lebanese basketball games between ${from} and ${to} (inclusive).

Include ALL of:
  • Lebanese Basketball League — every match
  • Lebanon national basketball team — every match

For times: Beirut is UTC+3 in summer (EEST). A 19:00 Beirut tip-off = 16:00 UTC.
Provide real UTC times where known; use "TBD" only as last resort.

sport field: "lebanese_basketball"
competition field: "Lebanese Basketball League" | "Lebanon National Team"
${OUTPUT_RULES.replace('SPORT_PLACEHOLDER', 'lebanese_basketball')}`
}

// ─── Core API caller ──────────────────────────────────────────────────────────

async function callClaude(sport, prompt) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY })

  const tools = [{ type: 'web_search_20250305', name: 'web_search' }]
  let messages = [{ role: 'user', content: prompt }]
  let turns = 0
  const maxTurns = 10

  try {
    while (turns++ < maxTurns) {
      const resp = await client.messages.create({
        model: MODEL,
        max_tokens: 2000,
        tools,
        messages,
      })

      console.log(`[claude:${sport}] turn=${turns} stop_reason=${resp.stop_reason}`)

      if (resp.stop_reason === 'end_turn') {
        const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('')
        console.log(`[claude:${sport}] response start: ${text.slice(0, 120)}`)
        return text
      }

      if (resp.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: resp.content })
        const results = resp.content
          .filter(b => b.type === 'tool_use')
          .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: '' }))
        if (results.length) messages.push({ role: 'user', content: results })
        continue
      }

      // max_tokens or unexpected stop — return whatever text we have
      return resp.content.filter(b => b.type === 'text').map(b => b.text).join('')
    }
  } catch (err) {
    console.error(`[claude:${sport}] API call failed: ${err.message} | status: ${err.status ?? 'n/a'} | body: ${JSON.stringify(err.error ?? null)}`)
  }

  return ''
}

// ─── JSON parser ──────────────────────────────────────────────────────────────

function parseJSON(sport, text) {
  if (!text) return []
  const cleaned = text.replace(/```(?:json)?\n?/gi, '').trim()
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start === -1 || end === -1) {
    console.warn(`[claude:${sport}] no JSON array in response`)
    return []
  }
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch (err) {
    console.warn(`[claude:${sport}] JSON parse failed: ${err.message}`)
    console.warn(`[claude:${sport}] snippet: ${cleaned.slice(start, start + 200)}`)
    return []
  }
}

// ─── Normaliser ───────────────────────────────────────────────────────────────

function normalise(raw, index) {
  const ts = raw.time_utc && raw.time_utc !== 'TBD'
    ? new Date(`${raw.date}T${raw.time_utc}:00Z`).getTime()
    : new Date(`${raw.date}T12:00:00Z`).getTime()
  return {
    id: `claude-${raw.sport}-${index}-${raw.date}-${ts}`,
    title: raw.title,
    sport: raw.sport,
    competition: raw.competition || raw.sport,
    date: raw.date,
    time_utc: raw.time_utc || 'TBD',
    timestamp: ts,
    home_team: raw.home_team || null,
    away_team: raw.away_team || null,
    channels: [],
    source: 'claude',
    is_lebanese_basketball: raw.sport === 'lebanese_basketball',
  }
}

// ─── Public export ────────────────────────────────────────────────────────────

export async function fetchClaudeEvents(fromDate, toDate) {
  const sports = [
    { key: 'football',            prompt: footballPrompt(fromDate, toDate) },
    { key: 'f1',                  prompt: f1Prompt(fromDate, toDate) },
    { key: 'nba',                 prompt: nbaPrompt(fromDate, toDate) },
    { key: 'ufc',                 prompt: ufcPrompt(fromDate, toDate) },
    { key: 'tennis',              prompt: tennisPrompt(fromDate, toDate) },
    { key: 'lebanese_basketball', prompt: lebaneseBBPrompt(fromDate, toDate) },
  ]

  console.log(`[claude] running ${sports.length} sequential sport calls for ${fromDate}→${toDate}`)

  const counts = {}
  const allRaw = []

  for (let i = 0; i < sports.length; i++) {
    const { key, prompt } = sports[i]
    try {
      const text = await callClaude(key, prompt)
      const events = parseJSON(key, text)
      counts[key] = events.length
      allRaw.push(...events)
    } catch (err) {
      counts[key] = 0
      console.error(`[claude:${key}] failed: ${err.message}`)
    }
    // 1 second gap between calls to avoid rate limits
    if (i < sports.length - 1) await new Promise(r => setTimeout(r, 1000))
  }

  console.log('[claude] per-sport counts:', JSON.stringify(counts))

  // Deduplicate by title (lowercased) + date
  const seen = new Set()
  const deduped = allRaw.filter(e => {
    if (!e || !e.title || !e.date || !e.sport) return false
    const key = `${e.title.toLowerCase().trim()}|${e.date}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // Sort by date then time_utc
  deduped.sort((a, b) => {
    const dateCompare = (a.date || '').localeCompare(b.date || '')
    if (dateCompare !== 0) return dateCompare
    const at = (a.time_utc === 'TBD' ? '99:99' : a.time_utc) || '99:99'
    const bt = (b.time_utc === 'TBD' ? '99:99' : b.time_utc) || '99:99'
    return at.localeCompare(bt)
  })

  const events = deduped.map(normalise)
  console.log(`[claude] total after dedup: ${events.length}`)
  return events
}
