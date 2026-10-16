import { app, shell } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  clearRefreshToken,
  getPrefs,
  loadGoogleCreds,
  loadRefreshToken,
  saveGoogleCreds,
  saveRefreshToken
} from '../store'

const SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly openid email'
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

type Creds = { clientId: string; clientSecret: string }
export type UpcomingEvent = { id: string; title: string; start: number }

// In-memory session only. Refresh token is persisted *optionally* (see store).
let accessToken: string | null = null
let accessExpiry = 0
let refreshToken: string | null = null
let userEmail: string | null = null

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** OAuth client id/secret: pasted in-app (encrypted store) → env → gitignored file. */
function loadCreds(): Creds | null {
  const raw = loadGoogleCreds()
  if (raw) {
    try {
      const j = JSON.parse(raw) as Creds
      if (j.clientId && j.clientSecret) return j
    } catch {
      /* ignore */
    }
  }

  const envId = process.env.GOOGLE_CLIENT_ID
  const envSecret = process.env.GOOGLE_CLIENT_SECRET
  if (envId && envSecret) return { clientId: envId, clientSecret: envSecret }

  const file = join(app.getAppPath(), 'oauth-credentials.json')
  try {
    if (existsSync(file)) {
      const j = JSON.parse(readFileSync(file, 'utf8'))
      const clientId = j.clientId ?? j.installed?.client_id ?? j.web?.client_id
      const clientSecret = j.clientSecret ?? j.installed?.client_secret ?? j.web?.client_secret
      if (clientId && clientSecret) return { clientId, clientSecret }
    }
  } catch {
    /* ignore */
  }
  return null
}

/** Save the OAuth client id/secret pasted by the user (encrypted at rest). */
export function setCreds(clientId: string, clientSecret: string): void {
  const id = clientId.trim()
  const secret = clientSecret.trim()
  if (!id || !secret) throw new Error('Enter both the Client ID and the Client secret.')
  saveGoogleCreds(JSON.stringify({ clientId: id, clientSecret: secret }))
}

export function isConfigured(): boolean {
  return loadCreds() !== null
}

export function status(): { connected: boolean; email: string | null; configured: boolean } {
  return {
    connected: Boolean(refreshToken || accessToken),
    email: userEmail,
    configured: isConfigured()
  }
}

/** Restore a previous session only if the user opted into "Stay signed in". */
export async function init(): Promise<void> {
  if (!getPrefs().staySignedIn) return
  refreshToken = loadRefreshToken()
  if (refreshToken) {
    try {
      await refreshAccess()
    } catch {
      refreshToken = null
    }
  }
}

export async function connect(): Promise<void> {
  const creds = loadCreds()
  if (!creds) throw new Error('Google OAuth credentials are not configured (see README).')

  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  const { code, redirectUri } = await runLoopback(creds.clientId, challenge)

  const body = new URLSearchParams({
    code,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  if (!res.ok) throw new Error(`Token exchange failed (${res.status})`)
  const json = (await res.json()) as Record<string, unknown>

  accessToken = String(json.access_token)
  accessExpiry = Date.now() + Number(json.expires_in ?? 3600) * 1000
  if (json.refresh_token) {
    refreshToken = String(json.refresh_token)
    if (getPrefs().staySignedIn) saveRefreshToken(refreshToken)
  }
  await fetchUserEmail()
}

export function disconnect(): void {
  accessToken = null
  refreshToken = null
  userEmail = null
  accessExpiry = 0
  clearRefreshToken()
}

/** Stop persisting the token (toggle off) but keep the current session alive. */
export function forgetPersisted(): void {
  clearRefreshToken()
}

/** Persist the current token (toggle on), if we have one. */
export function persistIfPossible(): void {
  if (refreshToken) saveRefreshToken(refreshToken)
}

/**
 * Returns events starting within the next `withinMinutes`. Held in memory only,
 * never written to disk.
 */
export async function listBetween(start: Date, end: Date): Promise<UpcomingEvent[]> {
  if (!refreshToken && !accessToken) return []
  const token = await getAccessToken()

  const url = new URL(EVENTS_URL)
  url.searchParams.set('timeMin', start.toISOString())
  url.searchParams.set('timeMax', end.toISOString())
  url.searchParams.set('singleEvents', 'true')
  url.searchParams.set('orderBy', 'startTime')
  url.searchParams.set('maxResults', '15')

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Events fetch failed (${res.status})`)
  const json = (await res.json()) as { items?: unknown[] }

  const events: UpcomingEvent[] = []
  for (const raw of json.items ?? []) {
    const it = raw as {
      id?: string
      summary?: string
      start?: { dateTime?: string }
      attendees?: { self?: boolean; responseStatus?: string }[]
    }
    if (!it.start?.dateTime) continue // skip all-day events
    const declined = (it.attendees ?? []).some(
      (a) => a.self && a.responseStatus === 'declined'
    )
    if (declined) continue
    events.push({
      id: it.id ?? String(it.start.dateTime),
      title: it.summary ?? 'Untitled event',
      start: new Date(it.start.dateTime).getTime()
    })
  }
  return events
}

export function listUpcoming(withinMinutes = 60): Promise<UpcomingEvent[]> {
  const now = new Date()
  return listBetween(now, new Date(now.getTime() + withinMinutes * 60_000))
}

// --- internals ---------------------------------------------------------------

function runLoopback(
  clientId: string,
  challenge: string
): Promise<{ code: string; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('Could not open a local callback port'))
        return
      }
      const redirectUri = `http://127.0.0.1:${addr.port}`
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPE,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        access_type: 'offline',
        prompt: 'consent'
      })
      void shell.openExternal(`${AUTH_URL}?${params.toString()}`)

      const timeout = setTimeout(() => {
        server.close()
        reject(new Error('Sign-in timed out'))
      }, 300_000)

      server.on('request', (req, res) => {
        const url = new URL(req.url ?? '', redirectUri)
        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(
          '<!doctype html><html><body style="font-family:-apple-system,sans-serif;text-align:center;padding-top:64px;background:#0b1b2b;color:#fff"><h2>🦆 Quakpit is connected!</h2><p>You can close this tab and return to the app.</p></body></html>'
        )
        clearTimeout(timeout)
        server.close()
        if (code) resolve({ code, redirectUri })
        else reject(new Error(error ?? 'No authorization code returned'))
      })
    })
  })
}

async function refreshAccess(): Promise<void> {
  const creds = loadCreds()
  if (!creds || !refreshToken) throw new Error('Cannot refresh: not connected')
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  if (!res.ok) throw new Error(`Token refresh failed (${res.status})`)
  const json = (await res.json()) as Record<string, unknown>
  accessToken = String(json.access_token)
  accessExpiry = Date.now() + Number(json.expires_in ?? 3600) * 1000
  if (!userEmail) await fetchUserEmail().catch(() => undefined)
}

async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < accessExpiry - 60_000) return accessToken
  await refreshAccess()
  if (!accessToken) throw new Error('No access token available')
  return accessToken
}

async function fetchUserEmail(): Promise<void> {
  try {
    const token = await getAccessToken()
    const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) {
      const j = (await res.json()) as { email?: string }
      userEmail = j.email ?? null
    }
  } catch {
    /* email is cosmetic */
  }
}
