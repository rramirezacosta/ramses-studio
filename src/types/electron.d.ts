import type { StereoAudio } from '../components/stemsplitter/types'
import type { StemName } from '../components/stemsplitter/types'

type WindowButton = 'minimize' | 'maximize' | 'close'

/** Result of a separation run: encoded stems plus best-effort cover art bytes. */
export interface SeparationResult {
  stems: Record<StemName, Uint8Array>
  cover: Uint8Array | null
}

/** One file listed from the Drive app-data folder. */
export interface DriveFileMeta {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
  size?: string
}

export interface DriveUploadRequest {
  name: string
  mimeType: string
  bytes: Uint8Array
  /** When set, patches the existing Drive file instead of creating one. */
  fileId?: string
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
      stageFileBuffer: (fileName: string, bytes: Uint8Array) => Promise<string>
      driveStatus: () => Promise<{ connected: boolean; account?: string }>
      driveConnect: () => Promise<{ account?: string }>
      driveDisconnect: () => Promise<void>
      driveList: () => Promise<DriveFileMeta[]>
      driveUpload: (request: DriveUploadRequest) => Promise<{ id: string; modifiedTime?: string }>
      driveDownload: (fileId: string) => Promise<Uint8Array>
      driveDelete: (fileId: string) => Promise<void>
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
