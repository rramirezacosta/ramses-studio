import { randomUUID } from 'node:crypto'
import { app, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'

import { SIX_STEM_NAMES } from '../../src/components/stemsplitter/constants'
import { YoutubeIE } from '../../src/components/youtube/extractor/youtube.js'
import { selectFormats, sortFormats } from '../../src/components/youtube/format.js'
import { downloadFile } from '../../src/components/youtube/downloader.js'
import type { SeparateWorkerData, SeparateWorkerMessage } from '../separation-worker'
import type { StereoAudio, StemName } from '../../src/components/stemsplitter/types'

const moduleDirectory = dirname(fileURLToPath(import.meta.url))
const nativeModelPath = () => app.isPackaged
  ? join(process.resourcesPath, 'models', 'htdemucs_6s.onnx')
  : join(app.getAppPath(), 'src', 'components', 'stemsplitter', 'htdemucs_6s.onnx')

/** Raw separation output is handed to the renderer one stem at a time for WASM encoding. */
const pendingStems = new Map<string, Map<StemName, Uint8Array>>()

function discardPendingStems(jobId: string): void {
  pendingStems.delete(jobId)
}

function takePendingStem(jobId: string, name: StemName): Uint8Array | null {
  const stems = pendingStems.get(jobId)
  if (!stems) return null
  const data = stems.get(name)
  if (!data) return null
  stems.delete(name)
  if (!stems.size) pendingStems.delete(jobId)
  return data
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

const safeFileName = (value: string) =>
  value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim() || 'audio'

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
  const uploader = info.uploader || ''
  const thumbnailUrl = info.thumbnail || ''
  const musicVideoType = info.music_video_type || ''

  // Decide whether the channel uploader is the actual artist.
  // Official music videos (ATV, OMV, etc.) and Topic channels are artist-uploaded.
  // UGC (user-generated content) videos are third-party uploads—the artist, if any,
  // is usually embedded in the title itself (e.g. "Liquits - Desde Que").
  const isOfficialMusic =
    musicVideoType === 'MUSIC_VIDEO_TYPE_ATV' ||
    musicVideoType === 'MUSIC_VIDEO_TYPE_OMV' ||
    musicVideoType === 'MUSIC_VIDEO_TYPE_PRIVATELY_OWNED_TRACK' ||
    musicVideoType === 'MUSIC_VIDEO_TYPE_ATC' ||
    uploader.endsWith(' - Topic')

  // For official music, the uploader is the artist; for UGC, the title may already
  // contain "Artist - Title" and should be used as-is.
  const rawSourceTitle = isOfficialMusic && uploader ? `${uploader} - ${title}` : title
  const sourceTitle = safeFileName(rawSourceTitle)

  // Select the best audio-only format
  const chosen = selectFormats(info, 'bestaudio')
  if (!chosen.length) {
    throw new Error('No suitable audio format found for this video')
  }

  // Download audio. The renderer decodes the source with WebAssembly FFmpeg,
  // so no native converter (or WAV staging) is needed here.
  let audioDownloaded = false
  let lastError: string | null = null
  for (const fmt of chosen) {
    if (!fmt.url) continue
    const ext = safeFileName(fmt.ext || 'm4a')
    const outName = join(directory, `${sourceTitle}.${ext}`)
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
      notifyStage('Preparing audio...')
      return { sourceName: outName, thumbnailPath }
    }
    lastError = `Format ${fmt.format_id} download failed`
  }

  // If audio-only formats fail, fall back to best combined format
  if (!audioDownloaded) {
    const allFormats = sortFormats(info.formats || [])
    const combinedFormats = allFormats.filter((f: any) => f.vcodec !== 'none' && f.acodec !== 'none').reverse()
    for (const fmt of combinedFormats) {
      if (!fmt.url) continue
      const ext = safeFileName(fmt.ext || 'mp4')
      const outName = join(directory, `${sourceTitle}.${ext}`)
      const ok = await downloadFile({ url: fmt.url, filename: outName, quiet: false })
      if (ok) {
        let thumbnailPath: string | undefined
        if (thumbnailUrl) {
          notifyStage('Downloading thumbnail...')
          const thumbName = join(directory, 'thumbnail.jpg')
          await downloadFile({ url: thumbnailUrl, filename: thumbName, quiet: true })
          thumbnailPath = thumbName
        }
        notifyStage('Preparing audio...')
        return { sourceName: outName, thumbnailPath }
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

  // Dropped files arrive as raw bytes; stage them in a temp dir so the normal
  // import pipeline (which works with paths) can pick them up.
  ipcMain.handle('files:stage-buffer', async (_event, fileName: unknown, bytes: unknown) => {
    if (typeof fileName !== 'string' || !fileName.trim()) throw new Error('Invalid file name.')
    if (!(bytes instanceof Uint8Array)) throw new Error('Invalid file data.')
    const safeName = fileName.split(/[\\/]/).pop() || 'audio'
    const directory = await mkdtemp(join(tmpdir(), 'ramses-studio-'))
    const path = join(directory, safeName)
    await writeFile(path, bytes)
    return path
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

  // Separation stays in the native worker (ONNX), but its raw WAV output is handed
  // back to the renderer for MP3 encoding with the bundled WASM FFmpeg.
  ipcMain.handle('songs:separate-native', async (event, audio: unknown): Promise<{ jobId: string; stems: StemName[] }> => {
    assertStereoAudio(audio)
    const model = nativeModelPath()
    try {
      await stat(model)
    } catch {
      throw new Error('The native StemSplitter model is missing from this application.')
    }
    notifyImportStage(event, 'Loading model...')
    const wavs = await runSeparationWorker(event, model, audio)
    const jobId = randomUUID()
    pendingStems.set(jobId, new Map(SIX_STEM_NAMES.map((name) => [name, wavs[name]])))
    return { jobId, stems: [...SIX_STEM_NAMES] }
  })

  ipcMain.handle('stems:take', (_event, jobId: unknown, name: unknown) => {
    if (typeof jobId !== 'string' || typeof name !== 'string' || !SIX_STEM_NAMES.includes(name as StemName)) {
      throw new Error('Invalid stem request.')
    }
    const data = takePendingStem(jobId, name as StemName)
    if (!data) throw new Error('Stem data is no longer available.')
    return data
  })

  ipcMain.handle('stems:discard', (_event, jobId: unknown) => {
    if (typeof jobId !== 'string') throw new Error('Invalid stem request.')
    discardPendingStems(jobId)
    return true
  })
}
