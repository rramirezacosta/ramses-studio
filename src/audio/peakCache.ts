import { generatePeaks } from './peakGenerator'

interface PeakEntry {
  min: number
  max: number
}

const cache = new WeakMap<AudioBuffer, Map<number, PeakEntry[]>>()

export function getCachedPeaks(buffer: AudioBuffer, columns: number): PeakEntry[] {
  let byColumns = cache.get(buffer)
  if (byColumns?.has(columns)) {
    return byColumns.get(columns)!
  }
  const peaks = generatePeaks(buffer, columns)
  if (byColumns) {
    byColumns.set(columns, peaks)
  } else {
    cache.set(buffer, new Map([[columns, peaks]]))
  }
  return peaks
}

export function clearPeakCache() {
  // WeakMap has no clear() — recreate it to release all entries
  Object.assign(cache, new WeakMap())
}
