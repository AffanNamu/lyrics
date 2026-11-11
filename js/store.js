// Project model + editing operations + undo history. The project is plain JSON; media blobs live in IndexedDB.
import { uid, clamp, round3 } from './util.js';

export const ASPECTS = {
  '9:16': [1080, 1920, 'Vertical'], '16:9': [1920, 1080, 'Wide'],
  '1:1': [1080, 1080, 'Square'], '4:5': [1080, 1350, 'Portrait'],
};
export const MIN_DUR = 0.2;

export function newProject(name, aspect = '9:16') {
  const [width, height] = ASPECTS[aspect];
  return {
    id: uid(), name: name || 'Untitled video', createdAt: Date.now(), updatedAt: Date.now(),
    aspect, width, height, template: 'aurora-karaoke',
    background: { type: 'aurora', colors: ['#7c5cff', '#22d3ee', '#f472b6'] },
    style: { fx: 'karaoke', font: 'Poppins', weight: 800, size: 78, color: '#ffffff', accent: '#c6f24e', posY: 0.5, upper: false },
    overlay: { vignette: 0.35, grain: 0, letterbox: false, progress: true, title: '', artist: '' },
    clips: [], audio: [], lyrics: [],
  };
}

export const clipDur = c => (c.out - c.in) / (c.speed || 1);

/** Lays the video clips end-to-end and returns [{clip, start, end, index}]. */
export function layout(project) {
  let t = 0;
  return project.clips.map((clip, index) => { const start = t; t += clipDur(clip); return { clip, start, end: t, index }; });
}
export function videoEnd(p) { return p.clips.reduce((s, c) => s + clipDur(c), 0); }
export function duration(p) {
  let d = videoEnd(p);
  for (const a of p.audio) d = Math.max(d, a.start + (a.out - a.in));
  if (!p.clips.length && !p.audio.length) for (const l of p.lyrics) d = Math.max(d, l.end);
  return d;
}
export function clipAt(p, t) {
  const L = layout(p);
  for (const e of L) if (t >= e.start && t < e.end) return e;
  return null;
}

class Store {
  constructor() {
    this.project = null; this.media = new Map(); this.sel = null;
    this.listeners = new Set(); this.undoStack = []; this.redoStack = []; this.snapshot = '';
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  /** Notify listeners. `what`: 'project' (committed) | 'live' (mid-drag) | 'sel' | 'media' | 'load'. `source` lets a panel skip its own echo. */
  emit(what = 'project', source = null) { for (const fn of [...this.listeners]) fn(what, source); }

  load(project, mediaList) {
    this.project = project; this.media = new Map(mediaList.map(m => [m.id, m]));
    this.sel = null; this.undoStack = []; this.redoStack = []; this.snapshot = JSON.stringify(project);
    this.emit('load');
  }
  /** Live change while dragging/typing (no undo step). */
  touch(source) { this.emit('live', source); }
  /** Finish an edit: records an undo step if the project actually changed. */
  commit(source) {
    const now = JSON.stringify(this.project);
    if (now !== this.snapshot) {
      this.undoStack.push(this.snapshot); if (this.undoStack.length > 80) this.undoStack.shift();
      this.redoStack = []; this.snapshot = now; this.project.updatedAt = Date.now();
    }
    this.emit('project', source);
  }
  _restore(json) {
    const keep = this.project.id; this.project = JSON.parse(json); this.project.id = keep; this.snapshot = json;
    if (this.sel && !this.findSel()) this.sel = null;
    this.emit('project');
  }
  undo() { if (!this.undoStack.length) return false; this.redoStack.push(this.snapshot); this._restore(this.undoStack.pop()); return true; }
  redo() { if (!this.redoStack.length) return false; this.undoStack.push(this.snapshot); this._restore(this.redoStack.pop()); return true; }

  select(type, id) { this.sel = type ? { type, id } : null; this.emit('sel'); }
  findSel() {
    const s = this.sel, p = this.project; if (!s || !p) return null;
    const list = s.type === 'clip' ? p.clips : s.type === 'audio' ? p.audio : p.lyrics;
    return list.find(x => x.id === s.id) || null;
  }

  // ---- editing operations -------------------------------------------------
  addMediaToTimeline(m, at = null) {
    const p = this.project;
    if (m.kind === 'audio') {
      const a = { id: uid(), mediaId: m.id, start: at ?? 0, in: 0, out: m.duration, volume: 1, fadeIn: 0, fadeOut: 0 };
      p.audio.push(a); this.sel = { type: 'audio', id: a.id };
    } else {
      const c = {
        id: uid(), mediaId: m.id, kind: m.kind, in: 0, out: m.kind === 'image' ? 4 : m.duration, speed: 1,
        volume: 1, muted: false, fit: 'cover', rotate: 0, flip: false, motion: m.kind === 'image',
        filter: { preset: 'none', brightness: 1, contrast: 1, saturate: 1 }, transition: { type: 'none', dur: 0.5 },
      };
      p.clips.push(c); this.sel = { type: 'clip', id: c.id };
    }
    this.commit();
  }

  /** Splits whatever lies under time t (selected item first, otherwise the video clip). */
  splitAt(t) {
    const p = this.project, s = this.sel;
    if (s?.type === 'audio') {
      const a = this.findSel();
      if (a && t > a.start + MIN_DUR && t < a.start + (a.out - a.in) - MIN_DUR) {
        const cut = a.in + (t - a.start);
        const b = { ...a, id: uid(), start: round3(t), in: round3(cut), fadeIn: 0 };
        a.out = round3(cut); a.fadeOut = 0;
        p.audio.splice(p.audio.indexOf(a) + 1, 0, b); this.commit(); return true;
      }
    }
    if (s?.type === 'lyric') {
      const l = this.findSel();
      if (l && t > l.start + MIN_DUR && t < l.end - MIN_DUR) {
        const words = l.text.split(/\s+/), k = clamp(Math.round(words.length * (t - l.start) / (l.end - l.start)), 1, Math.max(1, words.length - 1));
        const b = { id: uid(), text: words.slice(k).join(' ') || l.text, start: round3(t), end: l.end };
        l.text = words.slice(0, k).join(' '); l.end = round3(t);
        p.lyrics.splice(p.lyrics.indexOf(l) + 1, 0, b); this.commit(); return true;
      }
    }
    const e = clipAt(p, t);
    if (!e || t - e.start < MIN_DUR || e.end - t < MIN_DUR) return false;
    const c = e.clip, cut = round3(c.in + (t - e.start) * c.speed);
    const b = { ...structuredClone(c), id: uid(), in: cut, transition: { type: 'none', dur: 0.5 } };
    c.out = cut;
    p.clips.splice(e.index + 1, 0, b); this.sel = { type: 'clip', id: b.id }; this.commit(); return true;
  }
  deleteSel() {
    const s = this.sel, p = this.project; if (!s) return false;
    const key = s.type === 'clip' ? 'clips' : s.type === 'audio' ? 'audio' : 'lyrics';
    p[key] = p[key].filter(x => x.id !== s.id); this.sel = null; this.commit(); return true;
  }
  duplicateSel() {
    const s = this.sel, p = this.project, x = this.findSel(); if (!x) return false;
    const y = { ...structuredClone(x), id: uid() };
    if (s.type === 'clip') p.clips.splice(p.clips.indexOf(x) + 1, 0, y);
    else if (s.type === 'audio') { y.start = x.start + (x.out - x.in); p.audio.push(y); }
    else { const d = x.end - x.start; y.start = x.end; y.end = x.end + d; p.lyrics.splice(p.lyrics.indexOf(x) + 1, 0, y); }
    this.sel = { type: s.type, id: y.id }; this.commit(); return true;
  }
  moveClip(id, toIndex) {
    const p = this.project, i = p.clips.findIndex(c => c.id === id); if (i < 0) return;
    const [c] = p.clips.splice(i, 1); p.clips.splice(clamp(toIndex, 0, p.clips.length), 0, c);
  }
  sortLyrics() { this.project.lyrics.sort((a, b) => a.start - b.start); }
  removeMedia(id) {
    const p = this.project;
    p.clips = p.clips.filter(c => c.mediaId !== id); p.audio = p.audio.filter(a => a.mediaId !== id);
    this.media.delete(id); if (this.sel && !this.findSel()) this.sel = null;
    this.commit(); this.emit('media');
  }
}
export const store = new Store();
