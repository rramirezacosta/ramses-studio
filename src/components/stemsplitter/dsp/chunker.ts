import { TRAINING_SAMPLES } from '../constants.js';

export interface Chunk {
  start: number;
  left: Float32Array;
  right: Float32Array;
}

/**
 * Creates a triangular window matching the Demucs reference implementation.
 * Ramps linearly from 1 to the midpoint, then back down to 1.
 */
export function createTriangularWindow(length: number): Float32Array {
  const window = new Float32Array(length);
  if (length === 1) return window.fill(1);
  const half = Math.floor(length / 2);
  for (let i = 0; i < length; i++) {
    if (i < half) {
      window[i] = i / half;
    } else {
      window[i] = (length - i) / (length - half);
    }
  }
  // Normalize to [0, 1] range with peak at 1
  return window;
}

export function createChunks(left: Float32Array, right: Float32Array, overlap: number, length = TRAINING_SAMPLES): Chunk[] {
  return [...iterateChunks(left, right, overlap, length)];
}

export function* iterateChunks(left: Float32Array, right: Float32Array, overlap: number, length = TRAINING_SAMPLES): Generator<Chunk> {
  if (left.length !== right.length) throw new RangeError('Stereo channels must have equal lengths.');
  if (!(overlap >= 0 && overlap < 1)) throw new RangeError('overlap must be in [0, 1).');
  const hop = Math.max(1, Math.floor(length * (1 - overlap)));
  for (let start = 0; start < Math.max(left.length, 1); start += hop) {
    yield {
      start,
      left: copyPadded(left, start, length),
      right: copyPadded(right, start, length),
    };
    if (start + length >= left.length) break;
  }
}

export function chunkCount(sampleCount: number, overlap: number, length = TRAINING_SAMPLES): number {
  if (!(overlap >= 0 && overlap < 1)) throw new RangeError('overlap must be in [0, 1).');
  if (sampleCount <= 0) return 1;
  const hop = Math.max(1, Math.floor(length * (1 - overlap)));
  return Math.ceil(Math.max(0, sampleCount - length) / hop) + 1;
}

function copyPadded(source: Float32Array, start: number, length: number): Float32Array {
  const result = new Float32Array(length);
  result.set(source.subarray(start, Math.min(source.length, start + length)));
  return result;
}

export class OverlapAccumulator {
  private readonly weights: Float32Array;
  private readonly channels = new Map<string, [Float32Array, Float32Array]>();
  private readonly weightedStarts = new Set<number>();

  public constructor(private readonly length: number, private readonly window: Float32Array) {
    this.weights = new Float32Array(length);
  }

  public add(stem: string, start: number, data: Float32Array): void {
    if (data.length !== this.window.length * 2) throw new RangeError('Expected planar stereo segment data.');
    let output = this.channels.get(stem);
    if (!output) {
      output = [new Float32Array(this.length), new Float32Array(this.length)];
      this.channels.set(stem, output);
    }
    const segmentLength = Math.min(this.window.length, this.length - start);
    for (let i = 0; i < segmentLength; i++) {
      const weight = this.window[i];
      output[0][start + i] += data[i] * weight;
      output[1][start + i] += data[this.window.length + i] * weight;
    }
    // The divisor must count each chunk's window exactly once, regardless of how many
    // stems are written into the same chunk. Accumulating inside add() (per stem) made
    // every stem's divisor N × window-sum (N = requested stem count), uniformly
    // attenuating all stems by ~20·log10(N) dB.
    if (!this.weightedStarts.has(start)) {
      this.weightedStarts.add(start);
      for (let i = 0; i < segmentLength; i++) this.weights[start + i] += this.window[i];
    }
  }

  public finalize(): Map<string, [Float32Array, Float32Array]> {
    for (const [left, right] of this.channels.values()) {
      for (let i = 0; i < this.length; i++) {
        const weight = Math.max(this.weights[i], 1e-8);
        left[i] /= weight;
        right[i] /= weight;
      }
    }
    return this.channels;
  }
}
