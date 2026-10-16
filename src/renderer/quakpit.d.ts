// Shared ambient types for the renderer side (the API exposed by the preload).
export {}

declare global {
  type Flight = {
    message: string
    durationMs: number
    sound?: boolean
    soundPack?: string
    theme?: string
    head?: string
    color?: string
    font?: string
  }

  type Prefs = {
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
    speed: 'normal' | 'fast' | 'ultra'
    flyAtStart: boolean
    presentationMode: boolean
    showTodaySchedule: boolean
    soundPack: string
    flierHead: string
    flierColor: string
    customFlierName: string
  }

  type ProviderStatus = {
    id: string
    name: string
    connected: boolean
    detail: string | null
    configured: boolean
  }
  type UpcomingEvent = { id: string; title: string; start: number }
  type Feed = { id: string; name: string; url: string }
  type LicenseStatus = {
    premium: boolean
    active: boolean
    keyMasked: string | null
    expiresAt: number | null
    lastChecked: number | null
  }

  interface QuakpitApi {
    onFlight: (cb: (flight: Flight) => void) => () => void
    getPrefs: () => Promise<Prefs>
    setPrefs: (patch: Partial<Prefs>) => Promise<Prefs>
    calStatus: () => Promise<ProviderStatus[]>
    calConnect: (
      provider: string,
      params?: { username?: string; password?: string }
    ) => Promise<ProviderStatus[]>
    calDisconnect: (provider: string) => Promise<ProviderStatus[]>
    calConfigure: (
      provider: string,
      params: { clientId?: string; clientSecret?: string }
    ) => Promise<ProviderStatus[]>
    icalList: () => Promise<Feed[]>
    icalAdd: (url: string, name?: string) => Promise<Feed[]>
    icalRemove: (id: string) => Promise<Feed[]>
    flierImport: () => Promise<{ prefs: Prefs; dataUrl: string | null }>
    flierGetCustom: () => Promise<string | null>
    flierRemoveCustom: () => Promise<Prefs>
    upcoming: () => Promise<UpcomingEvent[]>
    openExternal: (url: string) => Promise<void>
    testFlight: () => Promise<boolean>
    licenseStatus: () => Promise<LicenseStatus>
    licenseActivate: (key: string) => Promise<LicenseStatus>
    licenseDeactivate: () => Promise<LicenseStatus>
  }

  interface Window {
    quakpit: QuakpitApi
  }
}
