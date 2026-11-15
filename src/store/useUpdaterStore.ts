import { create } from 'zustand'

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'not-available' | 'portable' | 'error'

interface UpdaterStore {
  status: UpdateStatus
  version?: string
  message?: string
  checkForUpdates: () => void
  downloadUpdate: () => void
  openReleasesPage: () => void
  setState: (state: { status: UpdateStatus; version?: string; message?: string }) => void
}

export const useUpdaterStore = create<UpdaterStore>((set) => ({
  status: 'idle',
  version: undefined,
  message: undefined,
  checkForUpdates: () => {
    if (window.api?.checkForUpdates) {
      void window.api.checkForUpdates()
    }
  },
  downloadUpdate: () => {
    if (window.api?.downloadUpdate) {
      void window.api.downloadUpdate()
    }
  },
  openReleasesPage: () => {
    if (window.api?.openReleasesPage) {
      void window.api.openReleasesPage()
    }
  },
  setState: ({ status, version, message }) => set({ status, version, message }),
}))

// Subscribe to main-process events once at module load.
if (window.api?.onUpdaterState) {
  window.api.onUpdaterState((state) => {
    useUpdaterStore.getState().setState({
      status: state.status as UpdateStatus,
      version: state.version,
      message: state.message,
    })
  })
}
