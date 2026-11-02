import { create } from 'zustand'

interface TransportStore {
  isPlaying: boolean
  currentTime: number
  duration: number
  masterVolume: number
  setTransport: (state: Partial<Omit<TransportStore, 'setTransport'>>) => void
}

export const useTransportStore = create<TransportStore>((set) => ({
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  masterVolume: 0.9,
  setTransport: (state) => set(state),
}))
