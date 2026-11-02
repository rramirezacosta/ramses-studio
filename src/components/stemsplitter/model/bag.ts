import type { StandardStemName } from '../types.js';
import type { LoadedSession } from './session-pool.js';

export type SessionBag = Map<StandardStemName, LoadedSession>;

export function isBag(sessions: Map<string, LoadedSession>): sessions is SessionBag {
  return !sessions.has('main');
}
