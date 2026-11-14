import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { FileRecord, KvRecord, RecordId, SongRecord } from './types'

/**
 * Durable storage for the song library: one database, three stores.
 *
 * - `files`: raw media blobs (stem mp3s, covers), one record per file.
 * - `songs`: song metadata keyed by folder slug, referencing file ids.
 * - `kv`: small values that belong with the library.
 *
 * All schema changes happen exclusively inside `onUpgradeNeeded` so future
 * versions stay migratable. The connection is opened lazily and memoized for
 * the lifetime of the renderer process.
 */

interface RamsesDb extends DBSchema {
  files: {
    key: RecordId
    value: FileRecord
    indexes: { byCreated: number }
  }
  songs: {
    key: string
    value: SongRecord
    indexes: { byLastOpened: number }
  }
  kv: {
    key: string
    value: KvRecord
  }
}

const DATABASE_NAME = 'ramses-studio'
const DATABASE_VERSION = 1

type RamsesDatabase = IDBPDatabase<RamsesDb>

let databasePromise: Promise<RamsesDatabase> | null = null

/** Open (and memoize) the database. First call creates the schema via `onUpgradeNeeded`. */
export function openLibrary(): Promise<RamsesDatabase> {
  if (!databasePromise) {
    databasePromise = openDB<RamsesDb>(DATABASE_NAME, DATABASE_VERSION, {
      upgrade(database) {
        // Version 1: initial schema. Each store only exists from its own
        // version on, so creation is guarded to stay forward-compatible.
        if (!database.objectStoreNames.contains('files')) {
          const files = database.createObjectStore('files', { keyPath: 'id' })
          files.createIndex('byCreated', 'createdAt')
        }
        if (!database.objectStoreNames.contains('songs')) {
          const songs = database.createObjectStore('songs', { keyPath: 'name' })
          songs.createIndex('byLastOpened', 'lastOpened')
        }
        if (!database.objectStoreNames.contains('kv')) {
          database.createObjectStore('kv', { keyPath: 'key' })
        }
      },
    })
  }
  return databasePromise
}

/** True when a write failed because the browser storage quota was exhausted. */
export function isQuotaError(reason: unknown): boolean {
  return reason instanceof DOMException && (reason.name === 'QuotaExceededError' || reason.name === 'NS_ERROR_DOM_QUOTA_REACHED')
}

// --- files ---

export async function putFile(file: FileRecord): Promise<void> {
  const database = await openLibrary()
  await database.put('files', file)
}

export async function getFile(id: RecordId): Promise<FileRecord | undefined> {
  const database = await openLibrary()
  return database.get('files', id)
}

export async function deleteFile(id: RecordId): Promise<void> {
  const database = await openLibrary()
  await database.delete('files', id)
}

// --- songs ---

export async function putSong(song: SongRecord): Promise<void> {
  const database = await openLibrary()
  await database.put('songs', song)
}

export async function getSong(name: string): Promise<SongRecord | undefined> {
  const database = await openLibrary()
  return database.get('songs', name)
}

/** All songs, most recently opened first. */
export async function listSongs(): Promise<SongRecord[]> {
  const database = await openLibrary()
  const records = await database.getAllFromIndex('songs', 'byLastOpened')
  return records.reverse()
}

/**
 * Delete a song together with every file it references, in a single
 * transaction so a crash can never leave orphaned blobs behind.
 */
export async function deleteSongWithFiles(name: string): Promise<void> {
  const database = await openLibrary()
  const transaction = database.transaction(['songs', 'files'], 'readwrite')
  const songs = transaction.objectStore('songs')
  const files = transaction.objectStore('files')
  const song = await songs.get(name)
  if (song) {
    await songs.delete(name)
    const fileIds = new Set([...Object.values(song.stems), ...(song.coverFileId ? [song.coverFileId] : [])])
    for (const fileId of fileIds) {
      await files.delete(fileId)
    }
  }
  await transaction.done
}

/**
 * Rename a song (its key is the slug) while keeping the referenced files
 * untouched, atomically within a single transaction.
 */
export async function renameSong(oldName: string, newName: string): Promise<void> {
  const database = await openLibrary()
  const transaction = database.transaction('songs', 'readwrite')
  const songs = transaction.objectStore('songs')
  const song = await songs.get(oldName)
  if (song) {
    await songs.delete(oldName)
    await songs.put({ ...song, name: newName })
  }
  await transaction.done
}

/** Merge a patch into a song record (lastOpened, duration, stem map updates...). */
export async function updateSong(name: string, patch: Partial<Omit<SongRecord, 'name'>>): Promise<void> {
  const database = await openLibrary()
  const song = await database.get('songs', name)
  if (song) await database.put('songs', { ...song, ...patch, name })
}

// --- kv ---

export async function getKv<T>(key: string): Promise<T | undefined> {
  const database = await openLibrary()
  const record = await database.get('kv', key)
  return record?.value as T | undefined
}

export async function setKv<T>(key: string, value: T): Promise<void> {
  const database = await openLibrary()
  await database.put('kv', { key, value })
}
