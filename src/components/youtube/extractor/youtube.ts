import { InfoExtractor, ExtractorError, UnsupportedError } from '../extractor.js';
import { sendRequest } from '../networking.js';
import { urlJoin, unescapeHTML, cleanHtml } from '../utils.js';

export class YoutubeIE extends InfoExtractor {
  constructor() { super('Youtube', /(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/); }

  _extractVideoId(url: string): string {
    const m = url.match(/(?:v=|\/embed\/|\/shorts\/|\/live\/|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : '';
  }

  async realExtract(url: string): Promise<any> {
    const videoId = this._extractVideoId(url);
    if (!videoId) throw new UnsupportedError(url);

    // Fetch video page to extract title and player context
    const page = await this._fetchPage(url, videoId);
    const title = this._extractTitle(page);

    // Fetch streaming data from innertube API
    const innertubeData = await this._fetchInnertubeData(videoId);
    const formats = innertubeData.formats;

    const info: any = {
      id: videoId,
      title: title || '',
      formats,
      extractor: 'youtube',
      extractor_key: 'Youtube',
      duration: 0,
      thumbnail: '',
      uploader: '',
      channel_id: '',
      upload_date: '',
    };

    // Use duration from innertube response (more reliable)
    if (innertubeData.videoDetails?.lengthSeconds) {
      info.duration = parseInt(innertubeData.videoDetails.lengthSeconds, 10);
    }
    if (innertubeData.videoDetails?.author) {
      info.uploader = innertubeData.videoDetails.author;
    }

    // Extract additional metadata from page
    const meta = this._extractPageMetadata(page);
    if (!info.duration && meta.duration) info.duration = meta.duration;
    if (!info.thumbnail && meta.thumbnail) info.thumbnail = meta.thumbnail;
    if (!info.uploader && meta.uploader) info.uploader = meta.uploader;

    return info;
  }

  async _fetchPage(url: string, videoId: string): Promise<string> {
    const resp = await sendRequest({
      url,
      headers: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeout: 30,
    });
    return resp.body;
  }

  _extractTitle(html: string): string {
    // Try <title> tag first
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    if (titleMatch) {
      const t = cleanHtml(titleMatch[1]);
      // YouTube page titles are "Video Title - YouTube"
      const dashIdx = t.lastIndexOf(' - YouTube');
      if (dashIdx > 0) return t.slice(0, dashIdx);
      return t;
    }
    // Try og:title meta tag
    const ogMatch = html.match(/property="og:title"\s+content="([^"]*)"/i);
    if (ogMatch) return unescapeHTML(ogMatch[1]);
    // Try title JSONLD
    const jsonldMatch = html.match(/"name":"([^"]*)"/);
    if (jsonldMatch) return unescapeHTML(jsonldMatch[1]);
    return '';
  }

  _extractPageMetadata(html: string): { duration: number; thumbnail: string; uploader: string } {
    const result: { duration: number; thumbnail: string; uploader: string } = { duration: 0, thumbnail: '', uploader: '' };

    // Duration from duration seconds meta
    const durMatch = html.match(/"duration":"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"/);
    if (durMatch) {
      const h = parseInt(durMatch[1] || '0', 10);
      const m = parseInt(durMatch[2] || '0', 10);
      const s = parseInt(durMatch[3] || '0', 10);
      result.duration = h * 3600 + m * 60 + s;
    }

    // Thumbnail from og:image
    const thumbMatch = html.match(/property="og:image"\s+content="([^"]*)"/i);
    if (thumbMatch) result.thumbnail = unescapeHTML(thumbMatch[1]);

    // Uploader from og:site_name or author
    const authorMatch = html.match(/property="og:site_name"\s+content="([^"]*)"/i);
    if (authorMatch) result.uploader = unescapeHTML(authorMatch[1]);

    return result;
  }

  async _fetchInnertubeData(videoId: string): Promise<any> {
    // Use the innertube API to get streaming data
    // ANDROID client is more reliable than WEB (WEB often returns UNPLAYABLE)
    const innertubeUrl = 'https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
    const body = {
      videoId,
      context: {
        client: {
          clientName: 'ANDROID',
          clientVersion: '20.10.38',
        },
      },
    };

    const resp = await sendRequest({
      url: innertubeUrl,
      method: 'POST',
      data: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      timeout: 30,
    });

    let data: any;
    try {
      data = JSON.parse(resp.body);
    } catch {
      throw new ExtractorError('Failed to parse innertube API response');
    }

    if (data.playabilityStatus?.status === 'UNPLAYABLE') {
      throw new ExtractorError('Video is unplayable: ' + (data.playabilityStatus.reason || 'unknown reason'));
    }
    if (data.playabilityStatus?.status === 'LOGIN_REQUIRED') {
      throw new ExtractorError('Video requires login');
    }
    if (data.playabilityStatus?.status !== 'OK') {
      throw new ExtractorError('Video cannot be played: ' + (data.playabilityStatus?.reason || data.playabilityStatus?.status));
    }

    const streamingData = data.streamingData || {};
    const formats: any[] = [];

    // Process regular formats (combined audio+video) — these have direct URLs
    for (const fmt of streamingData.formats || []) {
      formats.push(this._parseInnertubeFormat(fmt));
    }

    // Process adaptive formats (separate audio and video)
    for (const fmt of streamingData.adaptiveFormats || []) {
      formats.push(this._parseInnertubeFormat(fmt));
    }

    return { formats, videoDetails: data.videoDetails || {} };
  }

  _parseInnertubeFormat(fmt: any): any {
    const itag = fmt.itag || 0;
    const mime = fmt.mimeType || '';
    const ext = this._mimeToExt(mime);
    const mimeTypeBase = mime.split(';')[0].trim();
    const isAudioOnly = mimeTypeBase.startsWith('audio/');
    const isVideoOnly = mimeTypeBase.startsWith('video/') && !mime.includes('mp4a') && !mime.includes('opus') && !mime.includes('aac');

    let vcodec = 'none';
    let acodec = 'none';
    if (mime.includes('codecs=')) {
      const codecsMatch = mime.match(/codecs="([^"]*)"/);
      if (codecsMatch) {
        const codecs = codecsMatch[1].split(',').map((c: string) => c.trim());
        for (const c of codecs) {
          if (c.startsWith('vp') || c.startsWith('av0') || c.startsWith('h26') || c.startsWith('avc')) vcodec = c;
          else if (c.startsWith('mp4a') || c.startsWith('opus') || c.startsWith('mp3') || c.startsWith('aac') || c.startsWith('ec-') || c.startsWith('ac-')) acodec = c;
        }
      }
    }

    const f: any = {
      format_id: String(itag),
      ext,
      url: fmt.url || '',
      protocol: 'https',
      filesize: fmt.contentLength ? parseInt(fmt.contentLength, 10) : 0,
      tbr: fmt.bitrate ? parseInt(fmt.bitrate, 10) / 1000 : 0,
      vcodec: vcodec === 'none' ? 'none' : vcodec,
      acodec: acodec === 'none' ? 'none' : acodec,
      container: ext,
    };

    if (isAudioOnly) {
      f.vcodec = 'none';
      if (!f.acodec) f.acodec = 'mp4a.40.2';
      f.audio_channels = fmt.audioChannels || 2;
      const audioConfig = mime.match(/audioSampleRate=(\d+)/);
      if (audioConfig) f.asr = parseInt(audioConfig[1], 10);
    } else if (isVideoOnly) {
      if (!f.vcodec) f.vcodec = 'h264';
      f.acodec = 'none';
    } else {
      // Combined format (has both video and audio codecs)
      if (!f.vcodec) f.vcodec = 'h264';
      if (!f.acodec) f.acodec = 'mp4a.40.2';
    }

    // Quality info from quality label
    if (fmt.qualityLabel) {
      const ql = fmt.qualityLabel;
      const hMatch = ql.match(/(\d+)p/);
      if (hMatch) {
        f.height = parseInt(hMatch[1], 10);
        f.resolution = ql;
      }
      const fpsMatch = ql.match(/(\d+)fps/);
      if (fpsMatch) f.fps = parseInt(fpsMatch[1], 10);
    }

    // Width/height from width/height fields
    if (fmt.width) f.width = fmt.width;
    if (fmt.height) f.height = fmt.height;

    // Approx duration
    if (fmt.approxDurationMs) f.duration = fmt.approxDurationMs / 1000;

    return f;
  }

  _mimeToExt(mime: string): string {
    if (mime.includes('mp4')) return 'mp4';
    if (mime.includes('webm')) return 'webm';
    if (mime.includes('3gpp')) return '3gp';
    if (mime.includes('flv')) return 'flv';
    return 'mp4';
  }
}
