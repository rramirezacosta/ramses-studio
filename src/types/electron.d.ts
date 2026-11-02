import type { Song } from './audio'

declare global {
  interface Window {
    api: {
      getSongs: () => Promise<Song[]>
      loadStemBuffer: (songName: string, stemFile: string) => Promise<ArrayBuffer>
      renameSong: (songName: string, newName: string) => Promise<void>
      deleteSong: (songName: string) => Promise<void>
      importSong: () => Promise<Song | null>
      onImportProgress: (listener: (progress: { progress: number; currentSegment: number; totalSegments: number }) => void) => () => void
    }
  }
}

export {}
