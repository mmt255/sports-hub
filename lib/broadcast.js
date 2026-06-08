import * as cheerio from 'cheerio'

// Hardcoded fallback table: competition name (lowercase) → channels
const FALLBACK_TABLE = {
  'uefa champions league':        ['BeIN Sports 1', 'TNT Sports 1', 'DAZN'],
  'champions league':             ['BeIN Sports 1', 'TNT Sports 1', 'DAZN'],
  'uefa europa league':           ['BeIN Sports 2', 'TNT Sports 2', 'DAZN'],
  'europa league':                ['BeIN Sports 2', 'TNT Sports 2', 'DAZN'],
  'premier league':               ['BeIN Sports 1', 'Sky Sports Main Event', 'Sky Sports Premier League', 'NBC Sports'],
  'english premier league':       ['BeIN Sports 1', 'Sky Sports Main Event', 'Sky Sports Premier League'],
  'la liga':                      ['BeIN Sports 2', 'Sky Sports LaLiga', 'DAZN'],
  'serie a':                      ['BeIN Sports 3', 'Sky Sports Italy', 'DAZN'],
  'bundesliga':                   ['BeIN Sports Max', 'Sky Sports Germany', 'DAZN'],
  '1. bundesliga':                ['BeIN Sports Max', 'Sky Sports Germany', 'DAZN'],
  'ligue 1':                      ['BeIN Sports 1', 'Sky Sports', 'DAZN'],
  'fa cup':                       ['BeIN Sports 1', 'BBC One', 'ITV'],
  'copa del rey':                 ['BeIN Sports 2', 'DAZN'],
  'coppa italia':                 ['BeIN Sports 3', 'DAZN'],
  'dfb-pokal':                    ['BeIN Sports Max', 'DAZN'],
  'coupe de france':              ['BeIN Sports 1', 'DAZN'],
  'fifa world cup':               ['BeIN Sports 1', 'BBC One', 'ITV', 'Fox Sports'],
  'world cup':                    ['BeIN Sports 1', 'BBC One', 'ITV', 'Fox Sports'],
  'club world cup':               ['BeIN Sports 1', 'DAZN', 'TNT Sports'],
  'formula 1':                    ['BeIN Sports 1', 'Sky Sports F1', 'ESPN F1'],
  'formula-1':                    ['BeIN Sports 1', 'Sky Sports F1', 'ESPN F1'],
  'f1':                           ['BeIN Sports 1', 'Sky Sports F1', 'ESPN F1'],
  'nba':                          ['BeIN Sports 2', 'ESPN', 'ABC'],
  'nba playoffs':                 ['BeIN Sports 2', 'ESPN', 'ABC'],
  'nba finals':                   ['BeIN Sports 2', 'ESPN', 'ABC'],
  'ufc':                          ['BeIN Sports 3', 'ESPN+'],
  'ufc mma':                      ['BeIN Sports 3', 'ESPN+'],
  'wimbledon':                    ['BeIN Sports 4', 'BBC One', 'ESPN'],
  'roland garros':                ['BeIN Sports 4', 'ITV', 'NBC Sports'],
  'french open':                  ['BeIN Sports 4', 'ITV', 'NBC Sports'],
  'australian open':              ['BeIN Sports 4', 'Eurosport', 'ESPN'],
  'us open':                      ['BeIN Sports 4', 'Amazon Prime', 'ESPN'],
  'atp finals':                   ['BeIN Sports 4', 'Sky Sports Tennis', 'Tennis Channel'],
  'wta finals':                   ['BeIN Sports 4', 'Sky Sports Tennis', 'Tennis Channel'],
  'boxing':                       ['BeIN Sports 3', 'DAZN', 'ESPN+'],
  'lebanese basketball':          ['LBC Sport', 'Al Jadeed'],
  'lebanese basketball league':   ['LBC Sport', 'Al Jadeed'],
}

// Channel priority for sorting (lower index = higher priority)
const CHANNEL_PRIORITY_RE = [
  /bein\s*sports/i,
  /sky\s*sports/i,
  /dazn/i,
  /espn/i,
  /tnt\s*sports/i,
  /bbc/i,
  /itv/i,
  /abc/i,
]

function prioritiseChannels(channels) {
  return [...channels].sort((a, b) => {
    const ai = CHANNEL_PRIORITY_RE.findIndex(re => re.test(a))
    const bi = CHANNEL_PRIORITY_RE.findIndex(re => re.test(b))
    const ap = ai === -1 ? 99 : ai
    const bp = bi === -1 ? 99 : bi
    return ap - bp
  })
}

// In-memory page cache: date string → HTML (valid for one cron run)
const pageCache = new Map()

async function fetchSchedulePage(dateStr) {
  if (pageCache.has(dateStr)) return pageCache.get(dateStr)

  try {
    const url = `https://www.livesoccertv.com/schedules/${dateStr}/`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; sports-hub-bot/1.0)',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const html = await res.text()
    pageCache.set(dateStr, html)
    return html
  } catch {
    return null
  }
}

function extractChannelsFromPage(html, homeTeam, awayTeam) {
  try {
    const $ = cheerio.load(html)
    const ht = homeTeam.toLowerCase()
    const at = awayTeam.toLowerCase()

    let matchSection = null

    // Look for table rows / divs containing both team names
    $('tr, .match, .fixture, .game').each((_, el) => {
      const text = $(el).text().toLowerCase()
      if (text.includes(ht.split(' ')[0]) && text.includes(at.split(' ')[0])) {
        matchSection = $(el)
        return false // break
      }
    })

    if (!matchSection) return null

    const channels = []

    // Try common class patterns for TV channel info on LiveSoccerTV
    const channelSelectors = [
      '.channels a', '.tvstations a', '.tv a',
      'td.channels', 'td.tv', '.broadcast a',
      '[class*="channel"] a', '[class*="station"] a',
    ]

    for (const sel of channelSelectors) {
      matchSection.find(sel).each((_, el) => {
        const name = $(el).text().trim()
        if (name) channels.push(name)
      })
      if (channels.length) break
    }

    // Fallback: look in the wider parent row
    if (!channels.length) {
      matchSection.parent().find('a').each((_, el) => {
        const name = $(el).text().trim()
        if (name.length > 1 && name.length < 40 && /sport|bein|sky|dazn|espn|bbc|itv|abc|fox/i.test(name)) {
          channels.push(name)
        }
      })
    }

    return channels.length ? prioritiseChannels(channels) : null
  } catch {
    return null
  }
}

export async function getBroadcastChannels(event) {
  // For football events, attempt LiveSoccerTV scrape first
  if (event.sport === 'football' && event.home_team && event.away_team) {
    // Only try for events within 5 days
    const eventDate = new Date(event.date + 'T00:00:00Z')
    const today = new Date()
    const diffDays = (eventDate - today) / (1000 * 60 * 60 * 24)

    if (diffDays <= 5) {
      try {
        const html = await fetchSchedulePage(event.date)
        if (html) {
          const scraped = extractChannelsFromPage(html, event.home_team, event.away_team)
          if (scraped && scraped.length) {
            return prioritiseChannels(scraped)
          }
        }
      } catch {
        // fall through to hardcoded table
      }
    }
  }

  return getFallbackChannels(event)
}

export function getFallbackChannels(event) {
  const keys = [
    event.competition?.toLowerCase(),
    event.sport?.toLowerCase(),
  ].filter(Boolean)

  for (const key of keys) {
    for (const [pattern, channels] of Object.entries(FALLBACK_TABLE)) {
      if (key.includes(pattern) || pattern.includes(key)) {
        return channels
      }
    }
  }

  return ['TBC']
}
