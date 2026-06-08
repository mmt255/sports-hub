import Anthropic from '@anthropic-ai/sdk'

// Use guaranteed-current model IDs
const MODELS = ['claude-opus-4-8', 'claude-sonnet-4-6']

function buildPrompt(fromDate, toDate) {
  return `Today is ${fromDate}. Search the web and return ALL upcoming sports events between ${fromDate} and ${toDate} (inclusive) across all seven categories below. Apply every filtering rule exactly as written.

━━ CATEGORY 1: FOOTBALL (Soccer) ━━
Include ONLY matches involving these clubs (all competitions, all stages):
  Manchester United — include EVERY match including friendlies and pre-season
  Manchester City, Arsenal, Liverpool, Chelsea,
  Real Madrid, Barcelona, Bayern München,
  Inter Milan, AC Milan, Juventus, Napoli, PSG

Also include regardless of which clubs are playing:
  • FIFA World Cup — ALL matches, ALL teams
  • International friendlies where BOTH teams are top-20 FIFA ranked
  • Domestic cup FINALS only: FA Cup, Copa del Rey, Coppa Italia, DFB-Pokal, Coupe de France

sport field: "football"
competition field: league name (e.g. "Premier League", "Champions League", "FIFA World Cup")

━━ CATEGORY 2: FORMULA 1 ━━
Include ALL session types: Practice 1, Practice 2, Practice 3, Sprint Qualifying, Sprint Race, Qualifying, Grand Prix
Format: "F1 [Grand Prix Name] — [Session]"   e.g. "F1 Canadian Grand Prix — Practice 1"
sport field: "f1"
competition field: "Formula 1"

━━ CATEGORY 3: NBA ━━
Include ONLY: All-Star Game, Playoffs (all rounds, all games), Finals, Play-In games
Exclude regular season entirely.
sport field: "nba"
competition field: "NBA Playoffs" or "NBA Finals" or "NBA All-Star"

━━ CATEGORY 4: UFC ━━
Include ONLY numbered UFC events: UFC 300, UFC 301, UFC 302, etc.
Exclude all UFC Fight Night events.
sport field: "ufc"
competition field: "UFC"

━━ CATEGORY 5: TENNIS ━━
Include ONLY: Grand Slams (Australian Open, Roland Garros, Wimbledon, US Open) and ATP Finals, WTA Finals
If a tournament is active during this period, add ONE entry per active day.
Format: "Wimbledon 2026 — Day 4"
sport field: "tennis"
competition field: exact tournament name

━━ CATEGORY 6: BOXING ━━
Include ONLY world title fights: WBC, WBA, IBF, WBO championship belts
Include fighter names and belt in the title.
Format: "Canelo Alvarez vs David Benavidez — WBC Super Middleweight"
sport field: "boxing"
competition field: "Boxing World Title Fight"

━━ CATEGORY 7: LEBANESE BASKETBALL ━━
Include ALL Lebanese Basketball League games and Lebanon national team games.
sport field: "lebanese_basketball"
competition field: "Lebanese Basketball League" or "Lebanon National Team"

━━ OUTPUT FORMAT ━━
Return ONLY a valid JSON array. No markdown, no code fences, no explanation, no prose.
If a time is unknown use "TBD". Return [] if you find nothing.

[
  {
    "title": "event title",
    "sport": "football|f1|nba|ufc|tennis|boxing|lebanese_basketball",
    "date": "YYYY-MM-DD",
    "time_utc": "HH:MM",
    "competition": "competition name",
    "home_team": "team name or null",
    "away_team": "team name or null"
  }
]`
}

async function callClaude(model, prompt, useWebSearch) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY })

  const toolSpec = useWebSearch
    ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }]
    : undefined

  let messages = [{ role: 'user', content: prompt }]
  let maxTurns = 15

  while (maxTurns-- > 0) {
    const resp = await client.messages.create({
      model,
      max_tokens: 8000,
      ...(toolSpec ? { tools: toolSpec } : {}),
      messages,
    })

    console.log(`[claude] model=${model} stop_reason=${resp.stop_reason} content_blocks=${resp.content.length}`)

    if (resp.stop_reason === 'end_turn') {
      const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('')
      console.log('[claude] raw response (first 500 chars):', text.slice(0, 500))
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

    // max_tokens or other — extract whatever text we have
    return resp.content.filter(b => b.type === 'text').map(b => b.text).join('')
  }

  return ''
}

function parseJSON(text) {
  const cleaned = text.replace(/```(?:json)?\n?/gi, '').trim()
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start === -1 || end === -1) {
    console.warn('[claude] no JSON array found in response')
    return []
  }
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch (err) {
    console.warn('[claude] JSON parse failed:', err.message)
    console.warn('[claude] attempted to parse:', cleaned.slice(start, start + 300))
    return []
  }
}

export async function fetchClaudeEvents(fromDate, toDate) {
  const prompt = buildPrompt(fromDate, toDate)
  let rawText = ''

  // Try each model; within each model try with and without web search
  for (const model of MODELS) {
    for (const useWebSearch of [true, false]) {
      try {
        console.log(`[claude] trying model=${model} webSearch=${useWebSearch}`)
        rawText = await callClaude(model, prompt, useWebSearch)
        if (rawText) break
      } catch (err) {
        console.warn(`[claude] model=${model} webSearch=${useWebSearch} failed:`, err.message)
      }
    }
    if (rawText) break
  }

  if (!rawText) {
    console.error('[claude] all attempts failed, returning empty')
    return []
  }

  const events = parseJSON(rawText)
  console.log(`[claude] parsed ${events.length} raw events`)

  return events
    .filter(e => e && e.title && e.date && e.sport)
    .map((e, i) => {
      const ts = e.time_utc && e.time_utc !== 'TBD'
        ? new Date(`${e.date}T${e.time_utc}:00Z`).getTime()
        : new Date(`${e.date}T12:00:00Z`).getTime()
      return {
        id: `claude-${e.sport}-${i}-${e.date}-${ts}`,
        title: e.title,
        sport: e.sport,
        competition: e.competition || e.sport,
        date: e.date,
        time_utc: e.time_utc || 'TBD',
        timestamp: ts,
        home_team: e.home_team || null,
        away_team: e.away_team || null,
        channels: [],
        source: 'claude',
        is_lebanese_basketball: e.sport === 'lebanese_basketball',
      }
    })
}
