import { app, globalShortcut } from 'electron'
import { createOverlayWindow, flyAcross } from './windows/overlay'
import { openSettings } from './windows/settings'
import { createTray } from './tray'
import { registerIpc } from './ipc'
import { getPrefs, setPrefs } from './store'
import { startScheduler } from './scheduler'
import { initAutoUpdate } from './updater'
import * as calendar from './calendar'
import * as license from './license'

// Only allow a single running instance of Quakpit.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

// Safety nets: never let a stray error tear the whole app down.
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err))
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err))
app.on('render-process-gone', (_e, _wc, d) => console.error('[render-process-gone]', d))
app.on('child-process-gone', (_e, d) => console.error('[child-process-gone]', d))

// Re-opening the app (second launch, or clicking it again) brings the control window forward.
app.on('second-instance', () => openSettings())

/** Demo / manual flight (also used until a meeting triggers automatically). */
function sendTestFlight(): void {
  flyAcross({
    message: 'Call with Jack in 5 minutes',
    durationMs: 9000,
    sound: getPrefs().soundEnabled
  })
}

function togglePresentationMode(): void {
  setPrefs({ presentationMode: !getPrefs().presentationMode })
}

app.whenReady().then(async () => {
  // Quakpit is a regular app: it shows in the Dock and Cmd+Tab. (It also keeps
  // a menu-bar icon for quick access, and stays running in the background.)
  // Lock the Dock icon on so showing the overlay never drops us to accessory mode.
  if (process.platform === 'darwin') app.dock?.show()

  registerIpc()

  // Honour the saved "launch at login" preference (only works once packaged).
  if (app.isPackaged) {
    try {
      app.setLoginItemSettings({ openAtLogin: getPrefs().launchAtLogin })
    } catch {
      /* not permitted in some environments */
    }
  }

  createOverlayWindow()
  createTray(sendTestFlight, openSettings, togglePresentationMode)
  globalShortcut.register('CommandOrControl+Shift+D', sendTestFlight)
  globalShortcut.register('CommandOrControl+Shift+P', togglePresentationMode)

  // Show the control window when the app opens.
  openSettings()

  // Restore any saved calendar sessions (Google opt-in, iCloud creds), then watch.
  await calendar.init().catch(() => undefined)
  startScheduler()

  // Re-validate the license online (offline grace keeps premium working if this fails).
  void license.validate()

  // Check GitHub Releases for updates (packaged builds only).
  initAutoUpdate()
})

// Re-open the control window when the app is activated (macOS).
app.on('activate', () => openSettings())

// Stay alive in the background even when no window is visible.
app.on('window-all-closed', () => {
  // Intentionally do nothing — the app lives in the tray / menu bar.
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
