import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'

type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'downloading' }
  | { status: 'ready'; version: string }
  | { status: 'not-available' }
  | { status: 'portable' }
  | { status: 'error'; message: string }

let state: UpdateState = { status: 'idle' }

function isPortableMode(): boolean {
  // Windows portable: PORTABLE_EXECUTABLE_DIR is set by electron-builder
  if (process.env.PORTABLE_EXECUTABLE_DIR !== undefined) return true
  // AppImage: check if running outside the sandboxed mount (testing from release/)
  if (process.platform === 'linux' && process.env.APPIMAGE === undefined) {
    // If the executable path contains 'release' or 'dist' it's likely a manual run
    const exe = app.getPath('exe')
    if (exe.includes('/release/') || exe.includes('/dist-electron/')) return true
  }
  return false
}

function sendState(window: BrowserWindow | null | undefined) {
  window?.webContents.send('updater:state', state)
}

export function registerAutoUpdater() {
  // In dev mode skip updates — no release to fetch.
  if (!app.isPackaged) {
    console.log('[updater] Dev mode — auto-update disabled')
    return
  }

  // Portable builds cannot auto-update — tell the renderer so it shows a manual link.
  if (isPortableMode()) {
    console.log('[updater] Portable mode — auto-update disabled')
    state = { status: 'portable' }
    const broadcast = () => sendState(BrowserWindow.getFocusedWindow() ?? undefined)
    // Broadcast once windows exist; they may be created after this call.
    broadcast()
    app.on('browser-window-created', (_, win) => sendState(win))
    return
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  const broadcast = () => sendState(BrowserWindow.getFocusedWindow() ?? undefined)

  autoUpdater.on('checking-for-update', () => {
    state = { status: 'checking' }
    broadcast()
  })

  autoUpdater.on('update-available', (info) => {
    state = { status: 'available', version: info.version }
    broadcast()
  })

  autoUpdater.on('update-not-available', () => {
    state = { status: 'not-available' }
    broadcast()
  })

  autoUpdater.on('download-progress', () => {
    state = { status: 'downloading' }
    broadcast()
  })

  autoUpdater.on('update-downloaded', (info) => {
    state = { status: 'ready', version: info.version }
    broadcast()
  })

  autoUpdater.on('error', (err) => {
    state = { status: 'error', message: err?.message ?? String(err) }
    broadcast()
  })

  // Check for updates on startup (delayed so it doesn't block launch).
  setTimeout(() => void checkForUpdates(), 10_000)
}

async function checkForUpdates() {
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    // Already handled by the 'error' event above.
  }
}

async function downloadAndUpdate() {
  const win = BrowserWindow.getFocusedWindow()
  try {
    const confirmed = await dialog.showMessageBox(win!, {
      type: 'question',
      buttons: ['Install now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update available',
      message: `Version ${state.status === 'ready' ? state.version : 'unknown'} is ready.`,
      detail: 'The update will install when you quit the app.',
    })
    if (confirmed.response === 0) {
      autoUpdater.quitAndInstall()
    }
  } catch {
    // User dismissed or window closed — no action.
  }
}

// Register IPC handlers for the renderer to trigger checks/downloads.
export function registerUpdaterIpc() {
  if (!app.isPackaged) return

  ipcMain.handle('updater:check', () => {
    void checkForUpdates()
  })

  ipcMain.handle('updater:download', () => {
    if (state.status === 'available' || state.status === 'ready') {
      void downloadAndUpdate()
    }
  })

  ipcMain.handle('updater:open-releases', () => {
    const { shell } = require('electron')
    void shell.openExternal('https://github.com/rramirezacosta/ramses-studio/releases/latest')
  })
}
