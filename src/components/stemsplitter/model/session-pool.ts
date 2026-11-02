import os from 'node:os';
import * as ort from 'onnxruntime-node';
import type { ModelSource, SeparatorOptions } from '../types.js';
import { detectModelIo, type ModelIo } from './contract.js';

export interface LoadedSession {
  session: ort.InferenceSession;
  io: ModelIo;
}

function gpuExecutionProviders(): ort.InferenceSession.ExecutionProviderConfig[] {
  switch (process.platform) {
    case 'win32':
      return ['dml'];
    case 'linux':
      return ['cuda'];
    case 'darwin':
      return ['coreml'];
    default:
      return [];
  }
}

function sessionOptions(options: SeparatorOptions, executionProviders: ort.InferenceSession.ExecutionProviderConfig[]): ort.InferenceSession.SessionOptions {
  return {
    executionProviders,
    graphOptimizationLevel: 'all',
    enableCpuMemArena: !options.lowMemory,
    enableMemPattern: !options.lowMemory,
    intraOpNumThreads: Math.max(1, os.availableParallelism() >> 1),
    interOpNumThreads: 1,
  };
}

async function createInferenceSession(source: ModelSource, options: SeparatorOptions, executionProviders: ort.InferenceSession.ExecutionProviderConfig[]) {
  const config = sessionOptions(options, executionProviders);
  return typeof source === 'string'
    ? ort.InferenceSession.create(source, config)
    : ort.InferenceSession.create(source, config);
}

export async function createSession(source: ModelSource, options: SeparatorOptions): Promise<LoadedSession> {
  const configuredProviders = options.executionProviders
  const gpuProviders = configuredProviders ?? gpuExecutionProviders()
  let session: ort.InferenceSession

  if (configuredProviders) {
    session = await createInferenceSession(source, options, configuredProviders)
    console.info(`[StemSplitter] Using inference provider: ${configuredProviders.map(String).join(', ')}.`)
  } else if (gpuProviders.length) {
    try {
      session = await createInferenceSession(source, options, gpuProviders)
      console.info(`[StemSplitter] Using GPU inference: ${gpuProviders.map(String).join(', ')}.`)
    } catch (error) {
      console.warn(`[StemSplitter] GPU inference unavailable (${gpuProviders.map(String).join(', ')}); falling back to CPU.`, error)
      session = await createInferenceSession(source, options, ['cpu'])
      console.info('[StemSplitter] Using CPU inference.')
    }
  } else {
    session = await createInferenceSession(source, options, ['cpu'])
    console.info('[StemSplitter] Using CPU inference.')
  }

  return { session, io: detectModelIo(session) };
}

export async function releaseSessions(sessions: Iterable<LoadedSession>): Promise<void> {
  await Promise.all([...sessions].map(({ session }) => session.release()));
}
