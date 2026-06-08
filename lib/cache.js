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
  if (hasRedis()) {
    try {
      const redis = await getRedis()
      const data  = await redis.get(CACHE_KEY)
      return data ?? EMPTY
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
