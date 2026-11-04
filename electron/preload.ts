import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  getSongs: () => ipcRenderer.invoke('songs:list'),
  loadStemBuffer: (songName: string, stemFile: string) =>
    ipcRenderer.invoke('songs:load-buffer', { songName, stemFile }),
  renameSong: (songName: string, newName: string) => ipcRenderer.invoke('songs:rename', { songName, newName }),
  deleteSong: (songName: string) => ipcRenderer.invoke('songs:delete', songName),
  deleteStem: (songName: string, stemFile: string) => ipcRenderer.invoke('songs:delete-stem', { songName, stemFile }),
  prepareImport: () => ipcRenderer.invoke('songs:prepare-import'),
  prepareYouTubeImport: (url: string) => ipcRenderer.invoke('songs:prepare-youtube-import', url),
  loadWebGpuModel: () => ipcRenderer.invoke('models:webgpu'),
  separateWithNative: (audio: { left: Float32Array; right: Float32Array; sampleRate: number }) => ipcRenderer.invoke('songs:separate-native', audio),
  saveImportedStems: (sourceName: string, stems: Record<string, Uint8Array>) => ipcRenderer.invoke('songs:save-import', { sourceName, stems }),
  getWindowButtonLayout: () => ipcRenderer.invoke('window:button-layout'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleWindowMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  onImportProgress: (listener: (progress: { progress: number; currentSegment: number; totalSegments: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: { progress: number; currentSegment: number; totalSegments: number }) => listener(progress)
    ipcRenderer.on('songs:import-progress', handler)
    return () => ipcRenderer.removeListener('songs:import-progress', handler)
  },
})
