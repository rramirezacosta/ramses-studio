import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerStemImportIpc } from './ipc/stemImport'
import { registerMixIpc } from './ipc/mixExport'

if (process.platform === 'linux') app.commandLine.appendSwitch('enable-features', 'Vulkan')

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

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  registerStemImportIpc()
  registerMixIpc()
  registerWindowIpc()
  createWindow()
})

app.on('window-all-closed', () => {
  app.quit()
})
