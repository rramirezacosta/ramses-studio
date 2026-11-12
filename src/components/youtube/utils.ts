// Transpiled subset of yt_dlp/utils/_utils.py
export function startsWith(s: string, p: string): boolean { return s.startsWith(p); }
export function removeStart(s: string, start: string): string { return s.startsWith(start) ? s.slice(start.length) : s; }
export function removeEnd(s: string, end: string): string { return s.endsWith(end) ? s.slice(0, s.length - end.length) : s; }
export function toLower(s: string): string { return s.toLowerCase(); }
export function stripWs(s: string): string { return s.trim(); }
export function unescapeHTML(s: string): string {
  return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#x27;/g,"'").replace(/&#39;/g,"'");
}
export function cleanHtml(html: string): string {
  return stripWs(unescapeHTML(html.replace(/<[^>]*>/g, '')));
}
export function percentEncode(s: string, safe = '-.~_'): string {
  let out = '';
  for (const c of s) {
    if (/[A-Za-z0-9]/.test(c) || safe.includes(c)) out += c;
    else {
      const code = c.charCodeAt(0);
      out += '%' + code.toString(16).toUpperCase().padStart(2,'0');
    }
  }
  return out;
}
export interface UrlParts { scheme: string; netloc: string; path: string; query: string; fragment: string; }
export function urlSplit(url: string): UrlParts {
  let fragment = '', query = '';
  let i = url.indexOf('#'); if (i >= 0) { fragment = url.slice(i+1); url = url.slice(0,i); }
  i = url.indexOf('?'); if (i >= 0) { query = url.slice(i+1); url = url.slice(0,i); }
  let scheme = '', netloc = '', path = url;
  const m = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
  if (m) { scheme = m[1]; path = url.slice(m[0].length); const slash = path.indexOf('/'); if (slash < 0) { netloc = path; path = '/'; } else { netloc = path.slice(0,slash); path = path.slice(slash); } }
  else if (url.startsWith('//')) { path = url.slice(2); const slash = path.indexOf('/'); if (slash < 0) { netloc = path; path = '/'; } else { netloc = path.slice(0,slash); path = path.slice(slash); } }
  return { scheme, netloc, path, query, fragment };
}
export function urlUnsplit(p: UrlParts): string {
  let out = p.scheme ? p.scheme + '://' : '';
  out += p.netloc + p.path;
  if (p.query) out += '?' + p.query;
  if (p.fragment) out += '#' + p.fragment;
  return out;
}
export function urlJoin(base: string, url: string): string {
  if (!url) return base;
  if (/^https?:\/\//.test(url)) return url;
  if (url.startsWith('//')) { const p = urlSplit(base); return (p.scheme ? p.scheme + ':' : '') + url; }
  if (url.startsWith('/')) { const bp = urlSplit(base); const up = urlSplit(url); bp.path = up.path; bp.query = up.query; bp.fragment = up.fragment; return urlUnsplit(bp); }
  const p = urlSplit(base);
  const pos = p.path.lastIndexOf('/');
  p.path = (pos >= 0 ? p.path.slice(0, pos+1) : '/') + url;
  return urlUnsplit(p);
}
export function parseQs(qs: string): Record<string,string> {
  const out: Record<string,string> = {};
  for (const pair of qs.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const k = decodeURIComponent((eq<0?pair:pair.slice(0,eq)).replace(/\+/g,' '));
    const v = eq<0 ? '' : decodeURIComponent(pair.slice(eq+1).replace(/\+/g,' '));
    out[k] = v;
  }
  return out;
}
export function updateUrlQuery(url: string, qs: Record<string,string>): string {
  const p = urlSplit(url);
  const cur = parseQs(p.query);
  for (const [k,v] of Object.entries(qs)) cur[k] = v;
  p.query = Object.entries(cur).map(([k,v]) => encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&');
  return urlUnsplit(p);
}
export function formatBytes(bytes: number): string {
  if (bytes < 0 || !isFinite(bytes)) return 'NA';
  const units = ['B','KiB','MiB','GiB','TiB','PiB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length-1) { bytes /= 1024; i++; }
  return (Number.isInteger(bytes) ? bytes : bytes.toFixed(2)) + units[i];
}
export function toFloat(j: any): number | null {
  if (typeof j === 'number') return j;
  if (typeof j === 'string') { const n = parseFloat(j.trim()); if (!isNaN(n)) return n; }
  return null;
}
export function toInt(j: any): number | null {
  if (typeof j === 'number') return Math.round(j);
  const f = toFloat(j); return f === null ? null : Math.round(f);
}
export function strToInt(s: string): number | null {
  const t = s.replace(/\D/g,''); if (!t) return null; return parseInt(t,10);
}
export function parseDuration(s: any): number | null {
  if (typeof s === 'number') return s;
  if (typeof s !== 'string') return null;
  const str = s.trim();
  if (/^\d+(\.\d+)?$/.test(str)) return parseFloat(str);
  const colon = str.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
  if (colon) return parseInt(colon[1])*3600 + parseInt(colon[2])*60 + parseFloat(colon[3]);
  const colon2 = str.match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (colon2) return parseInt(colon2[1])*60 + parseFloat(colon2[2]);
  let secs = 0;
  for (const m of str.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)/gi)) {
    const v = parseFloat(m[1]); const u = m[2].toLowerCase();
    if (u.startsWith('h')) secs += v*3600;
    else if (u.startsWith('m')) secs += v*60;
    else secs += v;
  }
  return secs > 0 ? secs : null;
}
export function iso8601ToUnix(dateStr: string): number {
  const d = new Date(dateStr); if (isNaN(d.getTime())) return -1; return Math.floor(d.getTime()/1000);
}
export function strftimeFromUnix(ts: number, fmt = '%Y%m%d'): string {
  const d = new Date(ts*1000);
  const pad = (n:number) => String(n).padStart(2,'0');
  return fmt.replace('%Y', String(d.getUTCFullYear()))
    .replace('%m', pad(d.getUTCMonth()+1)).replace('%d', pad(d.getUTCDate()))
    .replace('%H', pad(d.getUTCHours())).replace('%M', pad(d.getUTCMinutes()))
    .replace('%S', pad(d.getUTCSeconds()));
}
export function traverse(obj: any, path: (string|number)[]): any {
  let cur = obj;
  for (const seg of path) {
    if (cur === null || cur === undefined) return null;
    if (Array.isArray(cur)) {
      const idx = typeof seg === 'number' ? seg : parseInt(String(seg),10);
      if (isNaN(idx) || idx < 0 || idx >= cur.length) return null;
      cur = cur[idx];
    } else if (typeof cur === 'object') {
      if (!(seg in cur)) return null;
      cur = cur[seg];
    } else return null;
  }
  return cur;
}
export function getFirst(obj: any, paths: (string|number)[][]): any {
  for (const p of paths) { const v = traverse(obj, p as any); if (v !== null && v !== undefined) return v; }
  return null;
}
export function mimetype2ext(m: string): string | null {
  const sub = m.toLowerCase().split('/')[1]?.split(';')[0]?.trim();
  const map: Record<string,string> = { mp4:'mp4', m4v:'mp4', webm:'webm', 'x-mpegurl':'m3u8', 'vnd.apple.mpegurl':'m3u8', 'mpegurl':'m3u8', 'dash+xml':'mpd' };
  if (!sub) return null;
  return map[sub] ?? sub;
}
export function sanitizeFilenamePart(value: string): string {
  if (!value) return '';
  let out = '';
  let lastSpace = false;
  for (const ch of value) {
    if (/[<>:"/\\|?*]/.test(ch) || ch.charCodeAt(0) < 32) { out += '_'; lastSpace = false; }
    else if (/\s/.test(ch)) { if (!lastSpace && out) out += ' '; lastSpace = true; }
    else { out += ch; lastSpace = false; }
  }
  while (out.endsWith('.') || out.endsWith(' ')) out = out.slice(0,-1);
  return out;
}

export function expandTemplate(tmpl: string, info: any, ext: string): string {
  return tmpl.replace(/%\(([^)]+)\)([sdif])/g, (_, field) => {
    let val = '';
    if (field === 'ext') val = ext;
    else if (info && info[field] !== undefined && info[field] !== null) val = String(info[field]);
    if (field === 'title' || field === 'uploader' || field === 'id') val = sanitizeFilenamePart(val);
    return val;
  });
}

export function shellQuote(s: string): string { return "'" + s.replace(/'/g, "'\\''") + "'"; }
export function dumpJson(j: any, pretty = false): string {
  return pretty ? JSON.stringify(j, null, 2) : JSON.stringify(j);
}
