import { parentPort, workerData } from 'node:worker_threads'
import { Separator } from '../src/components/stemsplitter/separator'
import { encodeWav } from '../src/components/stemsplitter/audio/wav'
import { SIX_STEM_NAMES } from '../src/components/stemsplitter/constants'
import type { ProgressInfo, SeparationResult, StereoAudio, StemName } from '../src/components/stemsplitter/types'

export interface SeparateWorkerData {
  modelPath: string
  audio: StereoAudio
}

export type SeparateWorkerMessage =
  | { type: 'progress'; progress: ProgressInfo }
  | { type: 'done'; wavs: Record<string, Uint8Array> }
  | { type: 'error'; message: string }

const request = workerData as SeparateWorkerData

const cancelController = new AbortController()
if (parentPort) {
  parentPort.on('message', (message: { type?: string } | null) => {
    if (message?.type === 'cancel') cancelController.abort()
  })
}

function post(message: SeparateWorkerMessage): void {
  if (parentPort) parentPort.postMessage(message)
}

function throttle<T extends unknown[]>(callback: (...arguments_: T) => void, intervalMs: number): (...arguments_: T) => void {
  let lastSent = 0
  return (...arguments_: T) => {
    const now = Date.now()
    if (now - lastSent < intervalMs) return
    lastSent = now
    callback(...arguments_)
  }
}

async function run(): Promise<void> {
  if (!parentPort) throw new Error('The separation worker requires a parent port.')
  const separator = await Separator.create({
    modelPath: request.modelPath,
    lowMemory: true,
    targetStems: [...SIX_STEM_NAMES],
    signal: cancelController.signal,
    onProgress: throttle((info: ProgressInfo) => post({ type: 'progress', progress: info }), 250),
  })
  const stems = await separator.separate(request.audio) as Partial<SeparationResult<StemName>>
  await separator.dispose()
  const wavs: Record<string, Uint8Array> = {}
  for (const stem of SIX_STEM_NAMES) {
    const audio = stems[stem]
    if (!audio) throw new Error(`The native model did not return the "${stem}" stem.`)
    wavs[stem] = encodeWav(audio)
  }
  post({ type: 'done', wavs })
}

run().catch((error: unknown) => {
  post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
})
