// Live preview engine: keeps hidden <video>/<audio> elements in sync with the timeline clock and paints the canvas.
import { clamp } from './util.js';
import { store, layout, duration } from './store.js';
import { Renderer, levelAt } from './render.js';
import { mediaUrl } from './media.js';

export class Player {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.renderer = new Renderer();
    this.time = 0; this.playing = false; this.dirty = true; this.onTime = () => {}; this.onState = () => {};
    this.videos = new Map(); this.images = new Map(); this.audios = new Map();
    this.last = 0; this.lastFix = 0; this.raf = 0; this.active = false;
    this._loop = this._loop.bind(this);
  }
  start() { if (!this.active) { this.active = true; this.last = performance.now(); this.raf = requestAnimationFrame(this._loop); } }
  stop() {
    this.active = false; cancelAnimationFrame(this.raf); this.pause();
    for (const v of this.videos.values()) { v.pause(); v.removeAttribute('src'); v.load(); }
    for (const a of this.audios.values()) { a.pause(); a.removeAttribute('src'); a.load(); }
    this.videos.clear(); this.images.clear(); this.audios.clear(); this.time = 0;
  }
  invalidate() { this.dirty = true; }
  get duration() { return store.project ? duration(store.project) : 0; }

  resize() {
    const p = store.project; if (!p) return;
    const s = 960 / Math.max(p.width, p.height), w = Math.round(p.width * s / 2) * 2, h = Math.round(p.height * s / 2) * 2;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.canvas.style.aspectRatio = `${p.width} / ${p.height}`; this.dirty = true;
  }

  play() {
    if (this.playing || this.duration <= 0) return;
    if (this.time >= this.duration - 0.03) this.time = 0;
    this.playing = true; this.last = performance.now(); this.onState(true);
  }
  pause() { if (!this.playing) return; this.playing = false; this._sync(); this.onState(false); this.dirty = true; }
  toggle() { this.playing ? this.pause() : this.play(); }
  seek(t) { this.time = clamp(t, 0, Math.max(0, this.duration)); this.dirty = true; this.lastFix = 0; this.onTime(this.time); }

  _video(id) {
    let v = this.videos.get(id);
    if (!v) {
      const m = store.media.get(id); if (!m) return null;
      v = document.createElement('video'); v.playsInline = true; v.preload = 'auto'; v.src = mediaUrl(m);
      const inval = () => this.invalidate();
      v.addEventListener('seeked', inval); v.addEventListener('loadeddata', inval); v.addEventListener('canplay', inval);
      this.videos.set(id, v);
    }
    return v;
  }
  _image(id) {
    let im = this.images.get(id);
    if (!im) { const m = store.media.get(id); if (!m) return null; im = new Image(); im.onload = () => this.invalidate(); im.src = mediaUrl(m); this.images.set(id, im); }
    return im;
  }
  getSource = (clip) => {
    if (clip.kind === 'image') { const im = this._image(clip.mediaId); return im?.complete && im.naturalWidth ? { img: im, w: im.naturalWidth, h: im.naturalHeight } : null; }
    const v = this._video(clip.mediaId);
    return v && v.readyState >= 2 && v.videoWidth ? { img: v, w: v.videoWidth, h: v.videoHeight } : null;
  };

  _sync() {
    const p = store.project; if (!p) return;
    const L = layout(p), t = this.time, e = L.find(x => t >= x.start && t < x.end), now = performance.now();
    const activeId = e && e.clip.kind === 'video' ? e.clip.mediaId : null;
    for (const [id, v] of this.videos) if (id !== activeId && !v.paused) v.pause();
    if (activeId) {
      const c = e.clip, v = this._video(activeId);
      if (v) {
        const want = clamp(c.in + (t - e.start) * c.speed, 0, Math.max(0, (v.duration || c.out) - 0.02));
        v.muted = !!c.muted; v.volume = clamp(c.volume, 0, 1); v.playbackRate = clamp(c.speed, 0.25, 4);
        const diff = Math.abs(v.currentTime - want);
        if (this.playing) {
          if (diff > 0.18 && now - this.lastFix > 700 && !v.seeking) { v.currentTime = want; this.lastFix = now; }
          if (v.paused) v.play().catch(() => {});
        } else {
          if (!v.paused) v.pause();
          if (diff > 0.012 && !v.seeking) v.currentTime = want;
        }
      }
      // Pre-roll the next clip so the cut is seamless.
      const nx = L[e.index + 1];
      if (this.playing && nx && nx.clip.kind === 'video' && nx.clip.mediaId !== activeId && e.end - t < 1.2) {
        const nv = this._video(nx.clip.mediaId);
        if (nv && nv.paused && !nv.seeking && Math.abs(nv.currentTime - nx.clip.in) > 0.05) nv.currentTime = nx.clip.in;
      }
    }
    const live = new Set();
    for (const a of p.audio) {
      live.add(a.id); let el = this.audios.get(a.id);
      const m = store.media.get(a.mediaId); if (!m) continue;
      if (!el) { el = new Audio(); el.preload = 'auto'; el.src = mediaUrl(m); this.audios.set(a.id, el); }
      const lt = t - a.start, len = a.out - a.in, on = lt >= 0 && lt < len;
      if (!on || !this.playing) { if (!el.paused) el.pause(); if (on && Math.abs(el.currentTime - (a.in + lt)) > 0.05 && !el.seeking) el.currentTime = a.in + lt; continue; }
      let vol = a.volume;
      if (a.fadeIn > 0) vol *= clamp(lt / a.fadeIn, 0, 1);
      if (a.fadeOut > 0) vol *= clamp((len - lt) / a.fadeOut, 0, 1);
      el.volume = clamp(vol, 0, 1);
      if (Math.abs(el.currentTime - (a.in + lt)) > 0.2 && !el.seeking) el.currentTime = a.in + lt;
      if (el.paused) el.play().catch(() => {});
    }
    for (const [id, el] of this.audios) if (!live.has(id)) { el.pause(); el.removeAttribute('src'); this.audios.delete(id); }
  }

  _loop(now) {
    if (!this.active) return;
    this.raf = requestAnimationFrame(this._loop);
    const p = store.project; if (!p) return;
    if (this.playing) {
      this.time += Math.min(0.1, (now - this.last) / 1000);
      if (this.time >= this.duration) { this.time = this.duration; this.playing = false; this.onState(false); }
      this.onTime(this.time); this.dirty = true;
    }
    this.last = now;
    if (!this.dirty) return;
    this.dirty = false;
    this._sync();
    this.draw();
  }
  draw() {
    const p = store.project; if (!p) return;
    this.renderer.render(this.ctx, this.canvas.width, this.canvas.height, p, this.time, this.getSource,
      { level: levelAt(p, store.media, this.time), dur: this.duration });
  }
  snapshot(max = 360) {
    const s = max / Math.max(this.canvas.width, this.canvas.height), c = document.createElement('canvas');
    c.width = Math.round(this.canvas.width * s); c.height = Math.round(this.canvas.height * s);
    try { c.getContext('2d').drawImage(this.canvas, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.7); } catch { return ''; }
  }
}
