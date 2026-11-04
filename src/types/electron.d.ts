import type { Song } from './audio'
import type { SeparationResult, StereoAudio, StemName } from '../components/stemsplitter/types'

type WindowButton = 'minimize' | 'maximize' | 'close'

declare global {
  interface Window {
    api: {
      getSongs: () => Promise<Song[]>
      loadStemBuffer: (songName: string, stemFile: string) => Promise<ArrayBuffer>
      renameSong: (songName: string, newName: string) => Promise<void>
      deleteSong: (songName: string) => Promise<void>
      deleteStem: (songName: string, stemFile: string) => Promise<void>
      prepareImport: () => Promise<{ sourceName: string; audio: StereoAudio } | null>
      prepareYouTubeImport: (url: string) => Promise<{ sourceName: string; audio: StereoAudio }>
      loadWebGpuModel: () => Promise<Uint8Array>
      separateWithNative: (audio: StereoAudio, forceCpu: boolean) => Promise<SeparationResult<StemName>>
      saveImportedStems: (sourceName: string, stems: Record<string, Uint8Array>) => Promise<Song>
      onImportProgress: (listener: (progress: { progress: number; currentSegment: number; totalSegments: number }) => void) => () => void
      onImportCpuFallback: (listener: () => void) => () => void
      onImportStage: (listener: (stage: string) => void) => () => void
      getWindowButtonLayout: () => Promise<{ left: WindowButton[]; right: WindowButton[] }>
      minimizeWindow: () => Promise<void>
      toggleWindowMaximize: () => Promise<boolean>
      closeWindow: () => Promise<void>
    }
  }
}

export {}
