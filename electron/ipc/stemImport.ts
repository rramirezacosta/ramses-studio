import { app, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { execFile as execFileCallback } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { Worker } from 'node:worker_threads'

import { SIX_STEM_NAMES } from '../../src/components/stemsplitter/constants'
import { YoutubeIE } from '../../src/components/youtube/extractor/youtube.js'
import { selectFormats, sortFormats } from '../../src/components/youtube/format.js'
import { downloadFile } from '../../src/components/youtube/downloader.js'
import { ensureSongsDirectory, songsDirectory } from '../paths'
import type { SeparateWorkerData, SeparateWorkerMessage } from '../separation-worker'
import type { StereoAudio, StemName } from '../../src/components/stemsplitter/types'

const execFile = promisify(execFileCallback)
const moduleDirectory = dirname(fileURLToPath(import.meta.url))
const nativeModelPath = () => app.isPackaged
  ? join(process.resourcesPath, 'models', 'htdemucs_6s.onnx')
  : join(app.getAppPath(), 'src', 'components', 'stemsplitter', 'htdemucs_6s.onnx')
export const ffmpegPath = () => 'ffmpeg'

const slugPart = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

function songNameFrom(filePath: string) {
  const base = basename(filePath, extname(filePath)).toLowerCase()
  const boundary = base.indexOf(' - ')
  if (boundary > 0) {
    const parts = [slugPart(base.slice(0, boundary)), slugPart(base.slice(boundary + 3))]
      .filter(Boolean)
    if (parts.length) return parts.join('--')
  }
  return slugPart(base) || 'imported-song'
}

async function uniqueSongDirectory(name: string) {
  const root = songsDirectory()
  // suffix 0 probes the base name; the first duplicate becomes name-1 (not name-2).
  for (let suffix = 0; ; suffix += 1) {
    const candidate = join(root, suffix === 0 ? name : `${name}-${suffix}`)
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

const IMAGE_PATTERN = /\.(jpe?g|webp|png)$/i

/**Extract one frame (typically the embedded picture) as a raw image, or null when the media has none. */
async function extractEmbeddedArt(sourcePath: string, temp: string): Promise<string | null> {
  if (!existsSync(sourcePath)) return null
  const target = join(temp, 'embedded.png')
  try {
    await execFile(ffmpegPath(), ['-v', 'error', '-i', sourcePath, '-map', '0:v', '-frames:v', '1', '-y', target])
  } catch {
    return null
  }
  try {
    await stat(target)
    return target
  } catch {
    return null
  }
}

/** Produce a square 300x300 JPEG cover for the song, or null when no source image is available. */
async function createCoverArt(sourcePath: string, thumbnailPath?: string): Promise<Buffer | null> {
  const temp = await mkdtemp(join(tmpdir(), 'ramses-cover-'))
  try {
    let raw: string | null = null
    // Use the downloaded YouTube thumbnail if available
    if (thumbnailPath) raw = thumbnailPath
    if (!raw) raw = await extractEmbeddedArt(sourcePath, temp)
    if (!raw) return null
    const square = join(temp, 'cover.jpg')
    await execFile(ffmpegPath(), ['-v', 'error', '-y', '-i', raw, '-vf', 'scale=300:300:force_original_aspect_ratio=increase,crop=300:300', '-frames:v', '1', '-q:v', '7', square])
    return await readFile(square)
  } catch {
    return null
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function saveStems(inputPath: string, stems: Record<StemName, Uint8Array>, notifyStage: () => void, thumbnailPath?: string) {
  const directory = await uniqueSongDirectory(songNameFrom(inputPath))
  await mkdir(directory, { recursive: true })
  const wavPaths = Object.fromEntries(SIX_STEM_NAMES.map((name) => [name, join(directory, `${name}.wav`)])) as Record<StemName, string>
  try {
    await Promise.all(SIX_STEM_NAMES.map((name) => writeFile(wavPaths[name], stems[name])))
    notifyStage()
    await Promise.all(SIX_STEM_NAMES.map((name) => execFile(ffmpegPath(), ['-v', 'error', '-y', '-i', wavPaths[name], '-codec:a', 'libmp3lame', '-q:a', '2', join(directory, `${name}.mp3`)])))
    await Promise.all(SIX_STEM_NAMES.map((name) => rm(wavPaths[name])))
    try {
      const cover = await createCoverArt(inputPath, thumbnailPath)
      if (cover) await writeFile(join(directory, 'cover.jpg'), cover)
    } catch {
      // Cover art is best-effort; a failed extraction must not discard the stems.
    }
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

async function downloadYouTubeAudio(url: string, notifyStage: (stage: string) => void): Promise<{ sourceName: string; thumbnailPath?: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'ramses-youtube-'))

  // Fetch video info using the pure-JS YouTube extractor
  notifyStage('Fetching video info...')
  const ie = new YoutubeIE()
  let info: any
  try {
    info = await ie.realExtract(url)
  } catch (error: any) {
    throw new Error(`Could not fetch YouTube video info: ${error?.message || error}`)
  }

  const title = info.title || info.id || 'unknown'
  const thumbnailUrl = info.thumbnail || ''

  // Select the best audio-only format
  const chosen = selectFormats(info, 'bestaudio')
  if (!chosen.length) {
    throw new Error('No suitable audio format found for this video')
  }

  // Download audio
  let audioDownloaded = false
  let lastError: string | null = null
  for (const fmt of chosen) {
    if (!fmt.url) continue
    const ext = fmt.ext || 'm4a'
    const outName = join(directory, `${title}.${ext}`)
    const ok = await downloadFile({ url: fmt.url, filename: outName, quiet: false })
    if (ok) {
      audioDownloaded = true
      // Download thumbnail alongside the audio
      let thumbnailPath: string | undefined
      if (thumbnailUrl) {
        notifyStage('Downloading thumbnail...')
        const thumbName = join(directory, 'thumbnail.jpg')
        await downloadFile({ url: thumbnailUrl, filename: thumbName, quiet: true })
        thumbnailPath = thumbName
      }
      // Convert audio to WAV (PCM 16-bit, 44100Hz, stereo)
      notifyStage('Converting to WAV...')
      const wavPath = join(directory, `${title}.wav`)
      try {
        await execFile(
          ffmpegPath(),
          ['-v', 'error', '-y', '-i', outName, '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2', wavPath]
        )
      } catch (error: any) {
        throw new Error(`Could not convert audio to WAV: ${error?.message || error}`)
      }
      return { sourceName: wavPath, thumbnailPath }
    }
    lastError = `Format ${fmt.format_id} download failed`
  }

  // If audio-only formats fail, fall back to best combined format
  if (!audioDownloaded) {
    const allFormats = sortFormats(info.formats || [])
    const combinedFormats = allFormats.filter((f: any) => f.vcodec !== 'none' && f.acodec !== 'none').reverse()
    for (const fmt of combinedFormats) {
      if (!fmt.url) continue
      const ext = fmt.ext || 'mp4'
      const outName = join(directory, `${title}.${ext}`)
      const ok = await downloadFile({ url: fmt.url, filename: outName, quiet: false })
      if (ok) {
        let thumbnailPath: string | undefined
        if (thumbnailUrl) {
          notifyStage('Downloading thumbnail...')
          const thumbName = join(directory, 'thumbnail.jpg')
          await downloadFile({ url: thumbnailUrl, filename: thumbName, quiet: true })
          thumbnailPath = thumbName
        }
        notifyStage('Converting to WAV...')
        const wavPath = join(directory, `${title}.wav`)
        try {
          await execFile(
            ffmpegPath(),
            ['-v', 'error', '-y', '-i', outName, '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2', wavPath]
          )
        } catch (error: any) {
          throw new Error(`Could not convert audio to WAV: ${error?.message || error}`)
        }
        return { sourceName: wavPath, thumbnailPath }
      }
      lastError = `Fallback format ${fmt.format_id} download failed`
    }
  }

  throw new Error(`Failed to download YouTube audio: ${lastError || 'no formats available'}`)
}

export function cancelActiveImport() {
  if (activeSeparationWorker) {
    try { activeSeparationWorker.postMessage({ type: 'cancel' }) } catch { /* ignore */ }
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

  // Lets the renderer ask before importing so the user can replace or keep both copies.
  ipcMain.handle('songs:duplicate-check', async (_event, sourceName: unknown): Promise<{ exists: boolean; name: string }> => {
    if (typeof sourceName !== 'string' || !sourceName.trim()) throw new Error('Invalid source name.')
    const name = songNameFrom(sourceName)
    try {
      await stat(join(songsDirectory(), name))
      return { exists: true, name }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false, name }
      throw error
    }
  })

  ipcMain.handle('songs:separate-native', async (event, sourceName: unknown, audio: unknown, thumbnailPath: unknown): Promise<{ name: string; stems: string[] }> => {
    if (typeof sourceName !== 'string') throw new Error('Invalid import source.')
    assertStereoAudio(audio)
    const model = nativeModelPath()
    try {
      await stat(model)
    } catch {
      throw new Error('The native StemSplitter model is missing from this application.')
    }
    notifyImportStage(event, 'Loading model...')
    const wavs = await runSeparationWorker(event, model, audio)
    await ensureSongsDirectory()
    const thumbPath = typeof thumbnailPath === 'string' ? thumbnailPath : undefined
    return saveStems(sourceName, wavs, () => notifyImportStage(event, 'Encoding stems as MP3...'), thumbPath)
  })
}
