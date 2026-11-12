import { urlSplit } from './utils.js';
import { request, Agent } from 'undici';

export interface Request { method?: string; url: string; headers?: Record<string,string>; data?: string; timeout?: number; ignoreHttpErrors?: boolean; }
export interface Response { status: number; url: string; headers: Record<string,string>; body: string; }
export class HttpError extends Error { status: number; response: Response; constructor(status: number, resp: Response){ super('HTTP Error '+status); this.status=status; this.response=resp; } }

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0';

// Configure undici agent to handle large headers (YouTube sends many Set-Cookie headers)
// undici defaults to 16KB max header size; YouTube responses often exceed this,
// causing HeadersOverflowError. Bump to 64KB to accommodate large cookie batches.
const agent = new Agent({
  headersTimeout: 30000,
  bodyTimeout: 30000,
  maxHeaderSize: 65536,
});

export async function sendRequest(req: Request): Promise<Response> {
  const headers: Record<string,string> = { 'User-Agent': DEFAULT_UA, 'Accept-Language': 'en-us,en;q=0.5', ... (req.headers||{}) };
  const t = req.timeout ? req.timeout * 1000 : 30000;
  const method = req.method || 'GET';
  const body = (method === 'POST' || req.data) ? req.data : undefined;

  const res = await request(req.url, {
    method,
    headers,
    body,
    dispatcher: agent,
    signal: req.timeout ? AbortSignal.timeout(t) : undefined,
  } as any);

  const bodyText = await res.body.text();
  const respHeaders: Record<string,string> = {};
  for (const [k, v] of Object.entries(res.headers)) {
    respHeaders[k] = (Array.isArray(v) ? v.join(', ') : String(v)) || '';
  }
  const resp: Response = { status: res.statusCode || 0, url: req.url, headers: respHeaders, body: bodyText };
  if (res.statusCode && res.statusCode >= 400 && !req.ignoreHttpErrors) throw new HttpError(res.statusCode, resp);
  return resp;
}

export async function httpGet(url: string): Promise<Response> { return sendRequest({ url }); }
export async function httpGetJson(url: string): Promise<any> { const r = await httpGet(url); return JSON.parse(r.body); }
