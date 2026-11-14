export interface Song {
  name: string
  stems: string[]
  cover?: string
  /** True when the stems are not on this device; the song re-downloads from Drive on open. */
  remoteOnly?: boolean
  /** Last time the song was opened (for "recent" sorting). */
  lastOpened?: number
  /** Duration in seconds. */
  duration?: number
  /** Total on-disk size in bytes (stems + cover). */
  size?: number
  /** Sync status for this song (pending/synced/error). */
  syncStatus?: 'pending' | 'syncing' | 'synced' | 'error'
  syncError?: string
}

export interface TrackState {
  id: string
  name: string
  buffer: AudioBuffer
  volume: number
  pan: number
  muted: boolean
  soloed: boolean
}
