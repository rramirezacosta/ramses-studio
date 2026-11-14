import type { StereoAudio } from '../components/stemsplitter/types'
import type { StemName } from '../components/stemsplitter/types'

type WindowButton = 'minimize' | 'maximize' | 'close'

/** Result of a separation run: encoded stems plus best-effort cover art bytes. */
export interface SeparationResult {
  stems: Record<StemName, Uint8Array>
  cover: Uint8Array | null
}

declare global {
  interface Window {
    api: {
      prepareImport: () => Promise<{ sourceName: string } | null>
      cancelImport: () => Promise<boolean>
      prepareYouTubeImport: (url: string) => Promise<{ sourceName: string; thumbnailPath?: string }>
      separateStems: (sourceName: string, audio: StereoAudio, thumbnailPath?: string) => Promise<SeparationResult>
      exportMix: (songName: string, wav: Uint8Array) => Promise<string | null>
      readFileBuffer: (filePath: string) => Promise<ArrayBuffer>
      onImportProgress: (listener: (progress: { progress: number; currentSegment: number; totalSegments: number }) => void) => () => void
      onImportStage: (listener: (stage: string) => void) => () => void
      getWindowButtonLayout: () => Promise<{ left: WindowButton[]; right: WindowButton[] }>
      minimizeWindow: () => Promise<void>
      toggleWindowMaximize: () => Promise<boolean>
      closeWindow: () => Promise<void>
    }
  }
}

export {}
