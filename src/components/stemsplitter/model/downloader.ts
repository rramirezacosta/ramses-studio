import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

export interface DownloadOptions {
  url: string;
  sha256?: string;
  cacheDir?: string;
  signal?: AbortSignal;
}

export async function downloadModel({ url, sha256, cacheDir = join(homedir(), '.cache', 'htdemucs-node'), signal }: DownloadOptions): Promise<string> {
  await mkdir(cacheDir, { recursive: true });
  const target = join(cacheDir, basename(new URL(url).pathname) || 'model.onnx');
  if (await isValid(target, sha256)) return target;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Model download failed: ${response.status} ${response.statusText}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (sha256 && digest(bytes) !== sha256.toLowerCase()) throw new Error('Model SHA-256 verification failed.');
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, target);
  return target;
}

async function isValid(path: string, sha256?: string): Promise<boolean> {
  try {
    const bytes = await readFile(path);
    return !sha256 || digest(bytes) === sha256.toLowerCase();
  } catch {
    return false;
  }
}

function digest(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}
