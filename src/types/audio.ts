export interface Song {
  name: string
  stems: string[]
  cover?: string
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
