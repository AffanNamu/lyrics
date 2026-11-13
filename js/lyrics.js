// Lyric text <-> timed lines (milliseconds, docs/SYNC_SPEC.md §7). Plain text stays unsynced — it is never
// spread over the song, so lyrics cannot appear during an instrumental intro by accident.
import { uid } from './util.js';
import { isSynced } from './sync.js';

const STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const fracMs = f => (f ? Math.round(Number('0.' + f) * 1000) : 0);

/** Parses pasted text, .lrc or .srt into [{id,text,startMs,endMs}]. */
export function parseLyrics(text) {
  text = String(text || '').replace(/\r/g, '');
  if (/^\s*\d+\s*\n\s*\d\d:\d\d:\d\d[,.]\d+\s*-->/m.test(text)) return parseSrt(text);
  let offset = 0;
  const off = text.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/im); if (off) offset = parseInt(off[1], 10);
  const out = []; let stamped = 0, plain = 0;
  for (const raw of text.split('\n')) {
    const stamps = [...raw.matchAll(STAMP)];
    const body = raw.replace(STAMP, '').trim();
    if (/^\[[a-z]+:.*\]$/i.test(raw.trim())) continue;   // [ti:], [ar:], [offset:] …
    if (!body) continue;
    if (stamps.length) for (const m of stamps) {
      out.push({ id: uid(), text: body, startMs: Math.max(0, +m[1] * 60000 + +m[2] * 1000 + fracMs(m[3]) - offset), endMs: null }); stamped++;
    } else { out.push({ id: uid(), text: body, startMs: null, endMs: null }); plain++; }
  }
  if (stamped && !plain) out.sort((a, b) => a.startMs - b.startMs);
  return out;
}

function parseSrt(text) {
  const out = [], ms = s => { const [h, m, r] = s.replace(',', '.').split(':'); const [sec, f] = r.split('.'); return +h * 3600000 + +m * 60000 + +sec * 1000 + fracMs(f); };
  for (const block of text.split(/\n\s*\n/)) {
    const m = block.match(/(\d\d:\d\d:\d\d[,.]\d+)\s*-->\s*(\d\d:\d\d:\d\d[,.]\d+)[^\n]*\n([\s\S]+)/);
    if (m) {
      const startMs = ms(m[1]), endMs = ms(m[2]);
      out.push({ id: uid(), text: m[3].replace(/<[^>]+>/g, '').replace(/\n/g, ' ').trim(), startMs, endMs: endMs > startMs ? endMs : null });
    }
  }
  return out;
}

const two = n => String(n).padStart(2, '0');
/** LRC: synced lines get their stamp; unsynced lines are written without one (never given a fake time). */
export function toLrc(lines, title = '') {
  const head = title ? `[ti:${title}]\n` : '';
  return head + lines.filter(l => l.text.trim()).map(l => {
    if (!isSynced(l)) return l.text;
    const m = Math.floor(l.startMs / 60000), cs = Math.round((l.startMs % 60000) / 10);
    return `[${two(m)}:${two(Math.floor(cs / 100))}.${two(cs % 100)}]${l.text}`;
  }).join('\n') + '\n';
}
/** SRT from resolved cues, so the file matches what the video shows. */
export function toSrt(cues) {
  const f = t => `${two(Math.floor(t / 3600000))}:${two(Math.floor(t % 3600000 / 60000))}:${two(Math.floor(t % 60000 / 1000))},${String(t % 1000).padStart(3, '0')}`;
  return cues.map((c, i) => `${i + 1}\n${f(c.startMs)} --> ${f(c.endMs)}\n${c.text}\n`).join('\n');
}
