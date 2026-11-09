import type { Song } from './audio'
import type { StereoAudio } from '../components/stemsplitter/types'

type WindowButton = 'minimize' | 'maximize' | 'close'

declare global {
  interface Window {
    api: {
      getSongs: () => Promise<Song[]>
      loadStemBuffer: (songName: string, stemFile: string) => Promise<ArrayBuffer>
      renameSong: (songName: string, newName: string) => Promise<void>
      deleteSong: (songName: string) => Promise<void>
      deleteStem: (songName: string, stemFile: string) => Promise<void>
      prepareImport: () => Promise<{ sourceName: string } | null>
      cancelImport: () => Promise<boolean>
      prepareYouTubeImport: (url: string) => Promise<{ sourceName: string }>
      checkSongDuplicate: (sourceName: string) => Promise<{ exists: boolean; name: string }>
      separateWithNative: (sourceName: string, audio: StereoAudio) => Promise<Song>
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