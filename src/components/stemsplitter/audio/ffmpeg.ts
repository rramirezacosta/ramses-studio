import { spawn } from 'node:child_process';
import type { StereoAudio } from '../types.js';

export async function decodeWithFfmpeg(inputPath: string, executable = 'ffmpeg', signal?: AbortSignal): Promise<StereoAudio> {
  return new Promise((resolve, reject) => {
    const process = spawn(executable, ['-v', 'error', '-i', inputPath, '-ar', '44100', '-ac', '2', '-f', 's16le', 'pipe:1'], { signal });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    process.stdout.on('data', (data: Buffer) => stdout.push(data));
    process.stderr.on('data', (data: Buffer) => stderr.push(data));
    process.once('error', reject);
    process.once('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg failed (${code}): ${Buffer.concat(stderr).toString().trim()}`));
      try {
        const pcm = Buffer.concat(stdout);
        if (pcm.length % 4 !== 0) throw new Error('ffmpeg returned incomplete stereo PCM audio.');
        const frames = pcm.length / 4;
        const left = new Float32Array(frames);
        const right = new Float32Array(frames);
        for (let frame = 0; frame < frames; frame += 1) {
          left[frame] = pcm.readInt16LE(frame * 4) / 32768;
          right[frame] = pcm.readInt16LE(frame * 4 + 2) / 32768;
        }
        resolve({ left, right, sampleRate: 44_100 });
      } catch (error) {
        reject(error);
      }
    });
  });
}
