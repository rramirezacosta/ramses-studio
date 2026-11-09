import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { app, BrowserWindow, ipcMain, Menu, net, protocol } from 'electron'
import { readdir } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { registerSongIpc } from './ipc/fileScanner'
import { registerStemImportIpc } from './ipc/stemImport'
import { registerMixIpc } from './ipc/mixExport'
import { songsDirectory } from './paths'

if (process.platform === 'linux') app.commandLine.appendSwitch('enable-features', 'Vulkan')

// Registered before 'ready' so the renderer can lazy-load song covers via <img>.
protocol.registerSchemesAsPrivileged([
  { scheme: 'ramses-cover', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

let mainWindow: BrowserWindow | undefined
const __dirname = dirname(fileURLToPath(import.meta.url))
const execFile = promisify(execFileCallback)
const windowButtons = ['minimize', 'maximize', 'close'] as const
type WindowButton = (typeof windowButtons)[number]
type WindowButtonLayout = { left: WindowButton[]; right: WindowButton[] }

const defaultWindowButtonLayout: WindowButtonLayout = { left: [], right: ['minimize', 'maximize', 'close'] }

const appIconPath = () => app.isPackaged
  ? join(process.resourcesPath, 'icons', 'app_512.png')
  : join(app.getAppPath(), 'build', 'icons', 'app_512.png')

function parseWindowButtons(buttons: string) {
  return buttons.split(',').filter((button): button is WindowButton => (windowButtons as readonly string[]).includes(button))
}

async function getWindowButtonLayout(): Promise<WindowButtonLayout> {
  const desktop = `${process.env.XDG_CURRENT_DESKTOP ?? ''}:${process.env.DESKTOP_SESSION ?? ''}`.toLowerCase()
  if (process.platform !== 'linux' || !desktop.includes('gnome')) return defaultWindowButtonLayout

  try {
    const { stdout } = await execFile('gsettings', ['get', 'org.gnome.desktop.wm.preferences', 'button-layout'])
    const [left = '', right = ''] = stdout.trim().replace(/^'|'$/g, '').split(':', 2)
    return { left: parseWindowButtons(left), right: parseWindowButtons(right) }
  } catch (error) {
    console.warn('Could not read the GNOME window button layout.', error)
    return defaultWindowButtonLayout
  }
}

function registerWindowIpc() {
  ipcMain.handle('window:button-layout', () => getWindowButtonLayout())
  ipcMain.handle('window:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize())
  ipcMain.handle('window:toggle-maximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return false
    if (window.isMaximized()) {
      window.unmaximize()
      return false
    }
    window.maximize()
    return true
  })
  ipcMain.handle('window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close())
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#11131a',
    icon: appIconPath(),
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  mainWindow.setMenuBarVisibility(false)

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }
}

const COVER_PATTERN = /^cover\.(jpe?g|png|webp)$/i

function registerCoverProtocol() {
  protocol.handle('ramses-cover', async (request) => {
    const notFound = () => new Response('Not found', { status: 404 })
    try {
      const songName = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''))
      const root = resolve(songsDirectory())
      if (!songName || songName !== basename(songName) || songName.includes('\0')) return notFound()
      const directory = resolve(root, songName)
      if (!directory.startsWith(`${root}${sep}`)) return notFound()
      const cover = (await readdir(directory)).find((file) => COVER_PATTERN.test(file))
      if (!cover) return notFound()
      return net.fetch(pathToFileURL(join(directory, cover)).toString())
    } catch {
      return notFound()
    }
  })
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  registerCoverProtocol()
  registerSongIpc()
  registerStemImportIpc()
  registerMixIpc()
  registerWindowIpc()
  createWindow()
})

app.on('window-all-closed', () => {
  app.quit()
})
