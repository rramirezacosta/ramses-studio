import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  getSongs: () => ipcRenderer.invoke('songs:list'),
  loadStemBuffer: (songName: string, stemFile: string) =>
    ipcRenderer.invoke('songs:load-buffer', { songName, stemFile }),
  renameSong: (songName: string, newName: string) => ipcRenderer.invoke('songs:rename', { songName, newName }),
  deleteSong: (songName: string) => ipcRenderer.invoke('songs:delete', songName),
  importSong: () => ipcRenderer.invoke('songs:import'),
  onImportProgress: (listener: (progress: { progress: number; currentSegment: number; totalSegments: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: { progress: number; currentSegment: number; totalSegments: number }) => listener(progress)
    ipcRenderer.on('songs:import-progress', handler)
    return () => ipcRenderer.removeListener('songs:import-progress', handler)
  },
})
