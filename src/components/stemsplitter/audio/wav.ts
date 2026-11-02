import { CHANNELS } from '../constants.js';
import type { StereoAudio } from '../types.js';

export function decodeWav(input: Uint8Array): StereoAudio {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') throw new Error('Unsupported WAV container.');
  let offset = 12;
  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = 0;
  let dataLength = 0;
  while (offset + 8 <= view.byteLength) {
    const id = readAscii(view, offset, 4);
    const length = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (id === 'fmt ') {
      format = view.getUint16(start, true);
      channels = view.getUint16(start + 2, true);
      sampleRate = view.getUint32(start + 4, true);
      bitsPerSample = view.getUint16(start + 14, true);
    } else if (id === 'data') {
      dataOffset = start;
      dataLength = length;
    }
    offset = start + length + (length & 1);
  }
  if (!dataOffset || !dataLength || !sampleRate || (channels !== 1 && channels !== 2)) throw new Error('Invalid or unsupported WAV file.');
  if (!((format === 1 && [16, 24].includes(bitsPerSample)) || (format === 3 && bitsPerSample === 32))) throw new Error('Only PCM 16-bit, PCM 24-bit, and IEEE float WAV files are supported.');
  const bytesPerSample = bitsPerSample / 8;
  const frames = Math.floor(dataLength / (channels * bytesPerSample));
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    const frameOffset = dataOffset + frame * channels * bytesPerSample;
    left[frame] = readSample(view, frameOffset, format, bitsPerSample);
    right[frame] = channels === 2 ? readSample(view, frameOffset + bytesPerSample, format, bitsPerSample) : left[frame];
  }
  return { left, right, sampleRate };
}

export function encodeWav(audio: StereoAudio): Uint8Array {
  const right = audio.right ?? audio.left;
  if (audio.left.length !== right.length) throw new RangeError('Stereo channels must have equal lengths.');
  const dataLength = audio.left.length * CHANNELS * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * CHANNELS * 2, true);
  view.setUint16(32, CHANNELS * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataLength, true);
  for (let i = 0; i < audio.left.length; i++) {
    view.setInt16(44 + i * 4, toInt16(audio.left[i]), true);
    view.setInt16(46 + i * 4, toInt16(right[i]), true);
  }
  return new Uint8Array(buffer);
}

function readSample(view: DataView, offset: number, format: number, bits: number): number {
  if (format === 3) return view.getFloat32(offset, true);
  if (bits === 16) return view.getInt16(offset, true) / 32768;
  const value = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getInt8(offset + 2) << 16);
  return value / 8_388_608;
}

function toInt16(value: number): number {
  return Math.round(Math.max(-1, Math.min(1, value)) * (value < 0 ? 32768 : 32767));
}

function readAscii(view: DataView, offset: number, length: number): string {
  return String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + offset, length));
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
}
