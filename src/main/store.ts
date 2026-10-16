import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Non-personal preferences only — no calendar data ever lives here. */
export type Prefs = {
  leadMinutes: number
  reminderMinutes: number[]
  messageTemplate: string
  soundEnabled: boolean
  staySignedIn: boolean
  launchAtLogin: boolean
  targetDisplay: 'cursor' | 'primary'
  theme: string
  flier: string
  font: string
  // --- Pro ---
  speed: 'normal' | 'fast' | 'ultra' // how fast the rig crosses the screen
  flyAtStart: boolean // a second fly-by at the meeting's start time (free)
  presentationMode: boolean // pause automatic flights while presenting
  showTodaySchedule: boolean // preview the full local calendar day instead of next two hours
  soundPack: string // which signature sound plays mid-flight
  flierHead: string // character head id
  flierColor: string // plane colour id
  customFlierName: string // legacy (kept so old prefs files still parse)
}

const DEFAULT_PREFS: Prefs = {
  leadMinutes: 5,
  reminderMinutes: [5],
  messageTemplate: '{title} in {minutes} minutes',
  soundEnabled: true,
  staySignedIn: true,
  launchAtLogin: false,
  targetDisplay: 'cursor',
  theme: 'classic',
  flier: 'duck-plane',
  font: 'system',
  speed: 'normal',
  flyAtStart: false,
  presentationMode: false,
  showTodaySchedule: false,
  soundPack: 'quack',
  flierHead: 'duck',
  flierColor: 'red',
  customFlierName: ''
}

function dataDir(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}
const prefsPath = (): string => join(dataDir(), 'prefs.json')
const tokenPath = (): string => join(dataDir(), 'token.bin')
const licensePath = (): string => join(dataDir(), 'license.bin')
const icloudPath = (): string => join(dataDir(), 'icloud.bin')
const googleCredsPath = (): string => join(dataDir(), 'google-creds.bin')
const icalPath = (): string => join(dataDir(), 'ical-feeds.bin')
// The user's own plane image, kept as a ready-to-render data URL (not sensitive).
const customFlierPath = (): string => join(dataDir(), 'custom-flier.txt')

let cache: Prefs | null = null

export function getPrefs(): Prefs {
  if (cache) return cache
  try {
    if (existsSync(prefsPath())) {
      const raw = JSON.parse(readFileSync(prefsPath(), 'utf8'))
      cache = { ...DEFAULT_PREFS, ...raw }
    } else {
      cache = { ...DEFAULT_PREFS }
    }
  } catch {
    cache = { ...DEFAULT_PREFS }
  }
  return cache as Prefs
}

export function setPrefs(patch: Partial<Prefs>): Prefs {
  const next: Prefs = { ...getPrefs(), ...patch }
  cache = next
  try {
    writeFileSync(prefsPath(), JSON.stringify(next, null, 2), 'utf8')
  } catch {
    /* preferences are best-effort */
  }
  return next
}

// --- OAuth refresh token: encrypted at rest by the OS, and entirely optional ---

export function saveRefreshToken(token: string): void {
  try {
    if (!safeStorage.isEncryptionAvailable()) return
    writeFileSync(tokenPath(), safeStorage.encryptString(token))
  } catch {
    /* ignore */
  }
}

export function loadRefreshToken(): string | null {
  try {
    if (!existsSync(tokenPath()) || !safeStorage.isEncryptionAvailable()) return null
    return safeStorage.decryptString(readFileSync(tokenPath()))
  } catch {
    return null
  }
}

export function clearRefreshToken(): void {
  try {
    if (existsSync(tokenPath())) rmSync(tokenPath())
  } catch {
    /* ignore */
  }
}

// --- License entitlement: encrypted at rest by the OS (key + instance id + cache) ---

export function saveEntitlement(json: string): void {
  try {
    if (!safeStorage.isEncryptionAvailable()) return
    writeFileSync(licensePath(), safeStorage.encryptString(json))
  } catch {
    /* ignore */
  }
}

export function loadEntitlement(): string | null {
  try {
    if (!existsSync(licensePath()) || !safeStorage.isEncryptionAvailable()) return null
    return safeStorage.decryptString(readFileSync(licensePath()))
  } catch {
    return null
  }
}

export function clearEntitlement(): void {
  try {
    if (existsSync(licensePath())) rmSync(licensePath())
  } catch {
    /* ignore */
  }
}

// --- iCloud CalDAV credentials: Apple ID + app-specific password, encrypted ---

export function saveICloud(json: string): void {
  try {
    if (!safeStorage.isEncryptionAvailable()) return
    writeFileSync(icloudPath(), safeStorage.encryptString(json))
  } catch {
    /* ignore */
  }
}

export function loadICloud(): string | null {
  try {
    if (!existsSync(icloudPath()) || !safeStorage.isEncryptionAvailable()) return null
    return safeStorage.decryptString(readFileSync(icloudPath()))
  } catch {
    return null
  }
}

export function clearICloud(): void {
  try {
    if (existsSync(icloudPath())) rmSync(icloudPath())
  } catch {
    /* ignore */
  }
}

// --- Google OAuth client (clientId/secret), pasted in-app, encrypted ---

export function saveGoogleCreds(json: string): void {
  try {
    if (!safeStorage.isEncryptionAvailable()) return
    writeFileSync(googleCredsPath(), safeStorage.encryptString(json))
  } catch {
    /* ignore */
  }
}

export function loadGoogleCreds(): string | null {
  try {
    if (!existsSync(googleCredsPath()) || !safeStorage.isEncryptionAvailable()) return null
    return safeStorage.decryptString(readFileSync(googleCredsPath()))
  } catch {
    return null
  }
}

// --- iCal/ICS subscription links (list of feed URLs), encrypted ---

export function saveIcalFeeds(json: string): void {
  try {
    if (!safeStorage.isEncryptionAvailable()) return
    writeFileSync(icalPath(), safeStorage.encryptString(json))
  } catch {
    /* ignore */
  }
}

export function loadIcalFeeds(): string | null {
  try {
    if (!existsSync(icalPath()) || !safeStorage.isEncryptionAvailable()) return null
    return safeStorage.decryptString(readFileSync(icalPath()))
  } catch {
    return null
  }
}

// --- Custom flier image: the user's own plane picture, stored as a data URL ---
// It's a decorative asset the user chose, so it's not encrypted. It never leaves
// the device — the overlay reads it through the main process only.

export function saveCustomFlier(dataUrl: string): void {
  try {
    writeFileSync(customFlierPath(), dataUrl, 'utf8')
  } catch {
    /* ignore */
  }
}

export function loadCustomFlier(): string | null {
  try {
    if (!existsSync(customFlierPath())) return null
    return readFileSync(customFlierPath(), 'utf8')
  } catch {
    return null
  }
}

export function clearCustomFlier(): void {
  try {
    if (existsSync(customFlierPath())) rmSync(customFlierPath())
  } catch {
    /* ignore */
  }
}
