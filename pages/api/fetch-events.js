/**
 * /api/fetch-events — Vercel Cron job (06:00 UTC daily)
 *
 * Fetches all sports events via the Claude agent (web search),
 * enriches with broadcast channels, saves to cache, triggers ISR.
 *
 * REQUIRED ENV VARS:
 *   ANTHROPIC_KEY            — Anthropic API key
 *   CRON_SECRET              — any string; set in Vercel project settings
 *   UPSTASH_REDIS_REST_URL   — from Vercel Storage → Upstash Redis integration
 *   UPSTASH_REDIS_REST_TOKEN — same
 *
 * NOTE: api-sports.io free plan only has data up to season 2024 and is
 * therefore not used. Claude with web search covers all sports.
 */

// Tell Vercel this function can run up to 300 seconds (requires Pro plan)
export const maxDuration = 300

import { writeCache } from '../../lib/cache'
import { fetchClaudeEvents } from '../../lib/claudeAgent'
import { getFallbackChannels } from '../../lib/broadcast'

export async function runSync(res) {
  const now   = new Date()
  const from  = now.toISOString().slice(0, 10)
  const toD   = new Date(now)
  toD.setUTCDate(toD.getUTCDate() + 6)
  const to    = toD.toISOString().slice(0, 10)

  console.log(`[sync] Starting run for ${from} → ${to}`)

  const errors = []
  let events = []

  try {
    events = await fetchClaudeEvents(from, to)
    console.log(`[sync] Claude returned ${events.length} events`)
  } catch (err) {
    errors.push(`claude: ${err.message}`)
    console.error('[sync] Claude agent failed:', err.message)
  }

  // Assign broadcast channels synchronously from the hardcoded fallback table.
  // The async LiveSoccerTV scrape was exceeding Vercel Hobby's 10s limit and
  // preventing writeCache from ever being reached.
  const enriched = events.map(ev => ({ ...ev, channels: getFallbackChannels(ev) }))

  enriched.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))

  await writeCache({
    last_updated: new Date().toISOString(),
    events: enriched,
  })

  // Trigger ISR so the home page regenerates with fresh data
  if (res) {
    try {
      await res.revalidate('/')
      console.log('[sync] ISR revalidation triggered')
    } catch {
      // Not fatal — page regenerates on next visit or request
    }
  }

  return {
    from,
    to,
    counts: { total: enriched.length },
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
