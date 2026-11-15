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

export function isPortableMode(): boolean {
  // Windows portable: PORTABLE_EXECUTABLE_DIR is set by electron-builder
  if (process.env.PORTABLE_EXECUTABLE_DIR !== undefined) return true
  // Auto-update is only supported for installed builds. On Linux only installed
  // AppImages ship update metadata (latest-linux.yml); RPM/DEB/Flatpak builds
  // and AppImages launched straight from a download folder do not.
  if (process.platform === 'linux') {
    if (process.env.APPIMAGE === undefined) return true
    const exe = app.getPath('exe')
    if (exe.includes('/release/') || exe.includes('/dist-electron/')) return true
  }
  return false
}

// Returns true when the failure is caused by missing update metadata on the
// published release (e.g. a 404 for latest-linux.yml / latest.yml). In that
// case auto-update cannot work, so callers should fall back to a manual
// download link instead of surfacing a hard error.
export function isMissingUpdateMetadataError(err: unknown): boolean {
  const code = (err as { code?: string } | null | undefined)?.code
  if (code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND') return true
  const msg = err instanceof Error ? err.message : String(err ?? '')
  if (/Cannot find .*latest.*\.yml/i.test(msg)) return true
  if (/latest-.*\.yml/i.test(msg) && /404/i.test(msg)) return true
  if (/HttpError/i.test(msg) && /404/i.test(msg)) return true
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
    console.log('[updater] Checking for updates...')
    state = { status: 'checking' }
    broadcast()
  })

  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] Update available: ${info.version}`)
    state = { status: 'available', version: info.version }
    broadcast()
  })

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] No updates available')
    state = { status: 'not-available' }
    broadcast()
  })

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[updater] Download progress: ${progress.percent.toFixed(1)}% (${progress.transferred}/${progress.total} bytes)`)
    state = { status: 'downloading' }
    broadcast()
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[updater] Update downloaded: ${info.version}`)
    state = { status: 'ready', version: info.version }
    broadcast()
  })

  autoUpdater.on('error', (err) => {
    const msg = err?.message ?? String(err)
    console.error(`[updater] Error: ${msg}`)
    // Missing update metadata on the release (e.g. 404 for latest-linux.yml) means
    // auto-update cannot work; fall back to the manual download link instead of
    // surfacing a hard error to the user.
    if (isMissingUpdateMetadataError(err)) {
      console.warn('[updater] Update metadata missing — falling back to manual download')
      state = { status: 'portable' }
    } else {
      state = { status: 'error', message: msg }
    }
    broadcast()
  })

  // Check for updates on startup (delayed so it doesn't block launch).
  console.log('[updater] Scheduling startup check in 10s...')
  setTimeout(() => {
    console.log('[updater] Starting delayed check for updates...')
    void checkForUpdates()
  }, 10_000)
}

async function checkForUpdates() {
  console.log('[updater] checkForUpdates() called')
  try {
    await autoUpdater.checkForUpdates()
    console.log('[updater] checkForUpdates() completed')
  } catch (err) {
    // Already handled by the 'error' event above, unless metadata is missing,
    // in which case mirror the portable fallback here too.
    if (isMissingUpdateMetadataError(err)) {
      console.warn('[updater] Update metadata missing — falling back to manual download')
      state = { status: 'portable' }
      const win = BrowserWindow.getFocusedWindow() ?? undefined
      win?.webContents.send('updater:state', state)
    }
    console.log('[updater] checkForUpdates() caught (handled by error event)')
  }
}

async function downloadAndUpdate() {
  console.log('[updater] downloadAndUpdate() called')
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
      console.log('[updater] User confirmed — quitting and installing update')
      autoUpdater.quitAndInstall()
    } else {
      console.log('[updater] User chose "Later" — update will install on quit')
    }
  } catch {
    console.log('[updater] Download dialog dismissed or window closed')
  }
}

// Register IPC handlers for the renderer to trigger checks/downloads.
export function registerUpdaterIpc() {
  if (!app.isPackaged) return

  ipcMain.handle('updater:check', () => {
    console.log('[updater] IPC: renderer requested check for updates')
    void checkForUpdates()
  })

  ipcMain.handle('updater:download', () => {
    console.log(`[updater] IPC: renderer requested download (state: ${state.status})`)
    if (state.status === 'available' || state.status === 'ready') {
      void downloadAndUpdate()
    } else {
      console.log('[updater] IPC: download skipped — no update available')
    }
  })

  ipcMain.handle('updater:open-releases', () => {
    const { shell } = require('electron')
    void shell.openExternal('https://github.com/rramirezacosta/ramses-studio/releases/latest')
  })
}
