import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import coreJsUrl from '@ffmpeg/core?url';
import coreWasmUrl from '@ffmpeg/core/wasm?url';
import type { StereoAudio } from '../types.js';

let ffmpegPromise: Promise<FFmpeg> | null = null
let ffmpegQueue: Promise<void> = Promise.resolve()

async function getFfmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const ffmpeg = new FFmpeg()
      const coreURL = await toBlobURL(coreJsUrl, 'text/javascript')
      const wasmURL = await toBlobURL(coreWasmUrl, 'application/wasm')
      await ffmpeg.load({ coreURL, wasmURL })
      return ffmpeg
    })()
  }
  return ffmpegPromise
}

/** @ffmpeg/ffmpeg exposes a single instance with a shared virtual filesystem, so work must be serialized. */
function withFfmpeg<T>(work: (ffmpeg: FFmpeg) => Promise<T>): Promise<T> {
  const run = ffmpegQueue.then(async () => work(await getFfmpeg()))
  ffmpegQueue = run.then(() => undefined, () => undefined)
  return run
}

async function cleanup(ffmpeg: FFmpeg, ...names: string[]): Promise<void> {
  await Promise.all(names.map((name) => ffmpeg.deleteFile(name).catch(() => undefined)))
}

export async function decodeWithFfmpeg(
  input: Uint8Array | ArrayBuffer | string,
  _executable?: string,
  signal?: AbortSignal,
): Promise<StereoAudio> {
  return withFfmpeg(async (ffmpeg) => {
    const inputName = 'input'
    const outputName = 'output.pcm'
    const data = typeof input === 'string' ? await fetchFile(input) : new Uint8Array(input)
    await ffmpeg.writeFile(inputName, data)
    try {
      // No loudness processing: the separator normalizes each chunk statistically,
      // so the source's own level and dynamics are preserved into the stems.
      const args = ['-v', 'error', '-i', inputName, '-ar', '44100', '-ac', '2', '-f', 's16le', outputName]
      await ffmpeg.exec(args, -1, { signal })
      const pcm = (await ffmpeg.readFile(outputName)) as Uint8Array

      if (pcm.length % 4 !== 0) throw new Error('ffmpeg returned incomplete stereo PCM audio.')
      const frames = pcm.length / 4
      const left = new Float32Array(frames)
      const right = new Float32Array(frames)
      const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
      for (let frame = 0; frame < frames; frame += 1) {
        left[frame] = view.getInt16(frame * 4, true) / 32768
        right[frame] = view.getInt16(frame * 4 + 2, true) / 32768
      }
      return { left, right, sampleRate: 44_100 }
    } finally {
      await cleanup(ffmpeg, inputName, outputName)
    }
  })
}

export async function encodeMp3WithFfmpeg(wav: Uint8Array | ArrayBuffer, signal?: AbortSignal): Promise<Uint8Array> {
  return withFfmpeg(async (ffmpeg) => {
    const inputName = 'encode-input.wav'
    const outputName = 'encode-output.mp3'
    await ffmpeg.writeFile(inputName, new Uint8Array(wav))
    try {
      await ffmpeg.exec(['-v', 'error', '-y', '-i', inputName, '-codec:a', 'libmp3lame', '-q:a', '2', outputName], -1, { signal })
      return new Uint8Array((await ffmpeg.readFile(outputName)) as Uint8Array)
    } finally {
      await cleanup(ffmpeg, inputName, outputName)
    }
  })
}

/** Produce a square 300x300 JPEG from an image or from embedded media art. Returns null when there is no usable image. */
export async function createCoverArt(input: Uint8Array | ArrayBuffer, signal?: AbortSignal): Promise<Uint8Array | null> {
  return withFfmpeg(async (ffmpeg) => {
    const inputName = 'cover-input'
    const outputName = 'cover.jpg'
    await ffmpeg.writeFile(inputName, new Uint8Array(input))
    try {
      await ffmpeg.exec([
        '-v', 'error', '-y', '-i', inputName, '-map', '0:v:0', '-frames:v', '1',
        '-vf', 'scale=300:300:force_original_aspect_ratio=increase,crop=300:300',
        '-q:v', '7', outputName,
      ], -1, { signal })
      return new Uint8Array((await ffmpeg.readFile(outputName)) as Uint8Array)
    } catch {
      return null
    } finally {
      await cleanup(ffmpeg, inputName, outputName)
    }
  })
}

export const encodeMp3 = encodeMp3WithFfmpeg
export const encodeWithFfmpeg = encodeMp3WithFfmpeg
