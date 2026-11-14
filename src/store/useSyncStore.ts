import { create } from 'zustand'
import { syncLibrary, lastSyncedAt, syncedSongNames } from '../sync/sync'

/**
 * Google Drive sync state: connection, last sync time, and scheduling.
 * Auto-sync is debounced and never blocks the UI; failures surface in the
 * Settings section (a background hiccup must not pop an error banner).
 */

interface SyncStore {
  connected: boolean
  account?: string
  syncing: boolean
  lastSyncedAt?: number
  /** Songs backed up on Drive per the last synced manifest (badge in the sidebar). */
  syncedNames: Set<string>
  error?: string
  /** Load connection state + last sync time; called once at startup after the library hydrates. */
  init: () => Promise<void>
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  syncNow: () => Promise<void>
  /** Debounced background sync after library changes or on startup. */
  scheduleSync: () => void
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

  init: async () => {
    if (!window.api) return
    const status = await window.api.driveStatus().catch(() => undefined)
    if (!status?.connected) return
    set({ connected: true, ...(status.account ? { account: status.account } : {}) })
    set({ lastSyncedAt: await lastSyncedAt().catch(() => undefined) })
    // Songs backed up before this session still show their Drive badge.
    set({ syncedNames: await syncedSongNames().catch(() => new Set<string>()) })
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

  syncNow: async () => {
    if (get().syncing || !get().connected) return
    set({ syncing: true, error: undefined })
    try {
      const synced = await syncLibrary()
      set({ lastSyncedAt: Date.now(), syncedNames: synced })
    } catch (reason) {
      set({ error: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      set({ syncing: false })
    }
  },

  scheduleSync: () => {
    if (!get().connected || get().syncing || autoSyncTimer) return
    autoSyncTimer = setTimeout(() => {
      autoSyncTimer = undefined
      void get().syncNow()
    }, AUTO_SYNC_DELAY_MS)
  },
}))
