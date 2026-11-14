import { create } from 'zustand'
import {
  deleteFile,
  deleteSongWithFiles,
  getFile,
  isQuotaError,
  listSongs,
  putFile,
  putSong,
  renameSong,
  updateSong,
} from '../db/db'
import { newRecordId, type RecordId, type SongPayload, type SongRecord } from '../db/types'
import { clearTombstone, recordTombstone } from '../sync/tombstones'
import type { Song } from '../types/audio'

/**
 * The song library, persisted in IndexedDB. The store keeps the raw records
 * plus blob object URLs for covers, and exposes the UI-facing `Song` shape
 * the sidebar consumes.
 */

/** Leading articles are ignored when alphabetizing, so "The Beatles" files under B and "Los Fabulosos Cadillacs" under F. */
const LEADING_ARTICLE = /^(the|los|las|les)-/i

const songSortKey = (name: string) => name.replace(LEADING_ARTICLE, '')

const compareSongs = (a: Song, b: Song) =>
  songSortKey(a.name).localeCompare(songSortKey(b.name)) || a.name.localeCompare(b.name)

interface LibraryStore {
  /** UI-facing songs (alphabetical), each with a cover object URL when available. */
  songs: Song[]
  loading: boolean
  /** Set when IndexedDB itself failed (private mode, corrupted database...). */
  unavailable: string | undefined
  /** Internal record lookup by slug name. */
  records: Map<string, SongRecord>
  /** Cover object URLs by slug name; revoked on delete. */
  covers: Map<string, string>
  hydrate: () => Promise<void>
  hasName: (name: string) => boolean
  /** First free "name", "name-1", "name-2"... slug for keep-both imports. */
  uniqueName: (base: string) => string
  persistSeparation: (name: string, stems: Record<string, Uint8Array>, cover: Uint8Array | null) => Promise<Song>
  getStemBuffer: (name: string, stemName: string) => Promise<ArrayBuffer>
  touchSong: (name: string, patch: { duration?: number }) => Promise<void>
  renameSongName: (oldName: string, newName: string) => Promise<void>
  deleteSong: (name: string) => Promise<void>
  /** Delete without recording a sync tombstone (used when the remote already deleted it). */
  deleteSongLocal: (name: string) => Promise<void>
  /** Store a song pulled from Drive, replacing any local copy of the same slug. */
  upsertRemoteSong: (payload: SongPayload, files: Array<{ stemName: string; bytes: Uint8Array }>, cover?: Uint8Array) => Promise<Song>
  /**
   * Restore evicted stems (and optionally the cover) of a remote-only song
   * with freshly downloaded bytes, flipping it back to fully local.
   */
  applyStemFiles: (name: string, files: Array<{ stemName: string; bytes: Uint8Array }>, cover?: Uint8Array) => Promise<Song>
  /** Delete the local stem blobs of a backed-up song, keeping metadata + cover. */
  evictSong: (name: string) => Promise<void>
  /** Swap an updated record into the in-memory maps (used by the sync engine). */
  replaceRecord: (next: SongRecord) => void
  deleteStem: (name: string, stemName: string) => Promise<void>
}

const toUiSong = (record: SongRecord, covers: Map<string, string>): Song => ({
  name: record.name,
  stems: Object.keys(record.stems).sort(),
  ...(record.remoteOnly ? { remoteOnly: true } : {}),
  ...(covers.has(record.name) ? { cover: covers.get(record.name) } : {}),
})

const buildUiSongs = (records: Map<string, SongRecord>, covers: Map<string, string>): Song[] =>
  [...records.values()].map((record) => toUiSong(record, covers)).sort(compareSongs)

/** Thrown when IndexedDB refuses a write because the storage quota is exhausted. */
export class LibraryQuotaError extends Error {
  constructor() {
    super('Storage quota exceeded.')
    this.name = 'LibraryQuotaError'
  }
}

async function putFileOrQuota(recordId: RecordId, name: string, mime: string, bytes: Uint8Array): Promise<void> {
  try {
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime })
    await putFile({ id: recordId, name, mime, size: blob.size, createdAt: Date.now(), blob })
  } catch (reason) {
    if (isQuotaError(reason)) throw new LibraryQuotaError()
    throw reason
  }
}

/** A media file to store together with its song record. */
interface PendingFile {
  name: string
  mime: string
  bytes: Uint8Array
  stemName?: string
  isCover?: boolean
}

/**
 * Write every file then the song record; rolls back already-written blobs if
 * anything fails, so a crash or quota error never leaves a half-imported song.
 */
async function writeSongWithFiles(record: SongRecord, files: PendingFile[]): Promise<Song> {
  const written: RecordId[] = []
  try {
    const stemFileIds: Record<string, RecordId> = {}
    let coverFileId: RecordId | undefined
    let coverBytes: Uint8Array | undefined
    for (const file of files) {
      const fileId = newRecordId()
      await putFileOrQuota(fileId, file.name, file.mime, file.bytes)
      written.push(fileId)
      if (file.isCover) {
        coverFileId = fileId
        coverBytes = file.bytes
      } else if (file.stemName) {
        stemFileIds[file.stemName] = fileId
      }
    }
    const full: SongRecord = {
      ...record,
      // Seed stems (null ids for a remote-only pull) survive for files not provided.
      stems: { ...record.stems, ...stemFileIds },
      ...(coverFileId ? { coverFileId } : {}),
      ...(Object.keys(stemFileIds).length ? { remoteOnly: false } : { remoteOnly: true }),
    }
    await putSong(full)
    const { records, covers } = useLibraryStore.getState()
    records.set(full.name, full)
    if (coverFileId && coverBytes) {
      covers.set(full.name, URL.createObjectURL(new Blob([coverBytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' })))
    }
    useLibraryStore.setState({ songs: buildUiSongs(records, covers) })
    return toUiSong(full, covers)
  } catch (reason) {
    // Never leave a half-imported song: roll back any blobs already written.
    await Promise.allSettled(written.map((fileId) => deleteFile(fileId)))
    throw reason
  }
}

/** Remove a song from the in-memory maps and refresh the UI list. */
async function forgetSong(name: string): Promise<void> {
  const { records, covers } = useLibraryStore.getState()
  records.delete(name)
  const cover = covers.get(name)
  if (cover) {
    URL.revokeObjectURL(cover)
    covers.delete(name)
  }
  useLibraryStore.setState({ songs: buildUiSongs(records, covers) })
}

export const useLibraryStore = create<LibraryStore>((set, get) => ({
  songs: [],
  loading: true,
  unavailable: undefined,
  records: new Map(),
  covers: new Map(),

  hydrate: async () => {
    try {
      const covers = get().covers
      const stored = await listSongs()
      const records = new Map(stored.map((record) => [record.name, record]))
      // Recreate cover object URLs for the session; blobs stay in IndexedDB.
      await Promise.all(stored.map(async (record) => {
        if (!record.coverFileId || covers.has(record.name)) return
        const file = await getFile(record.coverFileId)
        if (file) covers.set(record.name, URL.createObjectURL(file.blob))
      }))
      set({
        records,
        songs: buildUiSongs(records, covers),
        loading: false,
        unavailable: undefined,
      })
    } catch (reason) {
      set({
        loading: false,
        unavailable: reason instanceof Error ? reason.message : String(reason),
      })
    }
  },

  hasName: (name) => get().records.has(name),

  uniqueName: (base) => {
    // Suffix 0 probes the base name; the first duplicate becomes name-1 (not name-2).
    const { records } = get()
    for (let suffix = 0; ; suffix += 1) {
      const candidate = suffix === 0 ? base : `${base}-${suffix}`
      if (!records.has(candidate)) return candidate
    }
  },

  persistSeparation: async (name, stems, cover) => {
    const files: PendingFile[] = Object.entries(stems).map(([stemName, bytes]) => ({
      name: `${stemName}.mp3`,
      mime: 'audio/mpeg',
      bytes,
      stemName,
    }))
    if (cover?.length) files.push({ name: 'cover.jpg', mime: 'image/jpeg', bytes: cover, isCover: true })
    const now = Date.now()
    const song = await writeSongWithFiles({ name, createdAt: now, lastOpened: now, duration: 0, stems: {} }, files)
    // A fresh import re-creates the slug: any pending deletion tombstone is void.
    await clearTombstone(name)
    return song
  },

  getStemBuffer: async (name, stemName) => {
    const record = get().records.get(name)
    const fileId = record?.stems[stemName]
    if (!fileId) throw new Error(`Missing stem "${stemName}" for "${name}".`)
    const file = await getFile(fileId)
    if (!file) throw new Error(`Missing stem data for "${stemName}".`)
    return file.blob.arrayBuffer()
  },  touchSong: async (name, patch) => {
    const record = get().records.get(name)
    if (!record) return
    const next = { ...record, ...patch, lastOpened: Date.now() }
    get().records.set(name, next)
    await putSong(next)
  },

  renameSongName: async (oldName, newName) => {
    const { records, covers } = get()
    const record = records.get(oldName)
    if (!record || oldName === newName) return
    await renameSong(oldName, newName)
    await recordTombstone(oldName)
    records.delete(oldName)
    // Renaming back onto a deleted slug re-creates it; a fresh createdAt keeps
    // the sync tombstone rule (createdAt > deletedAt) from deleting the song.
    let createdAt = record.createdAt
    if (await clearTombstone(newName)) createdAt = Date.now()
    records.set(newName, { ...record, name: newName, createdAt })
    const cover = covers.get(oldName)
    if (cover) {
      covers.delete(oldName)
      covers.set(newName, cover)
    }
    set({ songs: buildUiSongs(records, covers) })
  },

  deleteSong: async (name) => {
    await deleteSongWithFiles(name)
    await recordTombstone(name)
    await forgetSong(name)
  },

  deleteSongLocal: async (name) => {
    await deleteSongWithFiles(name)
    await forgetSong(name)
  },

  upsertRemoteSong: async (payload, files, cover) => {
    const pending: PendingFile[] = files.map(({ stemName, bytes }) => ({
      name: `${stemName}.mp3`,
      mime: 'audio/mpeg',
      bytes,
      stemName,
    }))
    if (cover) pending.push({ name: 'cover.jpg', mime: 'image/jpeg', bytes: cover, isCover: true })
    // Stem names are seeded as null ids: without downloaded bytes the song is
    // remote-only and its stems re-download from Drive on demand.
    return writeSongWithFiles(
      {
        name: payload.name,
        createdAt: payload.createdAt,
        lastOpened: payload.lastOpened,
        duration: payload.duration,
        stems: Object.fromEntries(payload.stems.map((stemName) => [stemName, null])),
      },
      pending,
    )
  },

  applyStemFiles: async (name, files, cover) => {
    const record = get().records.get(name)
    if (!record) throw new Error(`"${name}" is not in the local library.`)
    const written: RecordId[] = []
    try {
      const stems = { ...record.stems }
      for (const { stemName, bytes } of files) {
        const fileId = newRecordId()
        await putFileOrQuota(fileId, `${stemName}.mp3`, 'audio/mpeg', bytes)
        written.push(fileId)
        stems[stemName] = fileId
      }
      let coverFileId = record.coverFileId
      if (cover?.length) {
        if (record.coverFileId) await deleteFile(record.coverFileId)
        coverFileId = newRecordId()
        await putFileOrQuota(coverFileId, 'cover.jpg', 'image/jpeg', cover)
        written.push(coverFileId)
        const { covers } = get()
        const previous = covers.get(name)
        if (previous) URL.revokeObjectURL(previous)
        covers.set(name, URL.createObjectURL(new Blob([cover as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' })))
      }
      const next: SongRecord = { ...record, stems, ...(coverFileId ? { coverFileId } : {}), remoteOnly: false }
      await putSong(next)
      get().records.set(name, next)
      set({ songs: buildUiSongs(get().records, get().covers) })
      return toUiSong(next, get().covers)
    } catch (reason) {
      await Promise.allSettled(written.map((fileId) => deleteFile(fileId)))
      throw reason
    }
  },

  evictSong: async (name) => {
    const record = get().records.get(name)
    if (!record || record.remoteOnly) return
    // Covers (a few KB) stay local so the sidebar keeps showing artwork.
    const stemIds = Object.values(record.stems).filter((fileId): fileId is RecordId => fileId !== null)
    if (!stemIds.length) return
    await Promise.allSettled(stemIds.map((fileId) => deleteFile(fileId)))
    const next: SongRecord = {
      ...record,
      stems: Object.fromEntries(Object.keys(record.stems).map((stemName) => [stemName, null])),
      remoteOnly: true,
    }
    await putSong(next)
    get().records.set(name, next)
    set({ songs: buildUiSongs(get().records, get().covers) })
  },

  replaceRecord: (next) => {
    const { records } = get()
    records.set(next.name, next)
    set({ songs: buildUiSongs(records, get().covers) })
  },

  deleteStem: async (name, stemName) => {
    const record = get().records.get(name)
    const fileId = record?.stems[stemName]
    if (!record || !fileId) return
    const remaining = Object.keys(record.stems).filter((key) => key !== stemName)
    await deleteFile(fileId)
    // Covers alone do not keep a song alive, matching the previous on-disk behavior.
    if (!remaining.length) {
      await deleteSongWithFiles(name)
      await forgetSong(name)
      return
    }
    const stems = { ...record.stems }
    delete stems[stemName]
    await updateSong(name, { stems })
    get().records.set(name, { ...record, stems })
    set({ songs: buildUiSongs(get().records, get().covers) })
  },
}))

