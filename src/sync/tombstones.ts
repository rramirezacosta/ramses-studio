import { getKv, setKv } from '../db/db'

/**
 * Deletion tombstones for two-way Drive sync, recorded immediately on every
 * local delete/rename so deletions made while offline still propagate.
 * Pending (unsynced) tombstones live in the `kv` store and get merged into
 * the remote manifest at sync time.
 */

const PENDING_KEY = 'drive-sync-tombstones'

export type PendingTombstones = Record<string, number>

export const getPendingTombstones = async (): Promise<PendingTombstones> => (await getKv<PendingTombstones>(PENDING_KEY)) ?? {}

export async function recordTombstone(slug: string): Promise<void> {
  const pending = await getPendingTombstones()
  pending[slug] = Date.now()
  await setKv(PENDING_KEY, pending)
}

/** Remove a pending tombstone (e.g. the slug was re-imported after a delete). Returns true when one was cleared. */
export async function clearTombstone(slug: string): Promise<boolean> {
  const pending = await getPendingTombstones()
  if (!(slug in pending)) return false
  delete pending[slug]
  await setKv(PENDING_KEY, pending)
  return true
}

export async function clearAllTombstones(): Promise<void> {
  await setKv(PENDING_KEY, {})
}
