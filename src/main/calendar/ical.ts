import { randomUUID } from 'node:crypto'
import ICAL from 'ical.js'
import { loadIcalFeeds, saveIcalFeeds } from '../store'
import type { ProviderStatus, UpcomingEvent } from './types'

export type Feed = { id: string; name: string; url: string }

let feeds: Feed[] | undefined // undefined = not loaded yet

function load(): Feed[] {
  if (feeds) return feeds
  const raw = loadIcalFeeds()
  try {
    feeds = raw ? (JSON.parse(raw) as Feed[]) : []
  } catch {
    feeds = []
  }
  return feeds
}

function persist(): void {
  saveIcalFeeds(JSON.stringify(load()))
}

/** Accepts http(s) and webcal:// links; returns the .ics text (and validates it). */
async function fetchFeed(url: string): Promise<string> {
  const normalized = url.trim().replace(/^webcal:\/\//i, 'https://')
  if (!/^https?:\/\//i.test(normalized)) throw new Error('Enter a valid calendar link (https or webcal).')
  const res = await fetch(normalized, { redirect: 'follow', cache: 'no-store' })
  if (!res.ok) throw new Error(`Could not fetch the calendar (${res.status}).`)
  const text = await res.text()
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('That link is not an iCal (.ics) calendar.')
  return text
}

function collect(ics: string, nowMs: number, endMs: number, out: UpcomingEvent[]): void {
  let comp: ICAL.Component
  try {
    comp = new ICAL.Component(ICAL.parse(ics))
  } catch {
    return
  }
  for (const ve of comp.getAllSubcomponents('vevent')) {
    try {
      const ev = new ICAL.Event(ve)
      if (!ev.startDate || ev.startDate.isDate) continue // skip all-day
      const title = ev.summary || 'Untitled event'
      const uid = ev.uid || ''
      if (ev.isRecurring()) {
        const it = ev.iterator()
        let next = it.next()
        let guard = 0
        while (next && guard++ < 1000) {
          const t = next.toJSDate().getTime()
          if (t > endMs) break
          if (t >= nowMs) out.push({ id: `ical:${uid}:${t}`, title, start: t })
          next = it.next()
        }
      } else {
        const t = ev.startDate.toJSDate().getTime()
        out.push({ id: `ical:${uid}:${t}`, title, start: t })
      }
    } catch {
      /* skip this event */
    }
  }
}

// --- public API ------------------------------------------------------------

export function init(): void {
  load()
}

export function status(): ProviderStatus {
  const n = load().length
  return {
    id: 'ical',
    name: 'Calendar links',
    connected: n > 0,
    detail: n ? `${n} calendar${n > 1 ? 's' : ''}` : null,
    configured: true
  }
}

export function listFeeds(): Feed[] {
  return load().map((f) => ({ ...f }))
}

export async function addFeed(url: string, name?: string): Promise<Feed[]> {
  const ics = await fetchFeed(url) // validates the link
  let nm = (name ?? '').trim()
  if (!nm) {
    const m = /X-WR-CALNAME:(.+)/i.exec(ics)
    nm = m ? m[1].trim().slice(0, 60) : 'Calendar'
  }
  const list = load()
  list.push({ id: randomUUID(), name: nm, url: url.trim() })
  feeds = list
  persist()
  return listFeeds()
}

export function removeFeed(id: string): Feed[] {
  feeds = load().filter((f) => f.id !== id)
  persist()
  return listFeeds()
}

/** Events starting within the next `minutes`, across all feeds. In memory only. */
export async function listBetween(start: Date, end: Date): Promise<UpcomingEvent[]> {
  const list = load()
  if (!list.length) return []
  const nowMs = start.getTime()
  const endMs = end.getTime()
  const out: UpcomingEvent[] = []
  await Promise.all(
    list.map(async (feed) => {
      try {
        collect(await fetchFeed(feed.url), nowMs, endMs, out)
      } catch {
        /* skip this feed */
      }
    })
  )
  return out.filter((e) => e.start >= nowMs && e.start < endMs).sort((a, b) => a.start - b.start)
}

export function listUpcoming(minutes = 60): Promise<UpcomingEvent[]> {
  const now = new Date()
  return listBetween(now, new Date(now.getTime() + minutes * 60_000))
}
