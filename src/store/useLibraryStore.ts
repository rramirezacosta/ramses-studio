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
import { newRecordId, type RecordId, type SongRecord } from '../db/types'
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
  deleteStem: (name: string, stemName: string) => Promise<void>
}

const toUiSong = (record: SongRecord, covers: Map<string, string>): Song => ({
  name: record.name,
  stems: Object.keys(record.stems).sort(),
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
    const stemEntries = Object.entries(stems)
    // File ids already written, for rollback if a later write fails.
    const written: RecordId[] = []
    try {
      const stemFileIds: Record<string, RecordId> = {}
      // One write per file keeps individual transactions small and lets the
      // quota error surface on the specific blob that failed.
      for (const [stemName, bytes] of stemEntries) {
        const fileId = newRecordId()
        await putFileOrQuota(fileId, `${stemName}.mp3`, 'audio/mpeg', bytes)
        written.push(fileId)
        stemFileIds[stemName] = fileId
      }
      let coverFileId: RecordId | undefined
      if (cover?.length) {
        coverFileId = newRecordId()
        await putFileOrQuota(coverFileId, 'cover.jpg', 'image/jpeg', cover)
        written.push(coverFileId)
      }
      const now = Date.now()
      const record: SongRecord = { name, createdAt: now, lastOpened: now, duration: 0, stems: stemFileIds, ...(coverFileId ? { coverFileId } : {}) }
      await putSong(record)
      const { records, covers } = get()
      records.set(record.name, record)
      if (coverFileId && cover) covers.set(record.name, URL.createObjectURL(new Blob([cover as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' })))
      set({ songs: buildUiSongs(records, covers) })
      return toUiSong(record, covers)
    } catch (reason) {
      // Never leave a half-imported song: roll back any blobs already written.
      await Promise.allSettled(written.map((fileId) => deleteFile(fileId)))
      throw reason
    }
  },

  getStemBuffer: async (name, stemName) => {
    const record = get().records.get(name)
    const fileId = record?.stems[stemName]
    if (!fileId) throw new Error(`Missing stem "${stemName}" for "${name}".`)
    const file = await getFile(fileId)
    if (!file) throw new Error(`Missing stem data for "${stemName}".`)
    return file.blob.arrayBuffer()
  },

  touchSong: async (name, patch) => {
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
    records.delete(oldName)
    records.set(newName, { ...record, name: newName })
    const cover = covers.get(oldName)
    if (cover) {
      covers.delete(oldName)
      covers.set(newName, cover)
    }
    set({ songs: buildUiSongs(records, covers) })
  },

  deleteSong: async (name) => {
    await deleteSongWithFiles(name)
    const { records, covers } = get()
    records.delete(name)
    const cover = covers.get(name)
    if (cover) {
      URL.revokeObjectURL(cover)
      covers.delete(name)
    }
    set({ songs: buildUiSongs(records, covers) })
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
      const { records, covers } = get()
      records.delete(name)
      const cover = covers.get(name)
      if (cover) {
        URL.revokeObjectURL(cover)
        covers.delete(name)
      }
      set({ songs: buildUiSongs(records, covers) })
      return
    }
    const stems = { ...record.stems }
    delete stems[stemName]
    await updateSong(name, { stems })
    get().records.set(name, { ...record, stems })
    set({ songs: buildUiSongs(get().records, get().covers) })
  },
}))

