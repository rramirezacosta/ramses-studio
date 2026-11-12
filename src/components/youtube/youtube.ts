import { resolve } from 'node:path';
import { YoutubeIE } from './extractor/youtube.js';
import { selectFormats, sortFormats } from './format.js';
import { downloadFile } from './downloader.js';
import { expandTemplate } from './utils.js';

export interface VideoMetadata {
  title: string;
  thumbnail: string;
  artist: string;
  song: string;
  duration: number;
}

export class YoutubeDL {
  getVideoId(url: string): string {
    const match = url.match(/(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    if (!match) {
      throw new Error(`Unable to extract video ID from URL: "${url}". Supported formats: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/embed/ID, youtube.com/shorts/ID, youtube.com/live/ID.`);
    }
    return match[1];
  }

  async getMetadata(videoId: string): Promise<VideoMetadata> {
    // Validate video ID format
    if (!isValidVideoId(videoId)) {
      throw new Error(`Invalid YouTube video ID: "${videoId}". Expected 11 characters (A-Za-z0-9_-).`);
    }

    // Construct the YouTube URL
    const url = `https://www.youtube.com/watch?v=${videoId}`;

    // Use the pure-JS YouTube extractor
    const ie = new YoutubeIE();
    let info: any;
    try {
      info = await ie.realExtract(url);
    } catch (e: any) {
      throw new Error(`Failed to fetch video metadata: ${e?.message || e}`);
    }

    // Extract metadata fields
    const title = info.title || '';
    const thumbnail = info.thumbnail || '';
    const artist = info.artist || info.creator || info.uploader || '';
    const song = info.track || title;
    const duration = info.duration || 0;

    return { title, thumbnail, artist, song, duration };
  }

  async getAudioFile(videoId: string, quality: string, outputTemplate?: string): Promise<string> {
    // Validate video ID format
    if (!isValidVideoId(videoId)) {
      throw new Error(`Invalid YouTube video ID: "${videoId}". Expected 11 characters (A-Za-z0-9_-).`);
    }

    // Construct the YouTube URL
    const url = `https://www.youtube.com/watch?v=${videoId}`;

    // Use the pure-JS YouTube extractor to get format info
    const ie = new YoutubeIE();
    let info: any;
    try {
      info = await ie.realExtract(url);
    } catch (e: any) {
      throw new Error(`Failed to fetch video info: ${e?.message || e}`);
    }

    // Select the best audio format
    const formatSpec = quality === 'best' ? 'bestaudio' : quality;
    const chosen = selectFormats(info, formatSpec);
    if (!chosen.length) {
      throw new Error('No suitable audio format found for this video');
    }

    // Try each selected format until one downloads successfully
    // (some adaptive formats may require signature decryption)
    let lastError: string | null = null;
    for (const fmt of chosen) {
      if (!fmt.url) continue;
      const ext = fmt.ext || 'm4a';
      const template = outputTemplate || `./%(id)s.%(ext)s`;
      let outname = expandTemplate(template, info, ext);
      if (!outname) outname = videoId + '.' + ext;

      const ok = await downloadFile({ url: fmt.url, filename: outname, quiet: true });
      if (ok) {
        return resolve(process.cwd(), outname);
      }
      lastError = `Format ${fmt.format_id} download failed`;
    }

    // If audio-only formats fail, fall back to best combined format
    // Prefer regular (combined) formats — adaptive formats may require signature decryption
    const allFormats = sortFormats(info.formats || []);
    // Pick formats that have both video and audio (combined) in reverse order (best first)
    const combinedFormats = allFormats.filter((f: any) => f.vcodec !== 'none' && f.acodec !== 'none').reverse();
    for (const fmt of combinedFormats) {
      if (!fmt.url) continue;
      const ext = fmt.ext || 'mp4';
      const template = outputTemplate || `./%(id)s.%(ext)s`;
      let outname = expandTemplate(template, info, ext);
      if (!outname) outname = videoId + '.' + ext;

      const ok = await downloadFile({ url: fmt.url, filename: outname, quiet: false });
      if (ok) {
        return resolve(process.cwd(), outname);
      }
      lastError = `Fallback format ${fmt.format_id} download failed`;
    }

    throw new Error(`Failed to download audio for video ${videoId}: ${lastError || 'no formats available'}`);
  }
}

// Validate YouTube video ID format (11 chars: [A-Za-z0-9_-])
function isValidVideoId(id: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(id);
}

