import { FFT_SIZE, HOP_SIZE, SPECTROGRAM_BINS, SPECTROGRAM_FRAMES, TRAINING_SAMPLES } from '../constants.js';
import { Radix2Fft } from './fft.js';

const fft = new Radix2Fft(FFT_SIZE);
const window = Float32Array.from({ length: FFT_SIZE }, (_, i) => (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE)) / Math.sqrt(FFT_SIZE));

export function stft(input: Float32Array): Float32Array {
  if (input.length !== TRAINING_SAMPLES * 2) throw new RangeError(`Expected ${TRAINING_SAMPLES} planar stereo samples.`);
  const output = new Float32Array(4 * SPECTROGRAM_BINS * SPECTROGRAM_FRAMES);
  const real = new Float32Array(FFT_SIZE);
  const imaginary = new Float32Array(FFT_SIZE);
  for (let channel = 0; channel < 2; channel++) {
    for (let frame = 0; frame < SPECTROGRAM_FRAMES; frame++) {
      const offset = frame * HOP_SIZE - FFT_SIZE / 2;
      for (let i = 0; i < FFT_SIZE; i++) real[i] = reflect(input, channel * TRAINING_SAMPLES + offset + i, channel) * window[i];
      imaginary.fill(0);
      fft.forward(real, imaginary);
      const channelOffset = channel * 2 * SPECTROGRAM_BINS * SPECTROGRAM_FRAMES;
      for (let bin = 0; bin < SPECTROGRAM_BINS; bin++) {
        output[channelOffset + bin * SPECTROGRAM_FRAMES + frame] = real[bin];
        output[channelOffset + SPECTROGRAM_BINS * SPECTROGRAM_FRAMES + bin * SPECTROGRAM_FRAMES + frame] = imaginary[bin];
      }
    }
  }
  return output;
}

export function istft(spectrogram: Float32Array, stemIndex = 0): Float32Array {
  const perStem = 4 * SPECTROGRAM_BINS * SPECTROGRAM_FRAMES;
  if (spectrogram.length < (stemIndex + 1) * perStem) throw new RangeError('Spectrogram does not contain requested stem.');
  const paddedLength = TRAINING_SAMPLES + FFT_SIZE;
  const channels = [new Float32Array(paddedLength), new Float32Array(paddedLength)];
  const weights = new Float32Array(paddedLength);
  const real = new Float32Array(FFT_SIZE);
  const imaginary = new Float32Array(FFT_SIZE);
  const base = stemIndex * perStem;
  for (let channel = 0; channel < 2; channel++) {
    const channelOffset = base + channel * 2 * SPECTROGRAM_BINS * SPECTROGRAM_FRAMES;
    for (let frame = 0; frame < SPECTROGRAM_FRAMES; frame++) {
      real.fill(0);
      imaginary.fill(0);
      for (let bin = 0; bin < SPECTROGRAM_BINS; bin++) {
        real[bin] = spectrogram[channelOffset + bin * SPECTROGRAM_FRAMES + frame];
        imaginary[bin] = spectrogram[channelOffset + SPECTROGRAM_BINS * SPECTROGRAM_FRAMES + bin * SPECTROGRAM_FRAMES + frame];
        if (bin > 0) {
          real[FFT_SIZE - bin] = real[bin];
          imaginary[FFT_SIZE - bin] = -imaginary[bin];
        }
      }
      fft.inverse(real, imaginary);
      const start = frame * HOP_SIZE;
      for (let i = 0; i < FFT_SIZE; i++) {
        channels[channel][start + i] += real[i] * window[i];
        if (channel === 0) weights[start + i] += window[i] * window[i];
      }
    }
  }
  const output = new Float32Array(TRAINING_SAMPLES * 2);
  for (let channel = 0; channel < 2; channel++) {
    for (let i = 0; i < TRAINING_SAMPLES; i++) output[channel * TRAINING_SAMPLES + i] = channels[channel][i + FFT_SIZE / 2] / Math.max(weights[i + FFT_SIZE / 2], 1e-12);
  }
  return output;
}

function reflect(input: Float32Array, index: number, channel: number): number {
  const start = channel * TRAINING_SAMPLES;
  const end = start + TRAINING_SAMPLES;
  let relative = index - start;
  while (relative < 0 || relative >= TRAINING_SAMPLES) relative = relative < 0 ? -relative : 2 * TRAINING_SAMPLES - 2 - relative;
  return input[start + relative];
}
