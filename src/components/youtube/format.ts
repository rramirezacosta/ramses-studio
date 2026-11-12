import { urlSplit } from './utils.js';

export function isVideo(f: any): boolean { return f?.vcodec && f.vcodec !== 'none'; }
export function isAudio(f: any): boolean { return f?.acodec && f.acodec !== 'none'; }

function qnum(f: any, key: string): number {
  const v = f?.[key]; if (typeof v === 'number') return v; if (typeof v === 'string') { const n = parseFloat(v); if (!isNaN(n)) return n; } return 0;
}
function qualityScore(f: any): number {
  let score = 0;
  score += qnum(f,'height')*100000;
  score += qnum(f,'width')*100;
  score += qnum(f,'tbr')*100;
  score += qnum(f,'filesize')/1e6;
  score += qnum(f,'fps')*10;
  score += qnum(f,'asr')/1000;
  score += qnum(f,'audio_channels')*5;
  if (isVideo(f) && isAudio(f)) score += 5000;
  if (typeof f?.source_preference === 'number') score += f.source_preference*1000;
  return score;
}
export function sortFormats(formats: any[]): any[] {
  return [...formats].sort((a,b) => qualityScore(a) - qualityScore(b));
}
function matchesFilter(f: any, filter: string): boolean {
  const m = filter.match(/^(\w+)\s*(<=|>=|!=|=|<|>)\s*(.+)$/);
  if (!m) return true;
  const [, key, op, val] = m;
  const v = f?.[key];
  const vs = (v === null || v === undefined) ? '' : String(v);
  const vn = parseFloat(val); const fn = parseFloat(vs);
  const bothNum = vs !== '' && !isNaN(fn) && !isNaN(vn);
  if (op === '=') return bothNum ? fn === vn : vs === val;
  if (op === '!=') return bothNum ? fn !== vn : vs !== val;
  if (bothNum) {
    if (op === '<') return fn < vn;
    if (op === '<=') return fn <= vn;
    if (op === '>') return fn > vn;
    if (op === '>=') return fn >= vn;
  }
  if (op === '<') return vs < val;
  if (op === '>') return vs > val;
  return true;
}
function splitFilter(s: string): string[] {
  const out: string[] = []; let cur = '';
  for (const c of s) {
    if (c === '[') cur = '';
    else if (c === ']') { if (cur) out.push(cur); cur = ''; }
    else cur += c;
  }
  return out;
}
function stripFilters(s: string): string { return s.replace(/\[[^\]]*\]/g, ''); }

export function selectFormats(info: any, spec: string): any[] {
  spec = spec || 'best';
  const formats: any[] = info?.formats || [];
  const sorted = sortFormats(formats);
  const parts = spec.split('+').map(s => s.trim()).filter(Boolean);
  const chosen: any[] = [];
  for (const part of parts) {
    const filters = splitFilter(part);
    const base = stripFilters(part).trim();
    const isWorst = /worst/i.test(base) || base === 'w' || base === 'wv' || base === 'wa';
    let video = base === 'best' || base === 'worst' || base === 'b' || base === 'w' || /v/.test(base);
    let audio = base === 'best' || base === 'worst' || base === 'b' || base === 'w' || /a/.test(base);
    if (base === 'bestvideo' || base === 'bv' || base === 'wv' || base === 'worstvideo') { video = true; audio = false; }
    if (base === 'bestaudio' || base === 'ba' || base === 'wa' || base === 'worstaudio') { video = false; audio = true; }
    if (base === 'best' || base === 'b' || base === 'worst' || base === 'w') { video = true; audio = true; }
    // literal format id
    const literal = formats.find(f => f?.format_id === base);
    if (literal) { chosen.push(literal); continue; }
    // ext guess
    if (!/best|worst|^[bw]v?$|^w[av]$/.test(base) && base.length <= 6 && !/\d/.test(base)) {
      filters.push('ext=' + base);
    }
    let pool = isWorst ? [...sorted].reverse() : sorted;
    let candidates = pool.filter(f => {
      if (video && !isVideo(f)) return false;
      if (audio && !isAudio(f)) return false;
      if (video && audio && (!isVideo(f) || !isAudio(f))) return false;
      if (video && !audio && isAudio(f) && !isVideo(f)) return false;
      return filters.every(fl => matchesFilter(f, fl));
    });
    if (candidates.length === 0) {
      candidates = pool.filter(f => {
        if (video && !isVideo(f)) return false;
        if (audio && !isAudio(f)) return false;
        if (video && audio && (!isVideo(f) || !isAudio(f))) return false;
        return true;
      });
    }
    if (candidates.length === 0) continue;
    chosen.push(candidates[candidates.length-1]);
  }
  if (chosen.length === 0 && sorted.length) chosen.push(sorted[sorted.length-1]);
  return chosen;
}
