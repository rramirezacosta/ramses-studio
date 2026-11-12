import type * as ort from 'onnxruntime-node';

export type StemName = 'drums' | 'bass' | 'other' | 'vocals' | 'guitar' | 'piano';
export type StandardStemName = (typeof import('./constants.js').STEM_NAMES)[number];
export type ModelSource = string | Uint8Array;
export type ModelBag = Partial<Record<StandardStemName, ModelSource>>;

export interface StereoAudio {
  left: Float32Array;
  right?: Float32Array;
  sampleRate: number;
}

export type SeparationResult<S extends StemName = StandardStemName> = Record<S, StereoAudio>;

export interface ProgressInfo {
  progress: number;
  currentSegment: number;
  totalSegments: number;
}

export interface SeparatorOptions {
  modelPath: ModelSource | ModelBag;
  overlap?: number;
  lowMemory?: boolean;
  targetStems?: StemName[];
  onProgress?: (info: ProgressInfo) => void;
  signal?: AbortSignal;
  /** When true, defers model loading until the first call to separate(). */
  lazy?: boolean;
}

export type ModelContract = 'in-graph-stft' | 'external-stft';
