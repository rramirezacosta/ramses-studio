import { app, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { execFile as execFileCallback, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { Worker } from 'node:worker_threads'

import { SIX_STEM_NAMES } from '../../src/components/stemsplitter/constants'
import { ensureSongsDirectory, songsDirectory } from '../paths'
import type { SeparateWorkerData, SeparateWorkerMessage } from '../separation-worker'
import type { StereoAudio, StemName } from '../../src/components/stemsplitter/types'

const execFile = promisify(execFileCallback)
const moduleDirectory = dirname(fileURLToPath(import.meta.url))
const nativeModelPath = () => app.isPackaged
  ? join(process.resourcesPath, 'models', 'htdemucs_6s.onnx')
  : join(app.getAppPath(), 'src', 'components', 'stemsplitter', 'htdemucs_6s.onnx')
export const ffmpegPath = () => 'ffmpeg'
const ytDlpPath = () => {
  const executable = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
  return app.isPackaged
    ? join(process.resourcesPath, 'bin', executable)
    : join(app.getAppPath(), 'vendor', 'ytdlp', process.platform, 'x64', process.platform === 'win32' ? executable : 'yt-dlp_linux')
}

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

function assertStereoAudio(value: unknown): asserts value is StereoAudio {
  const audio = value as StereoAudio
  if (!(audio?.left instanceof Float32Array) || !(audio.right instanceof Float32Array) || audio.left.length !== audio.right.length || audio.sampleRate !== 44_100) {
    throw new Error('Invalid audio input.')
  }
}

function transferableBuffers(audio: StereoAudio): ArrayBuffer[] {
  const left = audio.left.buffer as ArrayBuffer
  const right = (audio.right ?? audio.left).buffer as ArrayBuffer
  return left === right ? [left] : [left, right]
}

let activeSeparationWorker: Worker | null = null
let activeYouTubeProcess: ChildProcess | null = null

function runSeparationWorker(event: IpcMainInvokeEvent, modelPath: string, audio: StereoAudio): Promise<Record<string, Uint8Array>> {
  const request: SeparateWorkerData = { modelPath, audio }
  return new Promise((resolve, reject) => {
    let settled = false
    const worker = new Worker(join(moduleDirectory, 'separation-worker.cjs'), {
      workerData: request,
      transferList: transferableBuffers(audio),
    })
    activeSeparationWorker = worker
    const fail = (reason: string) => {
      if (settled) return
      settled = true
      activeSeparationWorker = null
      reject(new Error(reason))
      worker.terminate()
    }
    worker.on('message', (message: SeparateWorkerMessage) => {
      if (message.type === 'progress') {
        if (!event.sender.isDestroyed()) event.sender.send('songs:import-progress', message.progress)
        return
      }
      if (message.type === 'error') {
        fail(message.message)
        return
      }
      settled = true
      activeSeparationWorker = null
      resolve(message.wavs)
    })
    worker.on('error', (error) => fail(`Could not run stem separation: ${error.message}`))
    worker.on('exit', (code) => {
      if (!settled) fail(`The stem separation worker exited unexpectedly (code ${code}).`)
      activeSeparationWorker = null
    })
  })
}

function notifyImportStage(event: IpcMainInvokeEvent, stage: string): void {
  if (!event.sender.isDestroyed()) event.sender.send('songs:import-stage', stage)
}

async function saveStems(inputPath: string, stems: Record<StemName, Uint8Array>, notifyStage: () => void) {
  const directory = await uniqueSongDirectory(songNameFrom(inputPath))
  await mkdir(directory, { recursive: true })
  const wavPaths = Object.fromEntries(SIX_STEM_NAMES.map((name) => [name, join(directory, `${name}.wav`)])) as Record<StemName, string>
  try {
    await Promise.all(SIX_STEM_NAMES.map((name) => writeFile(wavPaths[name], stems[name])))
    notifyStage()
    await Promise.all(SIX_STEM_NAMES.map((name) => execFile(ffmpegPath(), ['-v', 'error', '-y', '-i', wavPaths[name], '-codec:a', 'libmp3lame', '-q:a', '2', join(directory, `${name}.mp3`)])))
    await Promise.all(SIX_STEM_NAMES.map((name) => rm(wavPaths[name])))
    return {
      name: basename(directory),
      stems: SIX_STEM_NAMES.map((name) => `${name}.mp3`).sort(),
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

function validateYouTubeUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Enter a valid YouTube URL.')
  }
  const host = url.hostname.toLowerCase()
  if (!(host === 'youtu.be' || host.endsWith('.youtu.be') || host === 'youtube.com' || host.endsWith('.youtube.com'))) {
    throw new Error('Enter a YouTube URL.')
  }
  return url.toString()
}

async function downloadYouTubeAudio(url: string, notifyStage: (stage: string) => void): Promise<{ sourceName: string }> {
  const executable = ytDlpPath()
  try {
    await stat(executable)
  } catch {
    throw new Error('The yt-dlp binary is missing from this application.')
  }

  const directory = await mkdtemp(join(tmpdir(), 'ramses-ytdlp-'))
  const args = ['--no-playlist', '--newline', '--extract-audio', '--audio-format', 'mp3', '--output', join(directory, '%(title)s.%(ext)s')]
  if (process.platform === 'win32') args.push('--ffmpeg-location', dirname(ffmpegPath()))
  args.push(url)
  try {
    await new Promise<void>((resolve, reject) => {
      const child = execFileCallback(executable, args, { maxBuffer: 10 * 1024 * 1024 }, (error) => {
        if (error) reject(error)
        else resolve()
      })
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        const match = chunk.match(/\[download\]\s+([\d.]+)%/)
        if (match) notifyStage(`Downloading audio... ${Math.round(Number(match[1]))}%`)
      })
      activeYouTubeProcess = child
    })
    notifyStage('Downloading audio... 100%')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not download YouTube audio: ${message}`)
  }

  const files = await readdir(directory)
  const sourceFile = files.find((file) => extname(file).toLowerCase() === '.mp3')
  if (!sourceFile) throw new Error('yt-dlp did not produce an MP3 file.')
  const sourceName = join(directory, sourceFile)
  notifyStage('Preparing audio...')
  return { sourceName }
}

export function cancelActiveImport() {
  if (activeSeparationWorker) {
    try { activeSeparationWorker.postMessage({ type: 'cancel' }) } catch { /* ignore */ }
  }
  if (activeYouTubeProcess) {
    activeYouTubeProcess.kill()
    activeYouTubeProcess = null
  }
}

export function registerStemImportIpc() {
  ipcMain.handle('songs:cancel-import', () => {
    cancelActiveImport()
    return true
  })
  ipcMain.handle('files:read-buffer', async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string') throw new Error('Invalid file path.')
    return readFile(filePath)
  })

  ipcMain.handle('songs:prepare-import', async (event) => {
    const selection = await dialog.showOpenDialog({
      title: 'Import audio for stem separation',
      properties: ['openFile'],
      filters: [{ name: 'Audio files', extensions: ['wav', 'flac', 'mp3'] }],
    })
    if (selection.canceled || !selection.filePaths[0]) return null

    const inputPath = selection.filePaths[0]
    notifyImportStage(event, 'Preparing audio...')
    return { sourceName: inputPath }
  })

  ipcMain.handle('songs:prepare-youtube-import', async (_event, url: unknown) => {
    if (typeof url !== 'string') throw new Error('Enter a YouTube URL.')
    return downloadYouTubeAudio(validateYouTubeUrl(url), (stage) => notifyImportStage(_event, stage))
  })

  ipcMain.handle('songs:separate-native', async (event, sourceName: unknown, audio: unknown): Promise<{ name: string; stems: string[] }> => {
    if (typeof sourceName !== 'string') throw new Error('Invalid import source.')
    assertStereoAudio(audio)
    const model = nativeModelPath()
    try {
      await stat(model)
    } catch {
      throw new Error('The native StemSplitter model is missing from this application.')
    }
    const wavs = await runSeparationWorker(event, model, audio)
    await ensureSongsDirectory()
    return saveStems(sourceName, wavs, () => notifyImportStage(event, 'Encoding stems as MP3...'))
  })
}
