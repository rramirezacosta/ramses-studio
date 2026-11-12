import { sendRequest } from './networking.js';

export class ExtractorError extends Error { constructor(msg: string){ super(msg); } }
export class UnsupportedError extends ExtractorError { constructor(url: string){ super('Unsupported URL: '+url); } }

export abstract class InfoExtractor {
  ieKey: string;
  validUrl: RegExp;
  constructor(name: string, validUrl: string | RegExp) {
    this.ieKey = name;
    this.validUrl = typeof validUrl === 'string' ? new RegExp(validUrl) : validUrl;
  }
  suitable(url: string): boolean { return this.validUrl.test(url); }
  matchId(url: string): string | null {
    const m = url.match(this.validUrl); if (!m) return null;
    for (let i = 1; i < m.length; i++) if (m[i]) return m[i];
    return m[0] || null;
  }
  abstract realExtract(url: string): Promise<any>;
  async downloadWebpage(url: string, videoId: string, headers: Record<string,string> = {}): Promise<ResponseLike> {
    return sendRequest({ url, headers });
  }
  async downloadJson(url: string, videoId: string, headers: Record<string,string> = {}, post?: any): Promise<any> {
    const r = await sendRequest({ url, headers, method: post ? 'POST' : 'GET', data: post ? JSON.stringify(post) : undefined });
    return JSON.parse(r.body);
  }
  reportWarning(msg: string) { console.error('WARNING: ' + msg); }
  toScreen(msg: string) { console.error(msg); }
}

export interface ResponseLike { status: number; url: string; headers: Record<string,string>; body: string; }
