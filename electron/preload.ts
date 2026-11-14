import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  prepareImport: () => ipcRenderer.invoke('songs:prepare-import'),
  cancelImport: () => ipcRenderer.invoke('songs:cancel-import'),
  prepareYouTubeImport: (url: string) => ipcRenderer.invoke('songs:prepare-youtube-import', url),
  separateStems: (sourceName: string, audio: { left: Float32Array; right: Float32Array; sampleRate: number }, thumbnailPath?: string) =>
    ipcRenderer.invoke('songs:separate-native', sourceName, audio, thumbnailPath),
  exportMix: (songName: string, wav: Uint8Array) => ipcRenderer.invoke('mix:export', { songName, wav }),
  exportStems: (songName: string, stems: Array<{ name: string; data: Uint8Array }>) => ipcRenderer.invoke('stems:export', { songName, stems }),
  readFileBuffer: (filePath: string) => ipcRenderer.invoke('files:read-buffer', filePath),
  stageFileBuffer: (fileName: string, bytes: Uint8Array) => ipcRenderer.invoke('files:stage-buffer', fileName, bytes),
  driveStatus: () => ipcRenderer.invoke('drive:status'),
  driveConnect: () => ipcRenderer.invoke('drive:connect'),
  driveDisconnect: () => ipcRenderer.invoke('drive:disconnect'),
  driveList: () => ipcRenderer.invoke('drive:list'),
  driveUpload: (request: { name: string; mimeType: string; bytes: Uint8Array; fileId?: string }) =>
    ipcRenderer.invoke('drive:upload', request),
  driveDownload: (fileId: string) => ipcRenderer.invoke('drive:download', fileId),
  driveDelete: (fileId: string) => ipcRenderer.invoke('drive:delete', fileId),
  getWindowButtonLayout: () => ipcRenderer.invoke('window:button-layout'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleWindowMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  onImportProgress: (listener: (progress: { progress: number; currentSegment: number; totalSegments: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: { progress: number; currentSegment: number; totalSegments: number }) => listener(progress)
    ipcRenderer.on('songs:import-progress', handler)
    return () => ipcRenderer.removeListener('songs:import-progress', handler)
  },
  onImportStage: (listener: (stage: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, stage: string) => listener(stage)
    ipcRenderer.on('songs:import-stage', handler)
    return () => ipcRenderer.removeListener('songs:import-stage', handler)
  },
})
