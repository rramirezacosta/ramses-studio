import type * as ort from 'onnxruntime-node';
import type { ModelContract } from '../types.js';

export interface ModelIo {
  contract: ModelContract;
  mixInput: string;
  specInput?: string;
  waveformOutput: string;
  spectrogramOutput?: string;
}

export function detectModelIo(session: ort.InferenceSession): ModelIo {
  const { inputNames, outputNames } = session;
  if (inputNames.length === 1) {
    return { contract: 'in-graph-stft', mixInput: inputNames[0], waveformOutput: outputNames[0] };
  }
  const mixInput = inputNames.find((name) => /^(mix|xt)$/i.test(name)) ?? inputNames[0];
  const specInput = inputNames.find((name) => name !== mixInput && /^(spec|mag|x)$/i.test(name)) ?? inputNames.find((name) => name !== mixInput);
  const waveformOutput = outputNames.find((name) => /(?:wave|xt)/i.test(name)) ?? outputNames.at(-1);
  const spectrogramOutput = outputNames.find((name) => name !== waveformOutput && /(?:spec|x)/i.test(name)) ?? outputNames[0];
  if (!specInput || !waveformOutput || !spectrogramOutput) throw new Error('Unsupported external-STFT model I/O signature.');
  return { contract: 'external-stft', mixInput, specInput, waveformOutput, spectrogramOutput };
}
