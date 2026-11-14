/**
 * Record shapes persisted in IndexedDB (`ramses-studio` database).
 *
 * Large media lives once in the `files` store and is referenced by id from
 * `songs`, so stems (roughly six copies of the source) are never duplicated
 * inside metadata records.
 */

/** Identifier used as the primary key of `files`. */
export type RecordId = string

/** A single piece of media: one stem mp3, the original mix, or a cover image. */
export interface FileRecord {
  id: RecordId
  /** Original or display file name, kept for save/export flows. */
  name: string
  mime: string
  size: number
  createdAt: number
  blob: Blob
}

/** Stem file ids keyed by stem name ('vocals', 'drums', ...), matching SIX_STEM_NAMES. */
export type StemFileIds = Record<string, RecordId | null>

/** Metadata for one song in the library. Blobs are never stored here. */
export interface SongRecord {
  /** Folder slug, shared with the import pipeline ('pink-floyd--time'). Doubles as the primary key. */
  name: string
  createdAt: number
  /** Updated on every open so the sidebar can order by recency. */
  lastOpened: number
  duration: number
  /** `null` stem ids have no local blob: the song is backed up on Drive only. */
  stems: StemFileIds
  coverFileId?: RecordId
  /** True when every stem was evicted; the song re-downloads from Drive on open. */
  remoteOnly?: boolean
}

/** Small persisted values that belong with the library (not theme/language). */
export interface KvRecord {
  key: string
  value: unknown
}

/**
 * Song metadata as exchanged with Drive: no file ids, just the stem names.
 * File identities are per-device; the manifest checksums link content.
 */
export interface SongPayload {
  name: string
  createdAt: number
  lastOpened: number
  duration: number
  stems: string[]
}

/** Id helper. `crypto.randomUUID` is unavailable in some non-secure contexts, so fall back to random bytes. */
export function newRecordId(): RecordId {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`
}
