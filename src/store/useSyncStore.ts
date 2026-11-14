import { create, type StoreApi } from 'zustand'
import { syncLibrary, lastSyncedAt, syncedSongNames, removeSongFromDrive, backupSongToDrive, downloadSongToLibrary, renameSongOnDrive, canEvictSong } from '../sync/sync'
import { useLibraryStore } from './useLibraryStore'
import { getFile } from '../db/db'
import { clearTombstone } from '../sync/tombstones'

/**
 * Google Drive sync state: connection, last sync time, and scheduling.
 * Auto-sync is debounced and never blocks the UI; failures surface in the
 * Settings section (a background hiccup must not pop an error banner).
 */

interface SongSyncState {
  status: 'pending' | 'syncing' | 'synced' | 'error'
  error?: string
  updatedAt?: number
}

interface SyncStore {
  connected: boolean
  account?: string
  syncing: boolean
  lastSyncedAt?: number
  /** Songs backed up on Drive per the last synced manifest (badge in the sidebar). */
  syncedNames: Set<string>
  error?: string
  /** Number of local changes not yet synced. */
  pendingChanges: number
  /** Per-song sync status + last error. */
  songStatus: Record<string, SongSyncState>
  /** Songs that diverged on both sides and need user resolution. */
  conflicts: string[]
  /** Load connection state + last sync time; called once at startup after the library hydrates. */
  init: () => Promise<void>
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  syncNow: (auto?: boolean) => Promise<void>
  /** Per-song: remove its Drive backup (local copy is kept) and stop backing it up. */
  removeBackup: (name: string) => Promise<void>
  /** Per-song: upload or reconcile just this song right now. */
  backupSong: (name: string) => Promise<void>
  /** Per-song: delete the local stems of a backed-up song (it re-downloads on open). */
  freeUpSpace: (name: string) => Promise<void>
  /** Per-song: download a remote-only song's stems, reporting progress 0..1. */
  downloadSong: (name: string, onProgress?: (percent: number) => void) => Promise<void>
  /** Download every remote-only song, reporting aggregated progress 0..1. */
  downloadAllSongs: (onProgress?: (name: string, percent: number) => void) => Promise<void>
  /** Evict the stems of every backed-up song except the N most recently opened. */
  freeUpOldest: (keep?: number) => Promise<number>
  /** Rename a remote-only song on Drive, then locally. */
  renameRemoteSong: (oldName: string, newName: string) => Promise<void>
  /** Clear the auto-sync toast notice. */
  /** Debounced background sync after library changes or on startup. */
  scheduleSync: () => void
  /** Resolve a sync conflict for a song. */
  resolveConflict: (name: string, choice: 'local' | 'remote' | 'both') => Promise<void>
}

const AUTO_SYNC_DELAY_MS = 3000

let autoSyncTimer: ReturnType<typeof setTimeout> | undefined

export const useSyncStore = create<SyncStore>((set, get) => ({
  connected: false,
  account: undefined,
  syncing: false,
  lastSyncedAt: undefined,
  syncedNames: new Set(),
  error: undefined,
  pendingChanges: 0,
  songStatus: {},
  conflicts: [],

  init: async () => {
    if (!window.api) return
    const status = await window.api.driveStatus().catch(() => undefined)
    if (!status?.connected) return
    set({ connected: true, ...(status.account ? { account: status.account } : {}) })
    set({ lastSyncedAt: await lastSyncedAt().catch(() => undefined) })
    // Songs backed up before this session still show their Drive badge.
    const synced = await syncedSongNames().catch(() => new Set<string>())
    set({ syncedNames: synced })
    const songStatusMap: Record<string, SongSyncState> = {}
    for (const record of useLibraryStore.getState().records.values()) {
      songStatusMap[record.name] = { status: synced.has(record.name) ? 'synced' : 'pending', updatedAt: Date.now() }
    }
    set({ songStatus: songStatusMap, pendingChanges: [...useLibraryStore.getState().records.values()].filter((r) => !synced.has(r.name)).length })
    get().scheduleSync()
  },

  connect: async () => {
    if (!window.api) return
    set({ error: undefined })
    try {
      const status = await window.api.driveConnect()
      set({ connected: true, ...(status.account ? { account: status.account } : {}) })
      // A fresh connection syncs immediately.
      await get().syncNow()
    } catch (reason) {
      // A cancelled sign-in popup is a normal outcome, not an error.
      if (reason instanceof Error && /cancel/i.test(reason.message)) return
      set({ error: reason instanceof Error ? reason.message : String(reason) })
    }
  },

  disconnect: async () => {
    if (!window.api) return
    await window.api.driveDisconnect()
    set({ connected: false, account: undefined, lastSyncedAt: undefined, error: undefined })
  },

  syncNow: async (auto) => {
    if (get().syncing || !get().connected) return
    set({ syncing: true, error: undefined })
    try {
      const result = await syncLibrary()
      const status = { ...get().songStatus }
      for (const name of result.syncedNames) status[name] = { status: 'synced', updatedAt: Date.now() }
      for (const name of result.conflicts) status[name] = { status: 'pending', error: 'Conflict', updatedAt: Date.now() }
      set({
        lastSyncedAt: Date.now(),
        syncedNames: result.syncedNames,
        conflicts: result.conflicts,
        pendingChanges: 0,
        songStatus: status,
      })
    } catch (reason) {
      set({ error: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      set({ syncing: false })
    }
  },

  removeBackup: async (name) => {
    if (get().syncing || !get().connected) return
    await runSync(set, get, () => removeSongFromDrive(name))
  },

  backupSong: async (name) => {
    if (get().syncing || !get().connected) return
    await runSync(set, get, () => backupSongToDrive(name))
  },

  freeUpSpace: async (name) => {
    // Eviction works offline: the snapshot guarantees the Drive copy exists.
    if (get().syncing || !(await canEvictSong(name))) return
    await useLibraryStore.getState().evictSong(name)
  },

  downloadSong: async (name, onProgress) => {
    if (get().syncing || !get().connected) throw new Error('Google Drive is not connected.')
    await downloadSongToLibrary(name, onProgress)
  },

  downloadAllSongs: async (onProgress) => {
    if (get().syncing || !get().connected) throw new Error('Google Drive is not connected.')
    const records = [...useLibraryStore.getState().records.values()].filter((record) => record.remoteOnly)
    const total = records.length
    let done = 0
    for (const record of records) {
      await downloadSongToLibrary(record.name, (percent) => onProgress?.(record.name, total ? (done + percent) / total : 1))
      done += 1
      onProgress?.(record.name, total ? done / total : 1)
    }
  },

  freeUpOldest: async (keep = 5) => {
    const records = [...useLibraryStore.getState().records.values()]
      .filter((record) => !record.remoteOnly)
      .sort((a, b) => b.lastOpened - a.lastOpened)
    const candidates = records.slice(keep)
    let freed = 0
    for (const record of candidates) {
      if (!(await canEvictSong(record.name))) continue
      for (const fileId of Object.values(record.stems)) {
        if (!fileId) continue
        const file = await getFile(fileId)
        if (file) freed += file.size
      }
      await useLibraryStore.getState().evictSong(record.name)
    }
    return freed
  },

  renameRemoteSong: async (oldName, newName) => {
    const synced = await renameSongOnDrive(oldName, newName)
    await useLibraryStore.getState().renameSongName(oldName, newName)
    set({ syncedNames: synced })
  },

  resolveConflict: async (name, choice) => {
    const library = useLibraryStore.getState()
    try {
      if (choice === 'local') {
        await removeSongFromDrive(name)
        const synced = await backupSongToDrive(name)
        set({ syncedNames: synced, conflicts: get().conflicts.filter((item) => item !== name) })
      } else if (choice === 'remote') {
        await library.deleteSongLocal(name)
        await get().syncNow()
        set({ conflicts: get().conflicts.filter((item) => item !== name) })
      } else {
        const newName = library.uniqueName(`${name}-local`)
        await library.renameSongName(name, newName)
        await clearTombstone(name)
        await get().syncNow()
        set({ conflicts: get().conflicts.filter((item) => item !== name) })
      }
    } catch (reason) {
      set({ error: reason instanceof Error ? reason.message : String(reason) })
    }
  },

  scheduleSync: () => {
    if (!get().connected || get().syncing || autoSyncTimer) return
    const synced = get().syncedNames
    const pending = [...useLibraryStore.getState().records.values()].filter((record) => !synced.has(record.name)).length
    set({ pendingChanges: pending })
    const status = { ...get().songStatus }
    for (const record of useLibraryStore.getState().records.values()) {
      if (!status[record.name]) status[record.name] = { status: synced.has(record.name) ? 'synced' : 'pending', updatedAt: Date.now() }
    }
    set({ songStatus: status })
    autoSyncTimer = setTimeout(() => {
      autoSyncTimer = undefined
      void get().syncNow(true)
    }, AUTO_SYNC_DELAY_MS)
  },
}))

/** Shared body of every explicit sync action: mutex, last-synced stamp, error line. */
async function runSync(
  set: StoreApi<SyncStore>['setState'],
  get: StoreApi<SyncStore>['getState'],
  action: () => Promise<Set<string>>,
  auto = false,
): Promise<void> {
  set({ syncing: true, error: undefined })
  try {
    const syncedNames = await action()
    set({ lastSyncedAt: Date.now(), syncedNames })
  } catch (reason) {
    set({ error: reason instanceof Error ? reason.message : String(reason) })
  } finally {
    set({ syncing: false })
  }
}
