import { generatePeaks } from './peakGenerator'
import { computePeaksInWorker } from './decodeAudio'

export interface PeakEntry {
  min: number
  max: number
}

let cache = new WeakMap<AudioBuffer, Map<number, PeakEntry[]>>()
const pending = new WeakMap<AudioBuffer, Map<number, Promise<PeakEntry[]>>>()

export function getCachedPeaks(buffer: AudioBuffer, columns: number): PeakEntry[] | undefined {
  return cache.get(buffer)?.get(columns)
}

export async function ensurePeaks(buffer: AudioBuffer, columns: number): Promise<PeakEntry[]> {
  const safeColumns = Math.max(1, Math.ceil(columns))
  const cached = cache.get(buffer)?.get(safeColumns)
  if (cached) return cached

  let pendingByColumns = pending.get(buffer)
  if (!pendingByColumns) {
    pendingByColumns = new Map()
    pending.set(buffer, pendingByColumns)
  }
  const existing = pendingByColumns.get(safeColumns)
  if (existing) return existing

  const promise = (async () => {
    try {
      const channels: Float32Array[] = []
      for (let index = 0; index < buffer.numberOfChannels; index += 1) {
        channels.push(buffer.getChannelData(index))
      }
      const peaks = await computePeaksInWorker(channels, safeColumns)
      let byColumns = cache.get(buffer)
      if (!byColumns) {
        byColumns = new Map()
        cache.set(buffer, byColumns)
      }
      byColumns.set(safeColumns, peaks)
      return peaks
    } catch {
      const peaks = generatePeaks(buffer, safeColumns) as PeakEntry[]
      let byColumns = cache.get(buffer)
      if (!byColumns) {
        byColumns = new Map()
        cache.set(buffer, byColumns)
      }
      byColumns.set(safeColumns, peaks)
      return peaks
    } finally {
      pending.get(buffer)?.delete(safeColumns)
    }
  })()

  pendingByColumns.set(safeColumns, promise)
  return promise
}

export function clearPeakCache() {
  cache = new WeakMap<AudioBuffer, Map<number, PeakEntry[]>>()
}
