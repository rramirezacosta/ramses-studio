import os from 'node:os';
import * as ort from 'onnxruntime-node';
import type { ModelSource, SeparatorOptions } from '../types.js';
import { detectModelIo, type ModelIo } from './contract.js';

export interface LoadedSession {
  session: ort.InferenceSession;
  io: ModelIo;
}

function sessionOptions(options: SeparatorOptions): ort.InferenceSession.SessionOptions {
  return {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
    enableCpuMemArena: !options.lowMemory,
    enableMemPattern: !options.lowMemory,
    intraOpNumThreads: Math.max(1, os.availableParallelism() >> 1),
    interOpNumThreads: 1,
  };
}

async function createInferenceSession(source: ModelSource, options: SeparatorOptions) {
  const config = sessionOptions(options);
  return typeof source === 'string'
    ? ort.InferenceSession.create(source, config)
    : ort.InferenceSession.create(source, config);
}

export async function createSession(source: ModelSource, options: SeparatorOptions): Promise<LoadedSession> {
  const session = await createInferenceSession(source, options);
  console.info('[StemSplitter] Using CPU inference.');
  return { session, io: detectModelIo(session) };
}

export async function releaseSessions(sessions: Iterable<LoadedSession>): Promise<void> {
  await Promise.all([...sessions].map(({ session }) => session.release()));
}
