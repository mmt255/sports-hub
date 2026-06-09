import { useState } from 'react'
import Head from 'next/head'
import { readCache } from '../lib/cache'

// ─── Constants ────────────────────────────────────────────────────────────────

const TIMEZONES = [
  { label: 'GMT',     tz: 'UTC',          flag: '🌍' },
  { label: 'Germany', tz: 'Europe/Berlin', flag: '🇩🇪' },
  { label: 'Qatar',   tz: 'Asia/Qatar',    flag: '🇶🇦' },
  { label: 'Lebanon', tz: 'Asia/Beirut',   flag: '🇱🇧' },
  { label: 'Nigeria', tz: 'Africa/Lagos',  flag: '🇳🇬' },
]

const SPORT_CONFIG = {
  football:            { icon: '⚽', label: 'Football',           color: '#22c55e', cls: 'sport-football' },
  f1:                  { icon: '🏎️', label: 'Formula 1',          color: '#ef4444', cls: 'sport-f1'       },
  nba:                 { icon: '🏀', label: 'NBA',                 color: '#f97316', cls: 'sport-nba'     },
  ufc:                 { icon: '🥊', label: 'UFC',                 color: '#facc15', cls: 'sport-ufc'     },
  tennis:              { icon: '🎾', label: 'Tennis',              color: '#06b6d4', cls: 'sport-tennis'  },
  boxing:              { icon: '🥊', label: 'Boxing',              color: '#a855f7', cls: 'sport-boxing'  },
  lebanese_basketball: { icon: '🏀', label: 'Lebanese Basketball', color: '#16a34a', cls: 'sport-lebanese'},
}

const DEFAULT_CONFIG = { icon: '🏅', label: 'Sport', color: '#888888', cls: '' }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(dateStr, timeUTC, tz) {
  if (!timeUTC || timeUTC === 'TBD') return 'TBD'
  try {
    const dt = new Date(`${dateStr}T${timeUTC}:00Z`)
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(dt)
  } catch {
    return timeUTC
  }
}

function getSevenDays() {
  const days = []
  const now = new Date()
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i))
    days.push(d.toISOString().slice(0, 10))
  }
  return days
}

function formatDayLabel(dateStr, index) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(dt)
  const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(dt)
  if (index === 0) return `Today · ${dayMonth}`
  if (index === 1) return `Tomorrow · ${dayMonth}`
  return `${weekday} · ${dayMonth}`
}

function formatLastUpdated(iso) {
  if (!iso) return null
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
    }).format(new Date(iso)) + ' GMT'
  } catch {
    return iso
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ChannelBadges({ channels }) {
  if (!channels?.length) return null
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {channels.map((ch, i) => (
        <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-gray-300 whitespace-nowrap">
          📺 {ch}
        </span>
      ))}
    </div>
  )
}

function EventDetail({ event }) {
  const { date, time_utc, channels, competition, is_lebanese_basketball } = event
  return (
    <div className="mt-2 pl-2 border-l border-white/10 space-y-2 text-sm">
      {/* Timezones */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
        {TIMEZONES.map(({ label, tz, flag }) => (
          <div key={tz} className="flex items-center gap-1.5">
            <span className="text-base">{flag}</span>
            <span className="text-gray-400 text-xs min-w-[52px]">{label}</span>
            <span className="text-white font-medium text-xs">
              {tz === 'UTC' ? (time_utc === 'TBD' ? 'TBD' : time_utc) : formatTime(date, time_utc, tz)}
            </span>
          </div>
        ))}
      </div>

      {/* Competition name */}
      {competition && (
        <p className="text-xs text-gray-400">{competition}{is_lebanese_basketball ? ' 🇱🇧' : ''}</p>
      )}

      {/* Channels */}
      <ChannelBadges channels={channels} />
    </div>
  )
}

function EventRow({ event, sportConfig }) {
  const [expanded, setExpanded] = useState(false)
  const { icon, color, cls } = sportConfig

  return (
    <div
      className={`border-l-2 pl-3 rounded-r cursor-pointer select-none ${cls}`}
      style={{ borderLeftColor: color }}
      onClick={() => setExpanded(e => !e)}
    >
      {/* Collapsed summary row */}
      <div className="flex items-center justify-between py-3.5 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base flex-shrink-0">{icon}</span>
          <span className="text-sm font-medium text-text-primary truncate">
            {event.title}
            {event.is_lebanese_basketball && ' 🇱🇧'}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-gray-300 font-mono">
            {event.time_utc === 'TBD' ? 'TBD' : event.time_utc} <span className="text-gray-400">GMT</span>
          </span>
          <span className="text-gray-400 text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="pb-3">
          <p className="text-sm font-semibold text-white mb-1">{event.title}</p>
          <EventDetail event={event} />
        </div>
      )}
    </div>
  )
}

function DayCard({ dateStr, index, events }) {
  const [open, setOpen] = useState(true)

  const label   = formatDayLabel(dateStr, index)
  const isEmpty = events.length === 0

  return (
    <div className="rounded-xl bg-surface border border-border overflow-hidden">
      {/* Card header */}
      <button
        className="w-full flex items-center justify-between px-4 py-3.5 text-left focus:outline-none"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          {index === 0 && (
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full animate-pulse">
              Live
            </span>
          )}
          <span className="font-semibold text-white text-sm sm:text-base">{label}</span>
        </div>
        <div className="flex items-center gap-3">
          {!isEmpty && (
            <span className="text-xs text-gray-400">
              {events.length} event{events.length !== 1 ? 's' : ''}
            </span>
          )}
          <span className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Card body */}
      {open && (
        <div className="px-4 pb-4">
          {isEmpty ? (
            <p className="text-sm text-gray-400 py-2">No events scheduled</p>
          ) : (
            <div className="divide-y divide-[#2a2a2a]">
              {events.map(ev => {
                const cfg = SPORT_CONFIG[ev.sport] || DEFAULT_CONFIG
                return <EventRow key={ev.id} event={ev} sportConfig={cfg} />
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Home({ events, lastUpdated }) {
  const days       = getSevenDays()
  const lastUpdFmt = formatLastUpdated(lastUpdated)

  // Group events by date
  const byDate = {}
  for (const day of days) byDate[day] = []
  for (const ev of events) {
    if (ev.date in byDate) byDate[ev.date].push(ev)
  }

  return (
    <>
      <Head>
        <title>Peter b Alaa — Sports Schedule</title>
        <meta name="description" content="7-day sports schedule tracker" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <meta name="theme-color" content="#0a0a0a" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="min-h-screen bg-bg">
        <div className="max-w-2xl mx-auto px-4 py-8 pb-16">

          {/* Header */}
          <div className="mb-8 text-center">
            <h1 className="text-4xl sm:text-5xl font-black tracking-tight mb-2"
                style={{
                  background: 'linear-gradient(135deg, #ffffff 0%, #a3e635 50%, #4ade80 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}>
              Peter b Alaa
            </h1>
            <p className="text-gray-400 text-sm">
              Sports events next 7 days. Click on any event for TV channels and local times.
            </p>
          </div>

          {/* No data state */}
          {!lastUpdated && (
            <div className="rounded-xl bg-surface border border-border p-6 text-center mb-6">
              <p className="text-gray-400 text-sm">
                No events yet — trigger a sync to populate the schedule.
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Visit <code className="text-gray-500">/api/sync</code> then refresh this page.
              </p>
            </div>
          )}

          {/* Day cards */}
          <div className="space-y-3">
            {days.map((dateStr, i) => (
              <DayCard
                key={dateStr}
                dateStr={dateStr}
                index={i}
                events={byDate[dateStr] || []}
              />
            ))}
          </div>

          {/* Footer */}
          <div className="mt-10 text-center">
            {lastUpdFmt && (
              <p className="text-xs text-gray-400">Last updated: {lastUpdFmt}</p>
            )}
            <p className="text-xs text-gray-500 mt-1">Refreshes daily at 06:00 GMT</p>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Data fetching ────────────────────────────────────────────────────────────

export async function getServerSideProps() {
  let cacheData = { last_updated: null, events: [] }

  try {
    cacheData = await readCache()
  } catch (err) {
    console.error('[getServerSideProps] cache read failed:', err.message)
  }

  return {
    props: {
      events:      cacheData.events || [],
      lastUpdated: cacheData.last_updated || null,
    },
  }
}
