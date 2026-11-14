import { getFile, getKv, setKv } from '../db/db'
import type { RecordId, SongPayload, SongRecord } from '../db/types'
import { useLibraryStore } from '../store/useLibraryStore'
import { clearAllTombstones, getPendingTombstones } from './tombstones'

/**
 * Two-way sync between the local IndexedDB library and the Google Drive
 * app-data folder. The manifest carries per-file SHA-256 checksums and
 * deletion tombstones; the last synced manifest is the snapshot both sides
 * are diffed against.
 *
 * File conflict rules: a side that matches the snapshot is unchanged; when
 * both sides changed, the local device wins (local-first app). Stems are
 * immutable, so real conflicts are renames, deletions and song metadata.
 */

const MANIFEST_NAME = 'manifest.json'
const MANIFEST_VERSION = 1

const MANIFEST_SNAPSHOT_KEY = 'drive-sync-manifest'
const HASH_CACHE_KEY = 'drive-sync-hashes'
const LAST_SYNCED_KEY = 'drive-last-synced'
/** Per-device slugs the user excluded from Drive backup ("Remove from Google Drive"). */
const EXCLUDED_KEY = 'drive-sync-excluded'

/** Drive file entry inside the manifest. */
export interface ManifestFile {
  fileId: string
  sha256: string
  size: number
  modifiedTime?: string
}

export interface ManifestSong {
  name: string
  json: ManifestFile
  stems: Record<string, ManifestFile>
  cover?: ManifestFile
}

export interface Manifest {
  version: number
  songs: Record<string, ManifestSong>
  /** Slug → deletion time (epoch ms). Tombstones are kept forever. */
  tombstones: Record<string, number>
}

const EMPTY_MANIFEST: Manifest = { version: MANIFEST_VERSION, songs: {}, tombstones: {} }

const songJsonName = (slug: string) => `song/${slug}.json`
const stemFileName = (slug: string, stemName: string) => `stems/${slug}/${stemName}.mp3`
const coverFileName = (slug: string) => `covers/${slug}.jpg`

const snapshotKey = (fileId: string, size: number) => `${fileId}:${size}`

const hashCache = async (): Promise<Record<string, string>> => (await getKv<Record<string, string>>(HASH_CACHE_KEY)) ?? {}

async function sha256Hex(bytes: Uint8Array, cacheKey?: string): Promise<string> {
  const cache = cacheKey ? await hashCache() : undefined
  const cached = cacheKey ? cache?.[cacheKey] : undefined
  if (cached) return cached
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  if (cache && cacheKey) {
    cache[cacheKey] = hex
    await setKv(HASH_CACHE_KEY, cache)
  }
  return hex
}

function parseManifest(bytes: Uint8Array): Manifest {
  const manifest = JSON.parse(new TextDecoder().decode(bytes)) as Manifest
  if (typeof manifest !== 'object' || manifest === null || typeof manifest.version !== 'number') {
    throw new Error('The Drive library manifest is corrupted.')
  }
  return { version: manifest.version, songs: manifest.songs ?? {}, tombstones: manifest.tombstones ?? {} }
}

const encodeJson = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

async function uploadFile(name: string, mimeType: string, bytes: Uint8Array, sha256: string, fileId?: string): Promise<ManifestFile> {
  const uploaded = await window.api.driveUpload({ name, mimeType, bytes, ...(fileId ? { fileId } : {}) })
  return { fileId: uploaded.id, sha256, size: bytes.length, ...(uploaded.modifiedTime ? { modifiedTime: uploaded.modifiedTime } : {}) }
}

interface LocalFile {
  fileId: RecordId
  bytes: Uint8Array
  mime: string
  size: number
}

async function getLocalFile(fileId: RecordId): Promise<LocalFile | undefined> {
  const file = await getFile(fileId)
  if (!file) return undefined
  return { fileId, bytes: new Uint8Array(await file.blob.arrayBuffer()), mime: file.mime, size: file.size }
}

/**
 * Reconcile one file against its remote and snapshot entries.
 * A side that matches the snapshot is unchanged; when both changed, the
 * local device wins. Returns the final manifest entry, optionally with
 * `repull` when the remote changed and the local side did not (the caller
 * re-downloads the whole song from the remote, which is authoritative).
 */
async function reconcileFile(options: {
  name: string
  local: LocalFile | undefined
  remote: ManifestFile | undefined
  snapshot: ManifestFile | undefined
  localSha?: string
}): Promise<{ file: ManifestFile; repull?: boolean }> {
  const { name, local, remote, snapshot, localSha } = options
  if (!local) {
    // No local data: the remote is the only source of truth → re-pull.
    if (!remote) throw new Error(`Missing file "${name}".`)
    return { file: remote, repull: true }
  }
  if (!remote) {
    const sha = localSha ?? (await sha256Hex(local.bytes))
    return { file: await uploadFile(name, local.mime, local.bytes, sha) }
  }
  const sha = localSha ?? (await sha256Hex(local.bytes, snapshotKey(local.fileId, local.size)))
  if (remote.sha256 === sha) return { file: remote }
  // Locally unchanged since the snapshot: the remote changed → re-pull.
  if (snapshot?.sha256 === sha) return { file: remote, repull: true }
  // Local changed (first sync or remote-also-changed): the local side wins.
  return { file: await uploadFile(name, local.mime, local.bytes, sha, remote.fileId) }
}

async function pullSong(slug: string, entry: ManifestSong): Promise<void> {
  const library = useLibraryStore.getState()
  const payloadBytes = await window.api.driveDownload(entry.json.fileId)
  const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as SongPayload
  const files: Array<{ stemName: string; bytes: Uint8Array }> = []
  for (const [stemName, meta] of Object.entries(entry.stems ?? {})) {
    files.push({ stemName, bytes: await window.api.driveDownload(meta.fileId) })
  }
  let cover: Uint8Array | undefined
  if (entry.cover) cover = await window.api.driveDownload(entry.cover.fileId)
  await library.deleteSongLocal(slug)
  await library.upsertRemoteSong({ ...payload, name: slug }, files, cover)
}

/** Upload one local song completely (new song, or first sync). */
async function pushSong(record: SongRecord): Promise<ManifestSong> {
  const payload: SongPayload = {
    name: record.name,
    createdAt: record.createdAt,
    lastOpened: record.lastOpened,
    duration: record.duration,
    stems: Object.keys(record.stems).sort(),
  }
  const jsonBytes = encodeJson(payload)
  const json = await uploadFile(songJsonName(record.name), 'application/json', jsonBytes, await sha256Hex(jsonBytes))
  const stems: Record<string, ManifestFile> = {}
  for (const [stemName, fileId] of Object.entries(record.stems)) {
    const local = await getLocalFile(fileId)
    if (!local) continue
    const sha = await sha256Hex(local.bytes, snapshotKey(local.fileId, local.size))
    stems[stemName] = await uploadFile(stemFileName(record.name, stemName), local.mime, local.bytes, sha)
  }
  let cover: ManifestFile | undefined
  if (record.coverFileId) {
    const local = await getLocalFile(record.coverFileId)
    if (local) {
      const sha = await sha256Hex(local.bytes, snapshotKey(local.fileId, local.size))
      cover = await uploadFile(coverFileName(record.name), local.mime, local.bytes, sha)
    }
  }
  return { name: record.name, json, stems, ...(cover ? { cover } : {}) }
}

/** Reconcile a song that exists on both sides, returning its manifest entry. */
async function reconcileSong(record: SongRecord, entry: ManifestSong, snapshotSong: ManifestSong | undefined): Promise<ManifestSong> {
  const remoteStems = entry.stems ?? {}
  const snapshotStems = snapshotSong?.stems ?? {}
  const stems: Record<string, ManifestFile> = {}
  const removedRemote: string[] = []
  let repull = false

  for (const [stemName, fileId] of Object.entries(record.stems)) {
    const local = await getLocalFile(fileId)
    const result = await reconcileFile({
      name: stemFileName(record.name, stemName),
      local,
      remote: remoteStems[stemName],
      snapshot: snapshotStems[stemName],
    })
    if (result.repull) repull = true
    stems[stemName] = result.file
  }
  // Remote stems the local song no longer has (deleted here) → delete remotely.
  for (const [stemName, meta] of Object.entries(remoteStems)) {
    if (!(stemName in record.stems)) removedRemote.push(meta.fileId)
  }

  let cover: ManifestFile | undefined
  if (record.coverFileId) {
    const local = await getLocalFile(record.coverFileId)
    const result = await reconcileFile({
      name: coverFileName(record.name),
      local,
      remote: entry.cover,
      snapshot: snapshotSong?.cover,
    })
    if (result.repull) repull = true
    cover = result.file
  } else if (entry.cover) {
    removedRemote.push(entry.cover.fileId)
  }

  if (repull) {
    // The remote changed this song while it stayed the same locally.
    await Promise.allSettled(removedRemote.map((fileId) => window.api.driveDelete(fileId)))
    const pulledEntry = pruneRemoved(entry, removedRemote)
    await pullSong(record.name, pulledEntry)
    return pulledEntry
  }

  // Song metadata: regenerate locally, reconcile like any other file.
  const payload: SongPayload = {
    name: record.name,
    createdAt: record.createdAt,
    lastOpened: record.lastOpened,
    duration: record.duration,
    stems: Object.keys(record.stems).sort(),
  }
  const jsonBytes = encodeJson(payload)
  const jsonResult = await reconcileFile({
    name: songJsonName(record.name),
    local: { fileId: 'json', bytes: jsonBytes, mime: 'application/json', size: jsonBytes.length },
    remote: entry.json,
    snapshot: snapshotSong?.json,
  })
  if (jsonResult.repull) {
    await Promise.allSettled(removedRemote.map((fileId) => window.api.driveDelete(fileId)))
    const pulledEntry = pruneRemoved(entry, removedRemote)
    await pullSong(record.name, pulledEntry)
    return pulledEntry
  }

  await Promise.allSettled(removedRemote.map((fileId) => window.api.driveDelete(fileId)))
  return { name: record.name, json: jsonResult.file, stems, ...(cover ? { cover } : {}) }
}

/** Copy of a manifest entry without any files scheduled for remote deletion. */
function pruneRemoved(entry: ManifestSong, removedRemote: string[]): ManifestSong {
  const removed = new Set(removedRemote)
  return {
    ...entry,
    stems: Object.fromEntries(Object.entries(entry.stems ?? {}).filter(([, meta]) => !removed.has(meta.fileId))),
    ...(entry.cover && !removed.has(entry.cover.fileId) ? { cover: entry.cover } : {}),
  }
}

/** Song slugs present in the last synced manifest (the "backed up" set). */
export const syncedSongNames = async (): Promise<Set<string>> => {
  const snapshot = await getKv<Manifest>(MANIFEST_SNAPSHOT_KEY)
  return new Set(Object.keys(snapshot?.songs ?? {}))
}

/** Slugs this device keeps out of Drive backup; they still sync as deletions. */
const excludedSlugs = async (): Promise<Set<string>> => new Set((await getKv<string[]>(EXCLUDED_KEY)) ?? [])

async function setExcludedSlugs(slugs: Set<string>): Promise<void> {
  await setKv(EXCLUDED_KEY, [...slugs])
}

/** Delete a song's remote files and drop its manifest entry in one pass. */
async function deleteSongRemotely(manifest: Manifest, entry: ManifestSong): Promise<Manifest> {
  const fileIds = [entry.json.fileId, ...Object.values(entry.stems ?? {}).map((meta) => meta.fileId), ...(entry.cover ? [entry.cover.fileId] : [])]
  await Promise.allSettled(fileIds.map((fileId) => window.api.driveDelete(fileId)))
  const songs = { ...manifest.songs }
  delete songs[entry.name]
  return { ...manifest, songs }
}

/** Upload the manifest back to Drive and refresh the local snapshot. */
async function persistManifest(manifest: Manifest, manifestFileId?: string): Promise<Set<string>> {
  const bytes = encodeJson(manifest)
  await uploadFile(MANIFEST_NAME, 'application/json', bytes, await sha256Hex(bytes), manifestFileId)
  await setKv(MANIFEST_SNAPSHOT_KEY, manifest)
  return new Set(Object.keys(manifest.songs))
}

/** Shared head of the per-song operations: connection check + remote manifest. */
async function loadRemoteManifest(): Promise<{ manifest: Manifest; manifestFileId?: string }> {
  const status = await window.api.driveStatus()
  if (!status.connected) throw new Error('Google Drive is not connected.')
  const files = await window.api.driveList()
  const manifestFile = files.find((file) => file.name === MANIFEST_NAME)
  const manifest = manifestFile ? parseManifest(await window.api.driveDownload(manifestFile.id)) : EMPTY_MANIFEST
  return { manifest, ...(manifestFile ? { manifestFileId: manifestFile.id } : {}) }
}

/**
 * Remove one song's backup from Drive ("Remove from Google Drive").
 * Keeps the local copy, deletes the remote files, and remembers the slug so
 * future syncs stop backing it up from this device. Returns the synced set.
 */
export async function removeSongFromDrive(slug: string): Promise<Set<string>> {
  const excluded = await excludedSlugs()
  excluded.add(slug)
  await setExcludedSlugs(excluded)

  const { manifest, manifestFileId } = await loadRemoteManifest()
  const entry = manifest.songs[slug]
  if (!entry) return new Set(Object.keys(manifest.songs))
  return persistManifest(await deleteSongRemotely(manifest, entry), manifestFileId)
}

/**
 * Back up one song right now ("Sync with Google Drive"): uploads or
 * reconciles just this song against the remote manifest and clears any
 * deletion tombstone or per-device exclusion for it. Returns the synced set.
 */
export async function backupSongToDrive(slug: string): Promise<Set<string>> {
  const record = useLibraryStore.getState().records.get(slug)
  if (!record) throw new Error(`"${slug}" is not in the local library.`)

  const excluded = await excludedSlugs()
  excluded.delete(slug)
  await setExcludedSlugs(excluded)

  const { manifest, manifestFileId } = await loadRemoteManifest()
  const tombstones = { ...manifest.tombstones }
  delete tombstones[slug]

  const entry = manifest.songs[slug]
  const song = entry
    ? await reconcileSong(record, entry, (await getKv<Manifest>(MANIFEST_SNAPSHOT_KEY))?.songs?.[slug])
    : await pushSong(record)
  return persistManifest({ ...manifest, tombstones, songs: { ...manifest.songs, [slug]: song } }, manifestFileId)
}

/** Run one full two-way sync. Throws on any failure; the caller owns state. Returns the synced song slugs. */
export async function syncLibrary(): Promise<Set<string>> {
  const status = await window.api.driveStatus()
  if (!status.connected) throw new Error('Google Drive is not connected.')

  const library = useLibraryStore.getState()
  const remoteFiles = await window.api.driveList()
  const byName = new Map(remoteFiles.map((file) => [file.name, file]))

  const manifestFile = byName.get(MANIFEST_NAME)
  const manifest = manifestFile
    ? parseManifest(await window.api.driveDownload(manifestFile.id))
    : { ...EMPTY_MANIFEST, songs: {}, tombstones: {} }
  const snapshot = (await getKv<Manifest>(MANIFEST_SNAPSHOT_KEY)) ?? EMPTY_MANIFEST
  const excluded = await excludedSlugs()

  // --- Tombstones ---
  const pending = await getPendingTombstones()
  const tombstones: Record<string, number> = { ...manifest.tombstones }
  for (const [slug, deletedAt] of Object.entries(pending)) {
    tombstones[slug] = Math.max(tombstones[slug] ?? 0, deletedAt)
  }
  const removedSongs = new Set<string>()
  for (const [slug, deletedAt] of Object.entries(tombstones)) {
    const record = library.records.get(slug)
    if (!record) {
      // Deleted (here or elsewhere); drop any stale manifest entry.
      removedSongs.add(slug)
      continue
    }
    if (record.createdAt > deletedAt) {
      // Re-imported after the deletion: the tombstone no longer applies.
      delete tombstones[slug]
      continue
    }
    // Another device deleted this song → delete it locally.
    await library.deleteSongLocal(slug)
    removedSongs.add(slug)
  }

  // --- Pull songs that only exist remotely ---
  for (const [slug, entry] of Object.entries(manifest.songs)) {
    if (removedSongs.has(slug) || library.records.has(slug)) continue
    if (excluded.has(slug)) continue // This device opted out of this song's backup.
    await pullSong(slug, entry)
  }

  // --- Reconcile/push local songs ---
  const localRecords = [...useLibraryStore.getState().records.values()]
  const songs: Record<string, ManifestSong> = {}
  const excludedRemovals: ManifestSong[] = []
  for (const [slug, entry] of Object.entries(manifest.songs)) {
    if (removedSongs.has(slug)) continue
    if (excluded.has(slug)) {
      // Opted out here: strip the stale remote backup (files + entry).
      excludedRemovals.push(entry)
      continue
    }
    songs[slug] = entry
  }
  for (const record of localRecords) {
    if (tombstones[record.name] !== undefined || excluded.has(record.name)) continue
    const entry = manifest.songs[record.name]
    const snapshotSong = snapshot.songs?.[record.name]
    songs[record.name] = entry
      ? await reconcileSong(record, entry, snapshotSong)
      : await pushSong(record)
  }
  await Promise.allSettled(excludedRemovals.flatMap((entry) => [
    entry.json.fileId,
    ...Object.values(entry.stems ?? {}).map((meta) => meta.fileId),
    ...(entry.cover ? [entry.cover.fileId] : []),
  ]).map((fileId) => window.api.driveDelete(fileId)))

  // --- Manifest + bookkeeping ---
  const finalManifest: Manifest = { version: MANIFEST_VERSION, songs, tombstones }
  const manifestBytes = encodeJson(finalManifest)
  await uploadFile(MANIFEST_NAME, 'application/json', manifestBytes, await sha256Hex(manifestBytes), manifestFile?.id)
  await setKv(MANIFEST_SNAPSHOT_KEY, finalManifest)
  await clearAllTombstones()
  await setKv(LAST_SYNCED_KEY, Date.now())
  return new Set(Object.keys(songs))
}

/** Last successful sync time (epoch ms), if any. */
export const lastSyncedAt = async (): Promise<number | undefined> => (await getKv<number>(LAST_SYNCED_KEY)) ?? undefined
