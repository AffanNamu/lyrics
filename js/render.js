// Compositor: draws one frame of a project at time t. Used identically by the live preview and the exporter.
import { clamp, easeInOut, rnd } from './util.js';
import { clipDur, layout, duration, cuesOf } from './store.js';
import { drawBackground } from './backgrounds.js';
import { drawLyrics, fontOf } from './lyricfx.js';

export const FILTERS = {
  none: ['Original', ''], vivid: ['Vivid', 'saturate(1.55) contrast(1.08)'], warm: ['Warm', 'sepia(.32) saturate(1.3)'],
  cool: ['Cool', 'hue-rotate(-14deg) saturate(1.12) brightness(1.03)'], fade: ['Faded', 'contrast(.84) brightness(1.1) saturate(.78)'],
  mono: ['Mono', 'grayscale(1)'], noir: ['Noir', 'grayscale(1) contrast(1.35) brightness(.9)'], dream: ['Dream', 'blur(2px) brightness(1.08) saturate(1.25)'],
};
export const TRANSITIONS = { none: 'Cut', fade: 'Crossfade', dip: 'Dip to black', slide: 'Slide', push: 'Push up', zoom: 'Zoom', wipe: 'Wipe' };

function filterString(f) {
  if (!f) return 'none';
  const parts = [FILTERS[f.preset]?.[1] || ''];
  if (f.brightness !== 1) parts.push(`brightness(${f.brightness})`);
  if (f.contrast !== 1) parts.push(`contrast(${f.contrast})`);
  if (f.saturate !== 1) parts.push(`saturate(${f.saturate})`);
  return parts.join(' ').trim() || 'none';
}

let grainTile;
function grain() {
  if (grainTile) return grainTile;
  grainTile = document.createElement('canvas'); grainTile.width = grainTile.height = 256;
  const g = grainTile.getContext('2d'), d = g.createImageData(256, 256);
  for (let i = 0; i < d.data.length; i += 4) { const v = rnd(i * 0.37) * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
  g.putImageData(d, 0, 0); return grainTile;
}

/** Amplitude 0..1 of the soundtrack at time t (drives reactive backgrounds). */
export function levelAt(project, media, t) {
  for (const a of project.audio) {
    const lt = t - a.start; if (lt < 0 || lt >= a.out - a.in) continue;
    const pk = media.get(a.mediaId)?.peaks; if (!pk?.length) continue;
    const i = Math.floor((a.in + lt) * 50); let s = 0, n = 0;
    for (let k = i - 2; k <= i + 2; k++) if (k >= 0 && k < pk.length) { s += pk[k]; n++; }
    return n ? clamp(s / n / 255 * 1.4, 0, 1) : 0;
  }
  return 0.35 + 0.2 * Math.sin(t * 2.4);
}

export class Renderer {
  constructor() { this.cur = { tag: null, cv: null }; this.prev = { tag: null, cv: null }; }
  _layer(slot, W, H) {
    if (!slot.cv) slot.cv = document.createElement('canvas');
    if (slot.cv.width !== W || slot.cv.height !== H) { slot.cv.width = W; slot.cv.height = H; slot.tag = null; }
    return slot.cv;
  }

  _drawClip(g, W, H, src, clip, p) {
    g.save(); g.translate(W / 2, H / 2); g.rotate((clip.rotate || 0) * Math.PI / 180); if (clip.flip) g.scale(-1, 1);
    const rot = (clip.rotate || 0) % 180 !== 0, bw = rot ? H : W, bh = rot ? W : H;
    let s = clip.fit === 'contain' ? Math.min(bw / src.w, bh / src.h) : Math.max(bw / src.w, bh / src.h), ox = 0, oy = 0;
    if (clip.motion) { const dir = clip.id.charCodeAt(0) % 2 ? 1 : -1; s *= 1.02 + 0.12 * p; ox = dir * bw * 0.025 * (p - .5); oy = -bh * 0.02 * (p - .5); }
    const fs = filterString(clip.filter); if (fs !== 'none') g.filter = fs;
    g.drawImage(src.img, -src.w * s / 2 + ox, -src.h * s / 2 + oy, src.w * s, src.h * s);
    g.restore();
  }

  /**
   * @param getSource (clip, sourceTime) => {img, w, h} | null  — current frame for a clip.
   * @param opts {media, level, lyrics:boolean}
   */
  render(ctx, W, H, project, t, getSource, opts = {}) {
    const S = Math.min(W, H) / 1080, dur = opts.dur ?? duration(project);
    const env = { W, H, t, S, dur, level: opts.level ?? 0.4 };
    const L = layout(project); let e = null;
    for (const x of L) if (t >= x.start && t < x.end) { e = x; break; }
    if (!e && L.length && t >= L[L.length - 1].end && t <= L[L.length - 1].end + 1e-3 && dur <= L[L.length - 1].end + 1e-3) e = L[L.length - 1];

    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.filter = 'none';
    const local = e ? clamp(t - e.start, 0, e.end - e.start) : 0, cd = e ? e.end - e.start : 0;
    const tr = e?.clip.transition, td = tr && tr.type !== 'none' ? Math.min(tr.dur, cd / 2) : 0, inTr = td > 0 && local < td;
    if (!e || e.clip.fit === 'contain' || inTr || (e.clip.rotate || 0) % 90 !== 0) drawBackground(ctx, env, project.background);

    if (e) {
      const clip = e.clip;
      if (this.cur.tag !== clip.id) { const o = this.prev; this.prev = this.cur; this.cur = o; this.cur.tag = clip.id; this._fresh = true; }
      const cv = this._layer(this.cur, W, H); this.cur.tag = clip.id;
      const src = getSource(clip, clip.in + local * clip.speed);
      if (src && src.w && src.h) {
        const g = cv.getContext('2d'); g.clearRect(0, 0, W, H);
        this._drawClip(g, W, H, src, clip, cd ? local / cd : 0); this._fresh = false;
      } else if (this._fresh) { cv.getContext('2d').clearRect(0, 0, W, H); }
      if (inTr) {
        const p = local / td, ep = easeInOut(p);
        const before = e.index > 0 && this.prev.tag === L[e.index - 1].clip.id && this.prev.cv?.width === W ? this.prev.cv : null;
        const old = (dx = 0, dy = 0) => { if (before) ctx.drawImage(before, dx, dy); else { ctx.fillStyle = '#000'; ctx.fillRect(dx, dy, W, H); } };
        switch (tr.type) {
          case 'fade': old(); ctx.globalAlpha = ep; ctx.drawImage(cv, 0, 0); break;
          case 'dip': if (p < .5) { old(); ctx.fillStyle = `rgba(0,0,0,${p * 2})`; ctx.fillRect(0, 0, W, H); } else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = (p - .5) * 2; ctx.drawImage(cv, 0, 0); } break;
          case 'slide': old(-W * ep, 0); ctx.drawImage(cv, W * (1 - ep), 0); break;
          case 'push': old(0, -H * ep); ctx.drawImage(cv, 0, H * (1 - ep)); break;
          case 'zoom': { old(); const s = 1.35 - 0.35 * ep; ctx.globalAlpha = ep; ctx.translate(W / 2, H / 2); ctx.scale(s, s); ctx.drawImage(cv, -W / 2, -H / 2); break; }
          case 'wipe': old(); ctx.beginPath(); ctx.rect(0, 0, W * ep, H); ctx.clip(); ctx.drawImage(cv, 0, 0); break;
          default: ctx.drawImage(cv, 0, 0);
        }
      } else ctx.drawImage(cv, 0, 0);
    }
    ctx.restore(); ctx.save();

    const ov = project.overlay || {};
    if (ov.vignette > 0) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${ov.vignette})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    if (ov.grain > 0) {
      const f = Math.floor(t * 24), ox = Math.floor(rnd(f) * 256), oy = Math.floor(rnd(f + .5) * 256);
      ctx.save(); ctx.globalAlpha = ov.grain * 0.35; ctx.globalCompositeOperation = 'overlay';
      const sc = Math.max(1, S * 2); ctx.scale(sc, sc); ctx.translate(-ox, -oy);
      ctx.fillStyle = ctx.createPattern(grain(), 'repeat'); ctx.fillRect(ox, oy, W / sc + 1, H / sc + 1); ctx.restore();
    }
    if (ov.letterbox) { const b = Math.round(H * 0.1); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, b); ctx.fillRect(0, H - b, W, b); }
    ctx.restore();

    if (opts.lyrics !== false && project.lyrics.length) {
      // Same resolver for preview and export: opts.cues lets template thumbnails pass sample cues.
      drawLyrics(ctx, env, opts.cues || cuesOf(project).cues, project.style);
    }

    ctx.save();
    if (ov.title || ov.artist) {
      const a = clamp(t / 0.8, 0, 1), y = H * (ov.letterbox ? 0.135 : 0.075), st = project.style;
      ctx.globalAlpha = a; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 10 * S;
      if (ov.title) { ctx.font = fontOf(st, 40 * S); ctx.fillStyle = '#fff'; ctx.fillText(ov.title, W / 2, y); }
      if (ov.artist) { ctx.font = fontOf({ ...st, weight: 400 }, 27 * S); ctx.fillStyle = 'rgba(255,255,255,.72)'; ctx.fillText(ov.artist, W / 2, y + 46 * S); }
    }
    if (ov.progress && dur > 0) {
      const hgt = Math.max(3, 7 * S), m = W * 0.08, y = H * (ov.letterbox ? 0.865 : 0.945), w = W - m * 2;
      ctx.shadowColor = 'transparent'; ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.beginPath(); ctx.roundRect(m, y, w, hgt, hgt / 2); ctx.fill();
      ctx.fillStyle = project.style.accent; ctx.beginPath(); ctx.roundRect(m, y, Math.max(hgt, w * clamp(t / dur, 0, 1)), hgt, hgt / 2); ctx.fill();
    }
    ctx.restore();
  }
}

export { clipDur };
