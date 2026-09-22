import { join } from 'node:path'
import { app, BrowserWindow, powerMonitor, session, type WebContents } from 'electron'
import { EVT } from '@shared/ipc'
import { AppController } from './app/controller'
import { AppTray } from './app/tray'
import { createMainWindow } from './app/window'
import { handleImageProtocol, registerImageScheme } from './images/imageProtocol'
import { registerIpc } from './ipc/handlers'
import { safeErrorMessage } from './logging/redact'
import { LEGACY_DATA_DIR_NAME, migrateLegacyData } from './storage/migrate'
import { dataPaths } from './storage/paths'

app.setAppUserModelId('com.vrcmanagerx.app')
// The installed app never runs with a debugger attached (it would expose the session).
if (app.isPackaged && (app.commandLine.hasSwitch('remote-debugging-port') || app.commandLine.hasSwitch('inspect'))) app.exit(1)
// Development/testing only: keep test data away from the real profile.
if (!app.isPackaged && process.env.VRCMX_USER_DATA) app.setPath('userData', process.env.VRCMX_USER_DATA)
registerImageScheme()

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let window: BrowserWindow | null = null
  let tray: AppTray | null = null
  let controller: AppController | null = null
  let quitting = false
  const startHidden = process.argv.includes('--hidden')

  // Bring over lists, settings and the session from the pre-rename data folder (first run only).
  let migrated: string[] = []
  let migrationError: unknown
  if (!process.env.VRCMX_USER_DATA) {
    try {
      migrated = migrateLegacyData(app.getPath('userData'), join(app.getPath('appData'), LEGACY_DATA_DIR_NAME))
    } catch (err) {
      migrationError = err
    }
  }

  const send = (channel: string, payload: unknown) => {
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
  }

  const showWindow = () => {
    if (!window || window.isDestroyed()) window = openWindow(false)
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  const isOwnWebContents = (contents: WebContents) => window !== null && !window.isDestroyed() && contents.id === window.webContents.id

  function openWindow(hidden: boolean): BrowserWindow {
    const w = createMainWindow(hidden)
    w.on('close', (event) => {
      if (!quitting && controller?.minimizeToTray) {
        event.preventDefault()
        w.hide()
        tray?.notifyHidden()
      }
    })
    w.on('closed', () => {
      if (window === w) window = null
    })
    return w
  }

  app.on('second-instance', () => showWindow())

  app.whenReady().then(async () => {
    // The UI never needs camera, microphone, notifications, etc.
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    session.defaultSession.setPermissionCheckHandler(() => false)

    const paths = dataPaths()
    controller = new AppController(
      paths,
      {
        snapshot: (s) => send(EVT.snapshot, s),
        users: (u) => send(EVT.users, u),
        activity: (e) => send(EVT.activity, e),
        toast: (t) => send(EVT.toast, t)
      },
      app.getVersion(),
      () => window,
      () => tray?.update()
    )
    const c = controller

    handleImageProtocol({
      cacheDir: paths.imageCache,
      userAgent: () => c.userAgent(),
      cookies: () => c.http.getCookies(),
      blockedUntil: () => c.http.rateLimitedUntil
    })
    registerIpc(c, (event) => isOwnWebContents(event.sender))

    window = openWindow(startHidden)
    tray = new AppTray({
      show: showWindow,
      quit: () => {
        quitting = true
        app.quit()
      },
      isAutomationEnabled: () => c.automationEnabled,
      setAutomationEnabled: (enabled) => c.setAutomationEnabled(enabled),
      statusLine: () => c.statusLine
    })

    powerMonitor.on('resume', () => c.networkRestored())

    if (migrated.length) c.errorLog.write('startup', `Imported data from "${LEGACY_DATA_DIR_NAME}": ${migrated.join(', ')}`)
    if (migrationError) c.errorLog.write('startup', `Could not import data from "${LEGACY_DATA_DIR_NAME}": ${safeErrorMessage(migrationError)}`)

    try {
      await c.init()
    } catch (err) {
      c.errorLog.write('startup', `Initialisation failed: ${safeErrorMessage(err)}`)
    }
  })

  app.on('before-quit', () => {
    quitting = true
    controller?.dispose()
    tray?.destroy()
  })

  app.on('window-all-closed', () => {
    if (!controller?.minimizeToTray) app.quit()
  })

  process.on('unhandledRejection', (reason) => {
    controller?.errorLog.write('process', `Unhandled rejection: ${safeErrorMessage(reason)}`)
  })
}
