import { getKv, setKv } from '../db/db'
import type { TrackState } from '../types/audio'

/**
 * Per-song practice state: how the user had the mixer set (volumes, mutes,
 * solos) and the loop they was working on. Persisted in the `kv` store and
 * restored when the song opens, so a session of practicing survives restarts.
 */

export interface PracticeState {
  /** Stem-level mixer settings keyed by stem name. */
  tracks: Record<string, Pick<TrackState, 'volume' | 'pan' | 'muted' | 'soloed'>>
  loopRange?: [number, number]
  looping?: boolean
}

const KEY = 'practice-state'

const loadAll = async (): Promise<Record<string, PracticeState>> => (await getKv<Record<string, PracticeState>>(KEY)) ?? {}

export const loadPracticeState = async (name: string): Promise<PracticeState | undefined> => (await loadAll())[name]

export async function savePracticeState(name: string, state: PracticeState): Promise<void> {
  const all = await loadAll()
  all[name] = state
  await setKv(KEY, all)
}

export async function deletePracticeState(name: string): Promise<void> {
  const all = await loadAll()
  if (!(name in all)) return
  delete all[name]
  await setKv(KEY, all)
}

export async function renamePracticeState(oldName: string, newName: string): Promise<void> {
  const all = await loadAll()
  if (!(oldName in all)) return
  all[newName] = all[oldName]
  delete all[oldName]
  await setKv(KEY, all)
}
