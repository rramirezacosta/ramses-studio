export interface Song {
  name: string
  stems: string[]
  cover?: string
  /** True when the stems are not on this device; the song re-downloads from Drive on open. */
  remoteOnly?: boolean
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
