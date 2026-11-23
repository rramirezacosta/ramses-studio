export interface Normalization {
  mean: number;
  scale: number;
}

export function normalizeStereo(input: Float32Array, output = new Float32Array(input.length), stats?: Normalization): Normalization {
  if (input.length === 0 || input.length % 2 !== 0) throw new RangeError('Expected non-empty planar stereo data.');

  // If pre-computed stats are provided (global normalization), use them directly.
  if (stats) {
    for (let i = 0; i < input.length; i++) output[i] = (input[i] - stats.mean) / stats.scale;
    return stats;
  }

  const totalSamples = input.length;
  let mean = 0;
  for (let i = 0; i < totalSamples; i++) mean += input[i];
  mean /= totalSamples;

  let variance = 0;
  for (let i = 0; i < totalSamples; i++) {
    const diff = input[i] - mean;
    variance += diff * diff;
  }
  const scale = Math.sqrt(variance / totalSamples) + 1e-5;
  for (let i = 0; i < input.length; i++) output[i] = (input[i] - mean) / scale;
  return { mean, scale };
}

export function denormalizeStereo(buffer: Float32Array, { mean, scale }: Normalization): void {
  for (let i = 0; i < buffer.length; i++) buffer[i] = buffer[i] * scale + mean;
}
