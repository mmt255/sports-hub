/**
 * Cache layer: Upstash Redis in production, local file in development.
 *
 * SETUP (Vercel + Upstash):
 *   1. Vercel dashboard → Integrations → search "Upstash Redis" → Install
 *   2. Create a Redis database and link it to your project
 *   3. Vercel auto-injects KV_REST_API_URL + KV_REST_API_TOKEN
 *   4. Pull locally:  npx vercel env pull .env.local
 */

import fs from 'fs'
import path from 'path'

const CACHE_KEY  = 'sports_events_cache'
const LOCAL_FILE = path.join(process.cwd(), 'data', 'events-cache.json')
const EMPTY      = { last_updated: null, events: [] }

function hasRedis() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
}

async function getRedis() {
  const { Redis } = await import('@upstash/redis')
  return new Redis({
    url:   process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  })
}

export async function readCache() {
  console.log('[cache] hasRedis:', hasRedis(), '| KV_URL set:', !!process.env.KV_REST_API_URL, '| KV_TOKEN set:', !!process.env.KV_REST_API_TOKEN)
  if (hasRedis()) {
    try {
      const redis = await getRedis()
      let data = await redis.get(CACHE_KEY)
      console.log('[cache] raw type:', typeof data, '| null:', data === null, '| keys:', data && typeof data === 'object' ? Object.keys(data).join(',') : String(data).slice(0, 80))
      console.log('[cache] raw shape:', JSON.stringify(data).slice(0, 200))

      // Upstash may return an already-parsed object or a JSON string depending
      // on how the value was originally stored. Handle both.
      if (typeof data === 'string') {
        try { data = JSON.parse(data) } catch { return EMPTY }
      }

      if (!data || typeof data !== 'object') return EMPTY

      // If events is itself a JSON string (double-encoded), parse it too
      if (typeof data.events === 'string') {
        try { data.events = JSON.parse(data.events) } catch { data.events = [] }
      }

      console.log('[cache] resolved events count:', Array.isArray(data.events) ? data.events.length : 'not-array')
      return data
    } catch (err) {
      console.error('[cache] Redis read failed, falling back to file:', err.message)
    }
  }

  try {
    const raw = fs.readFileSync(LOCAL_FILE, 'utf-8')
    return JSON.parse(raw) ?? EMPTY
  } catch {
    return EMPTY
  }
}

export async function writeCache(data) {
  if (hasRedis()) {
    try {
      const redis = await getRedis()
      // No expiry — cron job refreshes daily
      await redis.set(CACHE_KEY, data)
      console.log('[cache] Wrote to Upstash Redis, events:', data.events?.length ?? 0)
      return
    } catch (err) {
      console.error('[cache] Redis write failed, falling back to file:', err.message)
    }
  }

  try {
    fs.writeFileSync(LOCAL_FILE, JSON.stringify(data, null, 2))
    console.log('[cache] Wrote to local file, events:', data.events?.length ?? 0)
  } catch (err) {
    console.error('[cache] File write failed:', err.message)
  }
}
