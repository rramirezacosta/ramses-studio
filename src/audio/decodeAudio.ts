let worker: Worker | null = null
let nextId = 1

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./audio.worker.ts', import.meta.url), { type: 'module' })
  }
  return worker
}

export interface DecodedAudio {
  sampleRate: number
  numberOfChannels: number
  duration: number
  channels: Float32Array[]
}

export function decodeAudioInWorker(arrayBuffer: ArrayBuffer): Promise<DecodedAudio> {
  return new Promise<DecodedAudio>((resolve, reject) => {
    const id = nextId++
    const instance = getWorker()
    const handler = (event: MessageEvent) => {
      if (event.data?.id !== id) return
      instance.removeEventListener('message', handler)
      if (event.data.type === 'decoded') {
        resolve({
          sampleRate: event.data.sampleRate,
          numberOfChannels: event.data.numberOfChannels,
          duration: event.data.duration,
          channels: event.data.channels,
        })
      } else {
        reject(new Error(event.data.error ?? 'Audio decoding failed.'))
      }
    }
    instance.addEventListener('message', handler)
    instance.postMessage({ type: 'decode', id, buffer: arrayBuffer })
  })
}

export function computePeaksInWorker(channels: Float32Array[], columns: number): Promise<{ min: number; max: number }[]> {
  return new Promise((resolve, reject) => {
    const id = nextId++
    const instance = getWorker()
    const handler = (event: MessageEvent) => {
      if (event.data?.id !== id) return
      instance.removeEventListener('message', handler)
      if (event.data.type === 'peaks') {
        resolve(event.data.peaks)
      } else {
        reject(new Error(event.data.error ?? 'Peak generation failed.'))
      }
    }
    instance.addEventListener('message', handler)
    // Transfer copies so the source AudioBuffer is not detached.
    const transferred = channels.map((channel) => channel.slice())
    instance.postMessage({ type: 'peaks', id, channels: transferred, columns }, transferred.map((channel) => channel.buffer))
  })
}
