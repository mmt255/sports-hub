import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-sonnet-4-20250514'
// Newer alias — API will use whichever is available
const MODEL_FALLBACK = 'claude-sonnet-4-6'

function buildPrompt(fromDate, toDate) {
  return `Today is ${fromDate}. Search the web and return upcoming sports events between ${fromDate} and ${toDate} (inclusive) in these three categories ONLY:

CATEGORY 1 — TENNIS:
- Grand Slams only: Australian Open, Roland Garros, Wimbledon, US Open
- ATP Finals, WTA Finals
- If a Grand Slam or Finals tournament is in progress or starting in this period, add ONE entry per active day
- Format: "Wimbledon 2026 — Day 4" (use the actual day number)
- sport field: "tennis"
- competition field: exact tournament name ("Wimbledon", "Roland Garros", "Australian Open", "US Open", "ATP Finals", "WTA Finals")

CATEGORY 2 — BOXING:
- World title fights ONLY: WBC, WBA, IBF, WBO championship belts
- Named fighters + belt in the title
- Format: "Canelo Alvarez vs David Benavidez — WBC Super Middleweight"
- sport field: "boxing"
- competition field: "Boxing World Title Fight"

CATEGORY 3 — LEBANESE BASKETBALL:
- Lebanese Basketball League: all games
- Lebanon national basketball team: all games
- sport field: "lebanese_basketball"
- competition field: "Lebanese Basketball League" or "Lebanon National Team"

Return ONLY a valid JSON array, no markdown, no explanation, no code blocks:
[
  {
    "title": "event title",
    "sport": "tennis|boxing|lebanese_basketball",
    "date": "YYYY-MM-DD",
    "time_utc": "HH:MM",
    "competition": "competition name",
    "home_team": null,
    "away_team": null
  }
]

If a time is unknown use "TBD". If you find no events in a category, omit that category entirely from the array. Return an empty array [] if you find nothing at all.`
}

async function callClaude(prompt, useWebSearch) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY })

  const requestBase = {
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  }

  // Try web search tool first (available on API plans that support it)
  if (useWebSearch) {
    requestBase.tools = [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 5,
      },
    ]
  }

  let messages = [...requestBase.messages]
  let maxTurns = 12

  // Try primary model, fall back to alias
  for (const model of [MODEL, MODEL_FALLBACK]) {
    try {
      while (maxTurns-- > 0) {
        const resp = await client.messages.create({ ...requestBase, model, messages })

        if (resp.stop_reason === 'end_turn') {
          return resp.content.filter(b => b.type === 'text').map(b => b.text).join('')
        }

        if (resp.stop_reason === 'tool_use') {
          // Continue the agentic loop
          messages.push({ role: 'assistant', content: resp.content })
          const results = resp.content
            .filter(b => b.type === 'tool_use')
            .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: '' }))
          if (results.length) messages.push({ role: 'user', content: results })
          continue
        }

        // max_tokens or other stop — extract whatever text we have
        return resp.content.filter(b => b.type === 'text').map(b => b.text).join('')
      }
      return ''
    } catch (err) {
      if (model === MODEL) {
        console.warn(`[claude] model ${MODEL} failed (${err.message}), trying fallback`)
        continue
      }
      throw err
    }
  }
  return ''
}

function parseJSON(text) {
  // Strip markdown fences if present
  const cleaned = text.replace(/```(?:json)?\n?/gi, '').trim()

  // Find first '[' and last ']'
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start === -1 || end === -1) return []

  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    console.warn('[claude] JSON parse failed, text snippet:', cleaned.slice(0, 200))
    return []
  }
}

export async function fetchClaudeEvents(fromDate, toDate) {
  const prompt = buildPrompt(fromDate, toDate)

  let rawText = ''
  try {
    // Attempt with web search
    rawText = await callClaude(prompt, true)
  } catch (err) {
    console.warn('[claude] web-search call failed, retrying without:', err.message)
    try {
      rawText = await callClaude(prompt, false)
    } catch (err2) {
      console.error('[claude] agent completely failed:', err2.message)
      return []
    }
  }

  const events = parseJSON(rawText)

  console.log(`[claude] returned ${events.length} raw events`)

  // Normalise and validate
  return events
    .filter(e => e && e.title && e.date && e.sport)
    .map((e, i) => ({
      id: `claude-${e.sport}-${i}-${e.date}`,
      title: e.title,
      sport: e.sport,
      competition: e.competition || e.sport,
      date: e.date,
      time_utc: e.time_utc || 'TBD',
      timestamp: e.time_utc && e.time_utc !== 'TBD'
        ? new Date(`${e.date}T${e.time_utc}:00Z`).getTime()
        : new Date(`${e.date}T12:00:00Z`).getTime(),
      home_team: e.home_team || null,
      away_team: e.away_team || null,
      channels: [],
      source: 'claude',
      is_lebanese_basketball: e.sport === 'lebanese_basketball',
    }))
}
