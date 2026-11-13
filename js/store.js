// Project model + editing operations + undo history. The project is plain JSON; media blobs live in IndexedDB.
import { uid, clamp, round3 } from './util.js';
import { resolveCues, isSynced, SCHEMA_VERSION } from './sync.js';

export const ASPECTS = {
  '9:16': [1080, 1920, 'Vertical'], '16:9': [1920, 1080, 'Wide'],
  '1:1': [1080, 1080, 'Square'], '4:5': [1080, 1350, 'Portrait'],
};
export const MIN_DUR = 0.2;

export function newProject(name, aspect = '9:16') {
  const [width, height] = ASPECTS[aspect];
  return {
    id: uid(), schemaVersion: SCHEMA_VERSION, name: name || 'Untitled video', createdAt: Date.now(), updatedAt: Date.now(),
    vocalStartMs: null, vocalStartSource: null, detection: null,
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
/** End of the last video clip or audio track, in seconds (0 when the project has no media). */
export function mediaEnd(p) {
  let d = videoEnd(p);
  for (const a of p.audio) d = Math.max(d, a.start + (a.out - a.in));
  return d;
}
export function duration(p) {
  const d = mediaEnd(p);
  if (d > 0) return d;
  const c = cuesOf(p).cues; return c.length ? c[c.length - 1].endMs / 1000 : 0;
}
/**
 * Display cues for the project's lyrics — the single timing path used by preview, timeline and export
 * (docs/SYNC_SPEC.md). Memoised on the inputs that affect timing.
 */
let cueMemo = { key: '', val: null };
export function cuesOf(p) {
  const end = mediaEnd(p), key = JSON.stringify([p.lyrics, p.vocalStartMs, end]);
  if (cueMemo.key !== key) cueMemo = { key, val: resolveCues(p.lyrics, { durationMs: end > 0 ? Math.round(end * 1000) : undefined, vocalStartMs: p.vocalStartMs }) };
  return cueMemo.val;
}
const msOf = t => Math.max(0, Math.round(t * 1000));
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
      const l = this.materialize(s.id), tm = msOf(t);
      if (l && isSynced(l) && tm > l.startMs + MIN_DUR * 1000 && tm < l.endMs - MIN_DUR * 1000) {
        const words = l.text.split(/\s+/), k = clamp(Math.round(words.length * (tm - l.startMs) / (l.endMs - l.startMs)), 1, Math.max(1, words.length - 1));
        const b = { id: uid(), text: words.slice(k).join(' ') || l.text, startMs: tm, endMs: l.endMs };
        l.text = words.slice(0, k).join(' '); l.endMs = tm;
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
    else {
      const c = cuesOf(p).cues.find(q => q.id === x.id);
      if (c) { y.startMs = c.endMs; y.endMs = c.endMs + (c.endMs - c.startMs); } else { y.startMs = null; y.endMs = null; }
      p.lyrics.splice(p.lyrics.indexOf(x) + 1, 0, y);
    }
    this.sel = { type: s.type, id: y.id }; this.commit(); return true;
  }
  moveClip(id, toIndex) {
    const p = this.project, i = p.clips.findIndex(c => c.id === id); if (i < 0) return;
    const [c] = p.clips.splice(i, 1); p.clips.splice(clamp(toIndex, 0, p.clips.length), 0, c);
  }
  /** Sorts lines by time only when every line is timed, so unsynced lines keep their place. */
  sortLyrics() {
    const L = this.project.lyrics;
    if (L.every(l => !l.text.trim() || isSynced(l))) L.sort((a, b) => (isSynced(a) ? a.startMs : -1) - (isSynced(b) ? b.startMs : -1));
  }
  /** Gives an unsynced (provisional) lyric line the exact times it is currently shown at, before it is edited. */
  materialize(id) {
    const l = this.project.lyrics.find(x => x.id === id); if (!l) return null;
    const c = cuesOf(this.project).cues.find(q => q.id === id);
    if (c) { if (!isSynced(l)) l.startMs = c.startMs; if (!(Number.isInteger(l.endMs) && l.endMs > l.startMs)) l.endMs = c.endMs; }
    return l;
  }
  removeMedia(id) {
    const p = this.project;
    p.clips = p.clips.filter(c => c.mediaId !== id); p.audio = p.audio.filter(a => a.mediaId !== id);
    this.media.delete(id); if (this.sel && !this.findSel()) this.sel = null;
    this.commit(); this.emit('media');
  }
}
export const store = new Store();
