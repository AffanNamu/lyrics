// Timeline UI: ruler, video / lyric / audio tracks, trimming, moving, reordering and scrubbing.
import { h, icon, clamp, fmtTime, round3 } from './util.js';
import { store, layout, duration, clipDur, MIN_DUR } from './store.js';

const PAD = 18;
export class Timeline {
  constructor(root, player) {
    this.root = root; this.player = player; this.pps = 60; this.fitted = false; this.drag = null;
    this.scroll = h('div.tl-scroll'); this.inner = h('div.tl-inner'); this.head = h('div.tl-playhead', null, h('i'));
    this.scroll.append(this.inner); root.append(this.scroll);
    this.scroll.addEventListener('pointerdown', e => this._down(e));
    this.scroll.addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX); } }, { passive: false });
    this.scroll.addEventListener('dblclick', e => { if (e.target.closest('[data-id]')) this.onEdit?.(); });
    window.addEventListener('pointermove', e => this._move(e));
    window.addEventListener('pointerup', e => this._up(e));
    window.addEventListener('pointercancel', e => this._up(e));
    new ResizeObserver(() => { if (!this.fitted) this.fit(); else this.render(); }).observe(this.scroll);
  }
  x(t) { return PAD + t * this.pps; }
  timeAt(clientX) { const r = this.scroll.getBoundingClientRect(); return (clientX - r.left + this.scroll.scrollLeft - PAD) / this.pps; }

  fit() {
    const d = Math.max(duration(store.project || { clips: [], audio: [], lyrics: [] }), 6), w = this.scroll.clientWidth;
    if (w > 0) { this.pps = clamp((w - PAD * 2 - 24) / d, 4, 400); this.fitted = true; }
    this.render();
  }
  zoom(f, clientX) {
    const r = this.scroll.getBoundingClientRect(), cx = clientX ?? r.left + r.width / 2, t = this.timeAt(cx);
    this.pps = clamp(this.pps * f, 4, 600); this.render();
    this.scroll.scrollLeft = this.x(t) - (cx - r.left);
  }

  render() {
    const p = store.project; if (!p) return;
    const dur = duration(p), L = layout(p), sel = store.sel, pps = this.pps;
    const width = Math.max(this.scroll.clientWidth, this.x(dur) + 160);
    const is = (type, id) => sel?.type === type && sel.id === id ? '.sel' : '';
    const ruler = h('div.tl-ruler');
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600], step = steps.find(s => s * pps >= 64) || 600;
    for (let t = 0; this.x(t) < width; t += step) {
      ruler.append(h('span.tick', { style: { left: this.x(t) + 'px' } }, step < 1 ? fmtTime(t) : fmtTime(t, false)));
    }
    const handles = () => [h('i.hdl.l', { dataset: { mode: 'l' } }), h('i.hdl.r', { dataset: { mode: 'r' } })];

    const vt = h('div.tl-track.video', { dataset: { track: 'video' } }, h('span.tl-label', null, icon('film', 13)));
    for (const e of L) {
      const m = store.media.get(e.clip.mediaId), w = (e.end - e.start) * pps;
      vt.append(h('div.tl-item.clip' + is('clip', e.clip.id), {
        dataset: { type: 'clip', id: e.clip.id }, title: m?.name || '',
        style: { left: this.x(e.start) + 'px', width: Math.max(4, w - 2) + 'px', backgroundImage: m?.thumb ? `url(${m.thumb})` : '' },
      }, h('span.tl-name', null, e.clip.transition.type !== 'none' && icon('sparkle', 11), e.clip.muted && icon('mute', 11),
        (e.clip.speed !== 1 ? e.clip.speed + '× · ' : '') + fmtTime(e.end - e.start)), handles()));
    }
    if (!L.length) vt.append(h('div.tl-empty', { style: { left: PAD + 'px' } }, 'Add videos or photos from the Media tab'));

    const lt = h('div.tl-track.lyrics', { dataset: { track: 'lyrics' } }, h('span.tl-label', null, icon('text', 13)));
    for (const l of p.lyrics) {
      lt.append(h('div.tl-item.lyric' + is('lyric', l.id), {
        dataset: { type: 'lyric', id: l.id }, title: l.text,
        style: { left: this.x(l.start) + 'px', width: Math.max(4, (l.end - l.start) * pps - 1) + 'px' },
      }, h('span.tl-name', null, l.text), handles()));
    }
    if (!p.lyrics.length) lt.append(h('div.tl-empty', { style: { left: PAD + 'px' } }, 'Lyrics appear here'));

    const at = h('div.tl-track.audio', { dataset: { track: 'audio' } }, h('span.tl-label', null, icon('music', 13)));
    for (const a of p.audio) {
      const m = store.media.get(a.mediaId), w = Math.max(4, (a.out - a.in) * pps - 1), cv = h('canvas.wave');
      at.append(h('div.tl-item.aud' + is('audio', a.id), { dataset: { type: 'audio', id: a.id }, title: m?.name || '', style: { left: this.x(a.start) + 'px', width: w + 'px' } },
        cv, h('span.tl-name', null, m?.name || 'Audio'), handles()));
      this._wave(cv, m, a, w);
    }
    if (!p.audio.length) at.append(h('div.tl-empty', { style: { left: PAD + 'px' } }, 'Add a song from the Media tab'));

    this.inner.style.width = width + 'px';
    this.inner.replaceChildren(ruler, vt, lt, at, this.head);
    this.setTime(this.player.time, false);
  }

  _wave(cv, m, a, w) {
    const cw = Math.min(3000, Math.round(w)), ch = 40; cv.width = cw; cv.height = ch;
    const g = cv.getContext('2d'), pk = m?.peaks; if (!pk?.length) return;
    g.fillStyle = 'rgba(255,255,255,.55)';
    for (let x = 0; x < cw; x += 3) {
      const i0 = Math.floor((a.in + (x / cw) * (a.out - a.in)) * 50), i1 = Math.max(i0 + 1, Math.floor((a.in + ((x + 3) / cw) * (a.out - a.in)) * 50));
      let mx = 0; for (let i = i0; i < i1 && i < pk.length; i++) if (pk[i] > mx) mx = pk[i];
      const hh = Math.max(1.5, mx / 255 * (ch - 6)); g.fillRect(x, (ch - hh) / 2, 2, hh);
    }
  }

  setTime(t, follow = true) {
    const x = this.x(t); this.head.style.transform = `translateX(${x}px)`;
    if (follow && this.player.playing && !this.drag) {
      const s = this.scroll, vx = x - s.scrollLeft;
      if (vx > s.clientWidth - 40 || vx < 0) s.scrollLeft = x - 60;
    }
  }

  _find(type, id) { const p = store.project; return (type === 'clip' ? p.clips : type === 'audio' ? p.audio : p.lyrics).find(x => x.id === id); }

  _down(e) {
    if (e.button > 0) return;
    const item = e.target.closest('.tl-item'), p = store.project; if (!p) return;
    if (!item) {
      // Ruler / empty space: scrub. (Touch on empty track space scrolls instead.)
      const onRuler = e.target.closest('.tl-ruler') || e.target.closest('.tl-playhead');
      if (e.pointerType === 'touch' && !onRuler) { this.tap = { x: e.clientX, y: e.clientY }; return; }
      this.drag = { kind: 'scrub' }; this.player.pause(); this.player.seek(this.timeAt(e.clientX));
      if (!onRuler && store.sel) store.select(null);
      e.preventDefault(); return;
    }
    const { type, id } = item.dataset, mode = e.target.dataset.mode || 'move', obj = this._find(type, id); if (!obj) return;
    const was = store.sel?.type === type && store.sel.id === id;
    if (e.pointerType === 'touch' && !was) { this.tap = { x: e.clientX, y: e.clientY, type, id }; return; }
    this.drag = { kind: 'item', type, id, mode, x0: e.clientX, orig: structuredClone(obj), moved: false, was };
    if (!was) store.select(type, id);
    e.preventDefault();
  }

  _move(e) {
    const d = this.drag; if (!d) return;
    if (d.kind === 'scrub') { this.player.seek(this.timeAt(e.clientX)); return; }
    const px = e.clientX - d.x0; if (!d.moved && Math.abs(px) < 5) return;
    d.moved = true; document.body.classList.add('dragging');
    const p = store.project, o = d.orig, obj = this._find(d.type, d.id), dt = px / this.pps; if (!obj) return;
    const m = store.media.get(o.mediaId);
    if (d.type === 'clip') {
      const img = o.kind === 'image', max = img ? 600 : (m?.duration ?? o.out);
      if (d.mode === 'l') { if (img) obj.out = round3(clamp(o.out - dt, MIN_DUR, 600)); else obj.in = round3(clamp(o.in + dt * o.speed, 0, o.out - MIN_DUR * o.speed)); }
      else if (d.mode === 'r') obj.out = round3(clamp(o.out + dt * o.speed, o.in + MIN_DUR * o.speed, max));
      else {
        const t = this.timeAt(e.clientX), L = layout(p), cur = L.findIndex(x => x.clip.id === d.id);
        let hit = L.findIndex(x => t >= x.start && t < x.end); if (hit < 0) hit = t < 0 ? 0 : L.length - 1;
        if (hit !== cur) { const mid = (L[hit].start + L[hit].end) / 2; if ((hit > cur && t > mid) || (hit < cur && t < mid)) store.moveClip(d.id, hit); }
      }
    } else if (d.type === 'lyric') {
      if (d.mode === 'l') obj.start = round3(clamp(o.start + dt, 0, o.end - MIN_DUR));
      else if (d.mode === 'r') obj.end = round3(Math.max(o.start + MIN_DUR, o.end + dt));
      else { obj.start = round3(Math.max(0, o.start + dt)); obj.end = round3(obj.start + (o.end - o.start)); }
    } else {
      const len = o.out - o.in;
      if (d.mode === 'l') { const k = clamp(dt, -Math.min(o.in, o.start), len - MIN_DUR); obj.in = round3(o.in + k); obj.start = round3(o.start + k); }
      else if (d.mode === 'r') obj.out = round3(clamp(o.out + dt, o.in + MIN_DUR, m?.duration ?? o.out));
      else obj.start = round3(Math.max(0, o.start + dt));
    }
    store.touch('timeline');
  }

  _up(e) {
    if (this.tap) {
      const tp = this.tap; this.tap = null;
      if (Math.hypot(e.clientX - tp.x, e.clientY - tp.y) < 8) {
        if (tp.type) store.select(tp.type, tp.id);
        else { this.player.pause(); this.player.seek(this.timeAt(e.clientX)); if (store.sel) store.select(null); }
      }
    }
    const d = this.drag; if (!d) return; this.drag = null; document.body.classList.remove('dragging');
    if (d.kind !== 'item') return;
    if (d.moved) { if (d.type === 'lyric') store.sortLyrics(); store.commit(); }
  }
}
export { clipDur };
