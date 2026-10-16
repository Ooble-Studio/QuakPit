import { Tray, Menu, nativeImage, app } from 'electron'
import { join } from 'node:path'
import { getPrefs } from './store'

let tray: Tray | null = null

/** Creates the menu-bar / system-tray icon and its menu. */
export function createTray(
  onTestFlight: () => void,
  onSettings: () => void,
  onTogglePresentation: () => void
): Tray {
  // Tray icons must be real files: nativeImage cannot read assets inside app.asar.
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'tray-iconTemplate.png')
    : join(app.getAppPath(), 'build', 'iconTemplate.png')
  let image = nativeImage.createFromPath(
    iconPath
  )
  if (image.isEmpty()) {
    image = nativeImage.createEmpty()
  }
  // Template image = macOS auto-adapts it to light/dark menu bars.
  if (process.platform === 'darwin') {
    image.setTemplateImage(true)
  }

  tray = new Tray(image)
  tray.setToolTip('Quakpit')

  const updateMenu = (): void => {
    tray?.setContextMenu(
      Menu.buildFromTemplate([
      { label: 'Open Quakpit', click: onSettings },
      { label: 'Send a test flight  (⌘⇧D)', click: onTestFlight },
      {
        label: 'Pause reminders  (⌘⇧P)',
        type: 'checkbox',
        checked: getPrefs().presentationMode,
        click: () => {
          onTogglePresentation()
          updateMenu()
        }
      },
      { type: 'separator' },
      { label: 'Quit Quakpit', click: () => app.quit() }
      ])
    )
  }

  updateMenu()
  return tray
}
