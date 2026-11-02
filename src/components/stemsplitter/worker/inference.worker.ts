import { parentPort, workerData } from 'node:worker_threads';
import { Separator } from '../separator.js';
import type { SeparatorOptions, StereoAudio } from '../types.js';

interface WorkerRequest {
  options: SeparatorOptions;
  audio: StereoAudio;
}

if (!parentPort) throw new Error('This module must run in a worker thread.');

const request = workerData as WorkerRequest;
try {
  const separator = await Separator.create(request.options);
  const result = await separator.separate(request.audio);
  await separator.dispose();
  parentPort.postMessage(result);
} catch (error) {
  parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) });
}
