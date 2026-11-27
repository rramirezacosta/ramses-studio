import type { StereoAudio } from '../components/stemsplitter/types'
import type { StemName } from '../components/stemsplitter/types'

type WindowButton = 'minimize' | 'maximize' | 'close'

/** Result of a separation run: raw WAV stems staged in the main process for renderer-side encoding. */
export interface SeparationResult {
  jobId: string
  stems: StemName[]
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
      separateStems: (audio: StereoAudio) => Promise<SeparationResult>
      takeStem: (jobId: string, name: StemName) => Promise<Uint8Array>
      discardStems: (jobId: string) => Promise<boolean>
      exportMix: (songName: string, mp3: Uint8Array) => Promise<string | null>
      exportStems: (songName: string, stems: Array<{ name: string; data: Uint8Array }>) => Promise<string | null>
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
      checkForUpdates: () => Promise<void>
      downloadUpdate: () => Promise<void>
      openReleasesPage: () => Promise<void>
      onUpdaterState: (listener: (state: { status: string; version?: string; message?: string }) => void) => () => void
      getSystemRam: () => Promise<number>
    }
  }
}

export {}
