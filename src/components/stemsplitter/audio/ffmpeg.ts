import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import coreJsUrl from '@ffmpeg/core?url';
import coreWasmUrl from '@ffmpeg/core/wasm?url';
import type { StereoAudio } from '../types.js';

let ffmpegPromise: Promise<FFmpeg> | null = null;

async function getFfmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const ffmpeg = new FFmpeg();
      const coreURL = await toBlobURL(coreJsUrl, 'text/javascript');
      const wasmURL = await toBlobURL(coreWasmUrl, 'application/wasm');
      await ffmpeg.load({ coreURL, wasmURL });
      return ffmpeg;
    })();
  }
  return ffmpegPromise;
}

export async function decodeWithFfmpeg(
  input: Uint8Array | ArrayBuffer | string,
  _executable?: string,
  signal?: AbortSignal,
  normalize?: boolean,
): Promise<StereoAudio> {
  const ffmpeg = await getFfmpeg();
  const inputName = 'input';
  const outputName = 'output.pcm';
  const data = typeof input === 'string' ? await fetchFile(input) : new Uint8Array(input);
  await ffmpeg.writeFile(inputName, data);
  const args = ['-v', 'error', '-i', inputName];
  if (normalize) args.push('-af', 'loudnorm=I=-14:TP=-1.5:LRA=11');
  args.push('-ar', '44100', '-ac', '2', '-f', 's16le', outputName);
  await ffmpeg.exec(args, -1, { signal });
  const pcm = (await ffmpeg.readFile(outputName)) as Uint8Array;
  await ffmpeg.deleteFile(inputName).catch(() => undefined);
  await ffmpeg.deleteFile(outputName).catch(() => undefined);

  if (pcm.length % 4 !== 0) throw new Error('ffmpeg returned incomplete stereo PCM audio.');
  const frames = pcm.length / 4;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  for (let frame = 0; frame < frames; frame += 1) {
    left[frame] = view.getInt16(frame * 4, true) / 32768;
    right[frame] = view.getInt16(frame * 4 + 2, true) / 32768;
  }
  return { left, right, sampleRate: 44_100 };
}

export async function encodeMp3WithFfmpeg(wav: Uint8Array): Promise<Uint8Array> {
  const ffmpeg = await getFfmpeg();
  await ffmpeg.writeFile('input.wav', wav);
  await ffmpeg.exec(['-v', 'error', '-y', '-i', 'input.wav', '-codec:a', 'libmp3lame', '-q:a', '2', 'output.mp3']);
  const mp3 = (await ffmpeg.readFile('output.mp3')) as Uint8Array;
  await ffmpeg.deleteFile('input.wav').catch(() => undefined);
  await ffmpeg.deleteFile('output.mp3').catch(() => undefined);
  return mp3;
}

export const encodeMp3 = encodeMp3WithFfmpeg;
export const encodeWithFfmpeg = encodeMp3WithFfmpeg;