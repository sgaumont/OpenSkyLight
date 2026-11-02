import { BrowserWindow, shell } from 'electron'
import { join } from 'path'

export function createMainWindow(): BrowserWindow {
  const isDev = !!process.env['ELECTRON_RENDERER_URL']
  // Dev runs windowed by default; production runs kiosk fullscreen.
  // Override with --kiosk (force kiosk in dev) or --windowed (force windowed in prod).
  const windowed = process.argv.includes('--windowed') || (isDev && !process.argv.includes('--kiosk'))

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    fullscreen: !windowed,
    kiosk: !windowed,
    autoHideMenuBar: true,
    backgroundColor: '#F7F3EC',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win.show())
  // a page that never finishes loading must not leave an invisible app running
  const fallback = setTimeout(() => {
    if (win.isDestroyed() || win.isVisible()) return
    console.error('[main] window not ready after 15s; showing it anyway')
    win.show()
    win.webContents.openDevTools({ mode: 'detach' })
  }, 15_000)
  win.once('show', () => clearTimeout(fallback))
  win.webContents.on('did-fail-load', (_e, code, desc, url) => console.error('[main] load failed:', code, desc, url))
  // Pinch-zoom on a touchscreen must not scale the kiosk UI
  win.webContents.setVisualZoomLevelLimits(1, 1)
  // Any external link goes to the system browser, never inside the kiosk
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']!)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}
