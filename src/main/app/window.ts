import { join } from 'node:path'
import { app, BrowserWindow, nativeImage, shell } from 'electron'

export function resourcePath(file: string): string {
  return app.isPackaged ? join(process.resourcesPath, 'resources', file) : join(app.getAppPath(), 'resources', file)
}

export function createMainWindow(startHidden: boolean): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 560,
    show: false,
    title: 'VRCManagerX',
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    icon: nativeImage.createFromPath(resourcePath('icon.png')),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  })
  window.setMenu(null)

  window.once('ready-to-show', () => {
    if (!startHidden) window.show()
  })

  // The renderer may never open windows or navigate away from the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/([a-z0-9-]+\.)?vrchat\.com\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault()
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}
