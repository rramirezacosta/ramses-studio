import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  prepareImport: () => ipcRenderer.invoke('songs:prepare-import'),
  cancelImport: () => ipcRenderer.invoke('songs:cancel-import'),
  prepareYouTubeImport: (url: string) => ipcRenderer.invoke('songs:prepare-youtube-import', url),
  separateStems: (sourceName: string, audio: { left: Float32Array; right: Float32Array; sampleRate: number }, thumbnailPath?: string) =>
    ipcRenderer.invoke('songs:separate-native', sourceName, audio, thumbnailPath),
  exportMix: (songName: string, wav: Uint8Array) => ipcRenderer.invoke('mix:export', { songName, wav }),
  readFileBuffer: (filePath: string) => ipcRenderer.invoke('files:read-buffer', filePath),
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
