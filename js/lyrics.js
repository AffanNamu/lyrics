// Lyric text <-> timed lines: plain text, .lrc and .srt import/export.
import { uid, round3 } from './util.js';

const stamp = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/** Parses pasted text / .lrc / .srt into [{id,text,start,end}]. Untimed text gets spread from `from` on. */
export function parseLyrics(text, from = 0, total = 0) {
  text = text.replace(/\r/g, '');
  if (/^\s*\d+\s*\n\s*\d\d:\d\d:\d\d[,.]\d+\s*-->/m.test(text)) return parseSrt(text);
  const timed = [], plain = [];
  for (const raw of text.split('\n')) {
    const stamps = [...raw.matchAll(stamp)];
    const body = raw.replace(stamp, '').replace(/^\[[a-z]+:.*\]$/i, '').trim();
    if (!body) continue;
    if (stamps.length) for (const m of stamps) timed.push({ text: body, start: +m[1] * 60 + +m[2] + (m[3] ? +('0.' + m[3]) : 0) });
    else plain.push(body);
  }
  if (timed.length) {
    timed.sort((a, b) => a.start - b.start);
    return timed.map((l, i) => ({ id: uid(), text: l.text, start: round3(l.start), end: round3(Math.min(l.start + 8, timed[i + 1]?.start ?? l.start + 4)) }));
  }
  const room = total - from;
  const each = plain.length && room / plain.length >= 1.2 ? Math.min(5, room / plain.length) : 3;
  return plain.map((t, i) => ({ id: uid(), text: t, start: round3(from + i * each), end: round3(from + (i + 1) * each) }));
}

function parseSrt(text) {
  const out = [], sec = s => { const [h, m, r] = s.replace(',', '.').split(':'); return +h * 3600 + +m * 60 + +r; };
  for (const block of text.split(/\n\s*\n/)) {
    const m = block.match(/(\d\d:\d\d:\d\d[,.]\d+)\s*-->\s*(\d\d:\d\d:\d\d[,.]\d+)\s*\n([\s\S]+)/);
    if (m) out.push({ id: uid(), text: m[3].replace(/<[^>]+>/g, '').replace(/\n/g, ' ').trim(), start: round3(sec(m[1])), end: round3(sec(m[2])) });
  }
  return out;
}

const two = n => String(n).padStart(2, '0');
export function toLrc(lines, title = '') {
  const head = title ? `[ti:${title}]\n` : '';
  return head + [...lines].sort((a, b) => a.start - b.start).map(l => {
    const m = Math.floor(l.start / 60), s = l.start - m * 60;
    return `[${two(m)}:${s.toFixed(2).padStart(5, '0')}]${l.text}`;
  }).join('\n') + '\n';
}
export function toSrt(lines) {
  const f = t => { const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = Math.floor(t % 60), ms = Math.round((t % 1) * 1000); return `${two(h)}:${two(m)}:${two(s)},${String(Math.min(999, ms)).padStart(3, '0')}`; };
  return [...lines].sort((a, b) => a.start - b.start).map((l, i) => `${i + 1}\n${f(l.start)} --> ${f(l.end)}\n${l.text}\n`).join('\n');
}
