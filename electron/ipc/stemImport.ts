import { app, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { Separator } from '../../src/components/stemsplitter/separator'
import { decodeWithFfmpeg } from '../../src/components/stemsplitter/audio/ffmpeg'
import { SIX_STEM_NAMES } from '../../src/components/stemsplitter/constants'
import type { SeparationResult, StemName, StereoAudio } from '../../src/components/stemsplitter/types'
import { ensureSongsDirectory, songsDirectory } from '../paths'

const execFile = promisify(execFileCallback)
const nativeModelPath = () => app.isPackaged
  ? join(process.resourcesPath, 'models', 'htdemucs_6s.onnx')
  : join(app.getAppPath(), 'src', 'components', 'stemsplitter', 'htdemucs_6s.onnx')
const webGpuModelPath = () => app.isPackaged
  ? join(process.resourcesPath, 'models', 'htdemucs_6s_webgpu.onnx')
  : join(app.getAppPath(), 'src', 'components', 'stemsplitter', 'htdemucs_6s_webgpu.onnx')
export const ffmpegPath = () => app.isPackaged && process.platform === 'win32'
  ? join(process.resourcesPath, 'bin', 'ffmpeg.exe')
  : 'ffmpeg'
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

function assertStemWavs(value: unknown): asserts value is Record<StemName, Uint8Array> {
  if (!value || typeof value !== 'object') throw new Error('Invalid stem output.')
  for (const stem of SIX_STEM_NAMES) {
    if (!((value as Record<string, unknown>)[stem] instanceof Uint8Array)) throw new Error(`Missing WAV data for "${stem}".`)
  }
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

async function downloadYouTubeAudio(url: string, notifyStage: (stage: string) => void): Promise<{ sourceName: string; audio: StereoAudio }> {
  const executable = ytDlpPath()
  try {
    await stat(executable)
  } catch {
    throw new Error('The yt-dlp binary is missing from this application.')
  }

  const directory = await mkdtemp(join(tmpdir(), 'ramses-ytdlp-'))
  try {
    const args = ['--no-playlist', '--no-progress', '--extract-audio', '--audio-format', 'mp3', '--output', join(directory, '%(title)s.%(ext)s')]
    if (process.platform === 'win32') args.push('--ffmpeg-location', dirname(ffmpegPath()))
    args.push(url)
    try {
      notifyStage('Downloading audio...')
      await execFile(executable, args, { maxBuffer: 10 * 1024 * 1024 })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Could not download YouTube audio: ${message}`)
    }

    const files = await readdir(directory)
    const sourceFile = files.find((file) => extname(file).toLowerCase() === '.mp3')
    if (!sourceFile) throw new Error('yt-dlp did not produce an MP3 file.')
    const sourceName = join(directory, sourceFile)
    notifyStage('Decoding audio...')
    return { sourceName, audio: await decodeWithFfmpeg(sourceName, ffmpegPath()) }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export function registerStemImportIpc() {
  ipcMain.handle('songs:prepare-import', async (event) => {
    const selection = await dialog.showOpenDialog({
      title: 'Import audio for stem separation',
      properties: ['openFile'],
      filters: [{ name: 'Audio files', extensions: ['wav', 'flac', 'mp3'] }],
    })
    if (selection.canceled || !selection.filePaths[0]) return null

    const inputPath = selection.filePaths[0]
    notifyImportStage(event, 'Decoding audio...')
    const input = await decodeWithFfmpeg(inputPath, ffmpegPath())
    return { sourceName: inputPath, audio: input }
  })

  ipcMain.handle('songs:prepare-youtube-import', async (_event, url: unknown) => {
    if (typeof url !== 'string') throw new Error('Enter a YouTube URL.')
    return downloadYouTubeAudio(validateYouTubeUrl(url), (stage) => notifyImportStage(_event, stage))
  })

  ipcMain.handle('models:webgpu', async () => {
    const model = webGpuModelPath()
    try {
      await stat(model)
    } catch {
      throw new Error('The WebGPU StemSplitter model is missing from this application.')
    }
    return readFile(model)
  })

  ipcMain.handle('songs:separate-native', async (event, audio: unknown, forceCpu: unknown): Promise<SeparationResult<StemName>> => {
    assertStereoAudio(audio)
    const model = nativeModelPath()
    try {
      await stat(model)
    } catch {
      throw new Error('The native StemSplitter model is missing from this application.')
    }
    const separator = await Separator.create({
      modelPath: model,
      executionProviders: forceCpu === true ? ['cpu'] : undefined,
      lowMemory: true,
      targetStems: [...SIX_STEM_NAMES],
      onProgress: (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send('songs:import-progress', progress)
      },
    })
    if (separator.usesCpu() && !event.sender.isDestroyed()) event.sender.send('songs:import-cpu-fallback')
    try {
      const stems = await separator.separate(audio)
      const sixStemResult = stems as Partial<SeparationResult<StemName>>
      for (const stem of SIX_STEM_NAMES) {
        if (!sixStemResult[stem]) throw new Error(`The native model did not return the "${stem}" stem.`)
      }
      return sixStemResult as SeparationResult<StemName>
    } finally {
      await separator.dispose()
    }
  })

  ipcMain.handle('songs:save-import', async (event, request: { sourceName?: unknown; stems?: unknown }) => {
    if (typeof request?.sourceName !== 'string') throw new Error('Invalid import source.')
    assertStemWavs(request.stems)
    await ensureSongsDirectory()
    return saveStems(request.sourceName, request.stems, () => notifyImportStage(event, 'Encoding stems as MP3...'))
  })
}
