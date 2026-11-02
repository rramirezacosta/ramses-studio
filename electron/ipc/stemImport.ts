import { app, dialog, ipcMain } from 'electron'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { Separator } from '../../src/components/stemsplitter/separator'
import { decodeWithFfmpeg } from '../../src/components/stemsplitter/audio/ffmpeg'
import { encodeWav } from '../../src/components/stemsplitter/audio/wav'
import { SIX_STEM_NAMES } from '../../src/components/stemsplitter/constants'
import { ensureSongsDirectory, songsDirectory } from '../paths'

const modelPath = () => app.isPackaged
  ? join(process.resourcesPath, 'models', 'htdemucs_6s.onnx')
  : join(app.getAppPath(), 'src', 'components', 'stemsplitter', 'htdemucs_6s.onnx')
const ffmpegPath = () => app.isPackaged && process.platform === 'win32'
  ? join(process.resourcesPath, 'bin', 'ffmpeg.exe')
  : 'ffmpeg'

function songNameFrom(filePath: string) {
  const name = basename(filePath, extname(filePath))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  return name || 'imported-song'
}

async function uniqueSongDirectory(name: string) {
  const root = songsDirectory()
  for (let suffix = 1; ; suffix += 1) {
    const candidate = join(root, suffix === 1 ? name : `${name}-${suffix}`)
    try {
      await stat(candidate)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return candidate
      throw error
    }
  }
}

export function registerStemImportIpc() {
  ipcMain.handle('songs:import', async (event) => {
    const selection = await dialog.showOpenDialog({
      title: 'Import audio for stem separation',
      properties: ['openFile'],
      filters: [{ name: 'Audio files', extensions: ['wav', 'flac', 'mp3'] }],
    })
    if (selection.canceled || !selection.filePaths[0]) return null

    const inputPath = selection.filePaths[0]
    await ensureSongsDirectory()
    const input = await decodeWithFfmpeg(inputPath, ffmpegPath())
    const model = modelPath()
    try {
      await stat(model)
    } catch {
      throw new Error('StemSplitter model is missing from this application.')
    }

    const separator = await Separator.create({
      modelPath: model,
      lowMemory: true,
      targetStems: [...SIX_STEM_NAMES],
      onProgress: (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send('songs:import-progress', progress)
      },
    })
    try {
      const stems = await separator.separate(input)
      const directory = await uniqueSongDirectory(songNameFrom(inputPath))
      await mkdir(directory, { recursive: true })
      await Promise.all(Object.entries(stems).map(([name, stem]) => writeFile(join(directory, `${name}.wav`), encodeWav(stem))))
      return {
        name: basename(directory),
        stems: Object.keys(stems).map((name) => `${name}.wav`).sort(),
      }
    } finally {
      await separator.dispose()
    }
  })
}
