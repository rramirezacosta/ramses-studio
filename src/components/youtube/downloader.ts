import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

export interface DownloadContext { url: string; filename: string; headers?: Record<string,string>; quiet?: boolean; }

export async function downloadFile(ctx: DownloadContext): Promise<boolean> {
  try {
    const headers: Record<string,string> = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36', 'Referer': 'https://www.youtube.com/', 'Accept': '*/*', ...(ctx.headers||{}) };
    const res = await fetch(ctx.url, { headers, redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP Error ' + res.status);
    const total = Number(res.headers.get('content-length') || -1);
    const file = createWriteStream(ctx.filename);
    let downloaded = 0;
    const reader = res.body!.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      file.write(Buffer.from(value as any));
      downloaded += value.length;
      if (!ctx.quiet && total > 0) process.stderr.write(`\r[download] ${(100*downloaded/total).toFixed(1)}% of ${total}`);
    }
    file.end();
    await new Promise((resolve, reject) => { file.on("finish", resolve as any); file.on('error', reject); });
    if (!ctx.quiet) process.stderr.write('\n');
    return true;
  } catch (e: any) {
    console.error('Download failed: ' + (e?.message || e));
    return false;
  }
}
