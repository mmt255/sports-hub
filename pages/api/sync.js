import { runSync } from './fetch-events'

export const maxDuration = 300

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).end()
  }

  try {
    const result = await runSync(res)
    return res.status(200).json({ success: true, ...result })
  } catch (err) {
    console.error('[sync] Fatal error:', err)
    return res.status(500).json({ error: err.message })
  }
}
