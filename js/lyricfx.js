// Animated lyric styles drawn on canvas. All are pure functions of time.
import { clamp, easeOut, easeBack, rnd } from './util.js';
import { rgba, mix } from './backgrounds.js';
import { activeCue } from './sync.js';

export const FONTS = {
  Poppins: { weights: [600, 800], stack: '"Poppins", system-ui, sans-serif' },
  Inter: { weights: [400, 600], stack: '"Inter", system-ui, sans-serif' },
  Anton: { weights: [400], stack: '"Anton", Impact, sans-serif' },
  'Bebas Neue': { weights: [400], stack: '"Bebas Neue", Impact, sans-serif' },
  'Space Grotesk': { weights: [500, 700], stack: '"Space Grotesk", system-ui, sans-serif' },
  'Playfair Display': { weights: [700], stack: '"Playfair Display", Georgia, serif' },
  Pacifico: { weights: [400], stack: '"Pacifico", cursive' },
};
export function fontOf(style, px) {
  const f = FONTS[style.font] || FONTS.Poppins;
  const w = f.weights.includes(style.weight) ? style.weight : f.weights[f.weights.length - 1];
  return `${w} ${Math.round(px)}px ${f.stack}`;
}

const cache = new Map();
/** Word-wraps text. Returns {rows:[{words:[{t,x,w,i,a,b}],w}], lineH, count} with a/b = share of line time per word. */
function layoutText(ctx, text, font, maxW, tracking = 0) {
  const key = text + '|' + font + '|' + Math.round(maxW) + '|' + tracking;
  let L = cache.get(key); if (L) return L;
  ctx.font = font; if ('letterSpacing' in ctx) ctx.letterSpacing = tracking + 'px';
  const px = parseFloat(font.match(/(\d+)px/)[1]), space = ctx.measureText(' ').width;
  const tokens = text.split(/\s+/).filter(Boolean), rows = []; let row = { words: [], w: 0 };
  const total = tokens.reduce((s, w) => s + w.length + 1, 0) || 1; let acc = 0;
  tokens.forEach((t, i) => {
    const w = ctx.measureText(t).width;
    if (row.words.length && row.w + space + w > maxW) { rows.push(row); row = { words: [], w: 0 }; }
    const x = row.words.length ? row.w + space : 0;
    row.words.push({ t, x, w, i, a: acc / total, b: (acc + t.length + 1) / total }); row.w = x + w; acc += t.length + 1;
  });
  if (row.words.length) rows.push(row);
  L = { rows, lineH: px * 1.22, count: tokens.length, px };
  if (cache.size > 600) cache.clear();
  cache.set(key, L); return L;
}

/** Iterates words with absolute positions for a block centred on (cx, cy). */
function eachWord(L, cx, cy, fn) {
  const y0 = cy - (L.rows.length - 1) * L.lineH / 2;
  L.rows.forEach((r, ri) => { const x0 = cx - r.w / 2; for (const w of r.words) fn(w, x0 + w.x, y0 + ri * L.lineH, r, ri); });
}
function shadow(ctx, S, on = true) {
  ctx.shadowColor = on ? 'rgba(0,0,0,.55)' : 'transparent'; ctx.shadowBlur = on ? 14 * S : 0; ctx.shadowOffsetY = on ? 3 * S : 0; ctx.shadowOffsetX = 0;
}
const contrast = hex => { const n = parseInt(hex.slice(1), 16); return ((n >> 16 & 255) * .299 + (n >> 8 & 255) * .587 + (n & 255) * .114) > 150 ? '#0b0c10' : '#ffffff'; };

// Each style: draw(ctx, k) where k = {L, cx, cy, lt, d, p, wp, aIn, aOut, S, t, st, px, W, H}
const FX = {
  fade: { name: 'Clean fade', draw(ctx, k) {
    ctx.globalAlpha = k.aIn * k.aOut; shadow(ctx, k.S); ctx.fillStyle = k.st.color;
    const dy = (1 - k.aIn) * 34 * k.S;
    eachWord(k.L, k.cx, k.cy, (w, x, y) => ctx.fillText(w.t, x, y + dy));
  } },

  karaoke: { name: 'Karaoke fill', draw(ctx, k) {
    const sc = 0.94 + 0.06 * k.aIn; ctx.translate(k.cx, k.cy); ctx.scale(sc, sc); ctx.translate(-k.cx, -k.cy);
    ctx.globalAlpha = k.aIn * k.aOut; shadow(ctx, k.S);
    eachWord(k.L, k.cx, k.cy, (w, x, y) => {
      const f = clamp((k.wp - w.a) / (w.b - w.a), 0, 1);
      ctx.fillStyle = rgba(k.st.color, .5); ctx.fillText(w.t, x, y);
      if (f <= 0) return;
      ctx.save(); ctx.beginPath(); ctx.rect(x - 4, y - k.L.lineH / 2, (w.w + 8) * f, k.L.lineH); ctx.clip();
      ctx.fillStyle = k.st.accent; ctx.fillText(w.t, x, y); ctx.restore();
    });
  } },

  pop: { name: 'Pop bounce', draw(ctx, k) {
    ctx.globalAlpha = k.aOut; shadow(ctx, k.S);
    eachWord(k.L, k.cx, k.cy, (w, x, y) => {
      const local = k.lt - w.a * k.d * 0.92; if (local < 0) return;
      const s = easeBack(local / 0.3), cur = k.wp >= w.a && k.wp < w.b;
      ctx.save(); ctx.globalAlpha = k.aOut * clamp(local / 0.08, 0, 1);
      ctx.translate(x + w.w / 2, y); ctx.scale(s, s); ctx.rotate((1 - Math.min(1, local / 0.3)) * (w.i % 2 ? .12 : -.12));
      ctx.fillStyle = cur ? k.st.accent : k.st.color; ctx.fillText(w.t, -w.w / 2, 0); ctx.restore();
    });
  } },

  typewriter: { name: 'Typewriter', draw(ctx, k) {
    ctx.globalAlpha = k.aOut; shadow(ctx, k.S);
    const chars = k.L.rows.reduce((s, r) => s + r.words.reduce((a, w) => a + w.t.length, 0), 0);
    let left = Math.floor(clamp(k.lt / Math.min(k.d * 0.7, chars / 20), 0, 1) * chars), cx = 0, cy = 0, any = false;
    eachWord(k.L, k.cx, k.cy, (w, x, y) => {
      if (left <= 0) { if (!any) { cx = x; cy = y; any = true; } return; }
      const sub = w.t.slice(0, left); left -= w.t.length; any = true;
      ctx.fillStyle = k.st.color; ctx.fillText(sub, x, y);
      cx = x + ctx.measureText(sub).width; cy = y;
    });
    if (Math.floor(k.t * 2.6) % 2 === 0) { shadow(ctx, k.S, false); ctx.fillStyle = k.st.accent; ctx.fillRect(cx + k.px * .08, cy - k.px * .48, k.px * .09, k.px * .96); }
  } },

  neon: { name: 'Neon glow', draw(ctx, k) {
    const fl = k.lt < 0.45 ? (rnd(Math.floor(k.t * 28)) > 0.38 ? 1 : 0.25) : 0.93 + 0.07 * Math.sin(k.t * 37);
    ctx.globalAlpha = fl * k.aOut; ctx.shadowOffsetY = 0;
    eachWord(k.L, k.cx, k.cy, (w, x, y) => {
      ctx.shadowColor = k.st.accent; ctx.shadowBlur = 42 * k.S; ctx.fillStyle = k.st.accent; ctx.fillText(w.t, x, y);
      ctx.shadowBlur = 12 * k.S; ctx.fillStyle = mix(k.st.accent, '#ffffff', .82); ctx.fillText(w.t, x, y);
    });
  } },

  kinetic: { name: 'Kinetic words', own: true, draw(ctx, k) {
    const words = k.text.split(/\s+/).filter(Boolean); if (!words.length) return;
    const total = words.reduce((s, w) => s + w.length + 1, 0); let acc = 0, idx = words.length - 1, a = 0;
    for (let i = 0; i < words.length; i++) { const b = acc + words[i].length + 1; if (k.wp * total < b) { idx = i; a = acc / total; break; } acc = b; }
    let px = k.px * 2.1; ctx.font = fontOf(k.st, px);
    const mw = ctx.measureText(words[idx]).width, max = k.W * 0.86;
    if (mw > max) { px *= max / mw; ctx.font = fontOf(k.st, px); }
    const local = k.lt - a * k.d * 0.92, s = 1 + 0.4 * (1 - easeOut(local / 0.16));
    ctx.globalAlpha = k.aOut * clamp(local / 0.05, 0, 1); shadow(ctx, k.S);
    ctx.translate(k.cx, k.cy); ctx.scale(s, s); ctx.textAlign = 'center';
    ctx.fillStyle = idx % 2 ? k.st.accent : k.st.color; ctx.fillText(words[idx], 0, 0);
  } },

  boxed: { name: 'Caption box', draw(ctx, k) {
    const dy = (1 - easeOut(k.lt / 0.32)) * 70 * k.S; ctx.globalAlpha = k.aIn * k.aOut;
    const y0 = k.cy - (k.L.rows.length - 1) * k.L.lineH / 2, padX = k.px * .42, bh = k.L.lineH * 0.98;
    ctx.fillStyle = k.st.accent; ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 18 * k.S; ctx.shadowOffsetY = 6 * k.S;
    k.L.rows.forEach((r, i) => { ctx.beginPath(); ctx.roundRect(k.cx - r.w / 2 - padX, y0 + i * k.L.lineH - bh / 2 + dy, r.w + padX * 2, bh, k.px * .22); ctx.fill(); });
    shadow(ctx, k.S, false); ctx.fillStyle = contrast(k.st.accent);
    eachWord(k.L, k.cx, k.cy, (w, x, y) => ctx.fillText(w.t, x, y + dy));
  } },

  highlight: { name: 'Word highlight', draw(ctx, k) {
    ctx.globalAlpha = k.aIn * k.aOut;
    eachWord(k.L, k.cx, k.cy, (w, x, y) => {
      const cur = k.wp >= w.a && k.wp < w.b;
      if (cur) {
        const g = easeOut((k.wp - w.a) / (w.b - w.a) * 3), pad = k.px * .16;
        shadow(ctx, k.S, false); ctx.fillStyle = k.st.accent;
        ctx.beginPath(); ctx.roundRect(x - pad, y - k.px * .58, (w.w + pad * 2) * (0.6 + 0.4 * g), k.px * 1.16, k.px * .2); ctx.fill();
        ctx.fillStyle = contrast(k.st.accent); ctx.fillText(w.t, x, y);
      } else { shadow(ctx, k.S); ctx.fillStyle = k.st.color; ctx.fillText(w.t, x, y); }
    });
  } },

  glitch: { name: 'Glitch', draw(ctx, k) {
    const burst = k.lt < 0.38 || (k.t % 2.3) < 0.1, off = burst ? (rnd(Math.floor(k.t * 24)) - .5) * 30 * k.S : 2.5 * k.S;
    ctx.globalAlpha = k.aOut * (burst && rnd(Math.floor(k.t * 30) + 9) > .8 ? .4 : 1);
    const pass = (dx, dy, col) => { ctx.fillStyle = col; eachWord(k.L, k.cx, k.cy, (w, x, y) => ctx.fillText(w.t, x + dx, y + dy)); };
    ctx.globalCompositeOperation = 'lighter';
    pass(-off, 0, rgba(k.st.accent, .85)); pass(off, burst ? off * .3 : 0, 'rgba(255,40,90,.85)');
    ctx.globalCompositeOperation = 'source-over'; shadow(ctx, k.S); pass(0, 0, k.st.color);
  } },

  wave: { name: 'Wave', draw(ctx, k) {
    shadow(ctx, k.S); let ci = 0;
    eachWord(k.L, k.cx, k.cy, (w, x, y) => {
      let cx = x;
      for (const ch of w.t) {
        const a = clamp((k.lt - ci * 0.025) / 0.25, 0, 1);
        ctx.globalAlpha = a * k.aOut; ctx.fillStyle = mix(k.st.color, k.st.accent, 0.5 + 0.5 * Math.sin(k.t * 2 + ci * .35));
        ctx.fillText(ch, cx, y + Math.sin(k.t * 3.6 + ci * 0.55) * k.px * 0.16 + (1 - a) * k.px * .5);
        cx += ctx.measureText(ch).width; ci++;
      }
      ci++;
    });
  } },

  cinematic: { name: 'Cinematic', upper: true, tracking: 0.2, scale: 0.72, draw(ctx, k) {
    const a = clamp(k.lt / 0.8, 0, 1) * k.aOut, sc = 1 + 0.045 * k.p;
    ctx.translate(k.cx, k.cy); ctx.scale(sc, sc); ctx.translate(-k.cx, -k.cy);
    ctx.globalAlpha = a; shadow(ctx, k.S); ctx.fillStyle = k.st.color;
    eachWord(k.L, k.cx, k.cy, (w, x, y) => ctx.fillText(w.t, x, y));
    const top = k.cy - k.L.rows.length * k.L.lineH / 2 - k.px * .35, lw = k.W * 0.12 * easeOut(k.lt / 1.1);
    shadow(ctx, k.S, false); ctx.fillStyle = k.st.accent; ctx.fillRect(k.cx - lw / 2, top, lw, Math.max(2, 4 * k.S));
  } },

  scroll: { name: 'Scrolling list', list: true },
};
export const LYRIC_FX = FX;

function drawScroll(ctx, env, lines, st) {
  const { W, H, t, S } = env; if (!lines.length) return;
  let cur = -1; for (let i = 0; i < lines.length; i++) if (lines[i].startMs <= t * 1000) cur = i;
  if (cur < 0) return;   // nothing before the first lyric — never show the list during an intro
  const px = st.size * S * 0.8, font = fontOf(st, px), maxW = W * 0.8, gap = px * 0.55, x0 = W * 0.1;
  const lay = i => layoutText(ctx, st.upper ? lines[i].text.toUpperCase() : lines[i].text, font, maxW);
  const hgt = i => lay(i).rows.length * lay(i).lineH + gap;
  const c = Math.max(cur, 0), e = cur < 0 ? 1 : easeOut((t - lines[c].startMs / 1000) / 0.4);
  const shift = c > 0 ? (1 - e) * (hgt(c - 1) / 2 + hgt(c) / 2) : (cur < 0 ? 0 : 0);
  ctx.font = font; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  const cy = st.posY * H;
  const drawLine = (i, yc) => {
    const L = lay(i), active = i === cur && t * 1000 < lines[i].endMs, fade = clamp(1.15 - Math.abs(yc - cy) / (H * 0.4), 0, 1);
    if (fade <= 0) return;
    ctx.globalAlpha = fade * (active ? 1 : i < cur ? 0.26 : 0.4); shadow(ctx, S, active);
    ctx.fillStyle = active ? st.accent : st.color;
    const y0 = yc - (L.rows.length - 1) * L.lineH / 2;
    L.rows.forEach((r, ri) => { for (const w of r.words) ctx.fillText(w.t, x0 + w.x, y0 + ri * L.lineH); });
  };
  let y = cy + shift; drawLine(c, y);
  for (let i = c + 1, yy = y; i < lines.length && i < c + 7; i++) { yy += hgt(i - 1) / 2 + hgt(i) / 2; if (yy > H * 1.1) break; drawLine(i, yy); }
  for (let i = c - 1, yy = y; i >= 0 && i > c - 7; i--) { yy -= hgt(i + 1) / 2 + hgt(i) / 2; if (yy < -H * .1) break; drawLine(i, yy); }
}

/** Draws the lyric layer. `lines` are resolved cues (js/sync.js resolveCues): sorted, non-overlapping, in ms. */
export function drawLyrics(ctx, env, lines, st) {
  const fx = FX[st.fx] || FX.fade, { W, H, t, S } = env;
  ctx.save();
  if (fx.list) { drawScroll(ctx, env, lines, st); ctx.restore(); return; }
  const line = activeCue(lines, t * 1000);
  if (!line || !line.text.trim()) { ctx.restore(); return; }
  const px = st.size * S * (fx.scale || 1), font = fontOf(st, px), text = (st.upper || fx.upper) ? line.text.toUpperCase() : line.text;
  const tracking = fx.tracking ? Math.round(px * fx.tracking) : 0;
  const L = fx.own ? null : layoutText(ctx, text, font, W * 0.84, tracking);
  ctx.font = font; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; if ('letterSpacing' in ctx) ctx.letterSpacing = tracking + 'px';
  const lt = t - line.startMs / 1000, d = Math.max(0.05, (line.endMs - line.startMs) / 1000);
  fx.draw(ctx, {
    L, text, cx: W / 2, cy: st.posY * H, lt, d, p: lt / d, wp: clamp(lt / (d * 0.92), 0, 1),
    aIn: easeOut(lt / 0.3), aOut: clamp((line.endMs / 1000 - t) / 0.22, 0, 1), S, t, st, px, W, H,
  });
  ctx.restore();
}
