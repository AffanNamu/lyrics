// Lyric synchronization model — implements docs/SYNC_SPEC.md. Shared rules, tested with spec/sync-cases.json.
// Pure module (no DOM) so the same file runs in the browser, the exporter and Node tests.

export const SCHEMA_VERSION = 2;
export const MAX_AUTO_HOLD_MS = 8000;
export const PROVISIONAL_SPACING_MS = 3500;
export const MIN_LINE_MS = 200;

export const isSynced = l => Number.isInteger(l?.startMs) && l.startMs >= 0;
const hasText = l => typeof l?.text === 'string' && l.text.trim() !== '';
const validEnd = l => Number.isInteger(l.endMs) && l.endMs > l.startMs;

/**
 * Resolves lyric lines into display cues.
 * @param lines [{id,text,startMs,endMs}]
 * @param opts {durationMs?: number, vocalStartMs?: number|null}
 * @returns {cues:[{index,id,text,startMs,endMs,synced}], unplaced:number[], syncedCount, total}
 */
export function resolveCues(lines, opts = {}) {
  const dur = Number.isFinite(opts.durationMs) && opts.durationMs > 0 ? Math.round(opts.durationMs) : null;
  const vs = Number.isInteger(opts.vocalStartMs) && opts.vocalStartMs >= 0 ? opts.vocalStartMs : null;
  const items = [];
  (lines || []).forEach((l, index) => { if (hasText(l)) items.push({ l, index }); });
  const placed = new Array(items.length).fill(null);
  const anchors = [];
  items.forEach((it, i) => { if (isSynced(it.l)) { placed[i] = it.l.startMs; anchors.push(i); } });

  const spread = (from, k, next, startsAtFrom) => {
    // positions for a run of k unsynced lines after/at `from`; `next` = following anchor time or null
    const out = [];
    for (let j = 0; j < k; j++) {
      if (next != null && next > from) {
        out.push(startsAtFrom ? from + (next - from) * j / k : from + (next - from) * (j + 1) / (k + 1));
      } else out.push(from + (startsAtFrom ? j : j + 1) * PROVISIONAL_SPACING_MS);
    }
    return out.map(Math.round);
  };
  // Walk unsynced runs.
  let i = 0;
  while (i < items.length) {
    if (placed[i] != null) { i++; continue; }
    let j = i; while (j < items.length && placed[j] == null) j++;
    const k = j - i, prev = i > 0 ? placed[i - 1] : null, next = j < items.length ? placed[j] : null;
    let pos = null;
    if (prev != null) pos = spread(prev, k, next, false);
    else if (vs != null) pos = spread(vs, k, next, true);
    if (pos) for (let n = 0; n < k; n++) placed[i + n] = pos[n];
    i = j;
  }

  const unplaced = [];
  let cues = [];
  items.forEach((it, n) => {
    const s = placed[n];
    if (s == null || (dur != null && s >= dur)) { unplaced.push(it.index); return; }
    cues.push({ index: it.index, id: it.l.id, text: it.l.text, startMs: s, endMs: 0, synced: isSynced(it.l), _l: it.l });
  });
  cues.sort((a, b) => a.startMs - b.startMs || a.index - b.index);
  cues.forEach((c, n) => {
    const limit = n + 1 < cues.length ? cues[n + 1].startMs : null;
    let end;
    if (c.synced && validEnd(c._l)) end = limit != null ? Math.min(c._l.endMs, limit) : c._l.endMs;
    else end = limit != null ? Math.min(limit, c.startMs + MAX_AUTO_HOLD_MS) : c.startMs + MAX_AUTO_HOLD_MS;
    if (dur != null) end = Math.min(end, dur);
    c.endMs = Math.max(c.startMs, end);
  });
  cues = cues.map(({ _l, ...c }) => c);
  return { cues, unplaced, syncedCount: anchors.length, total: items.length };
}

/** The cue visible at time t (ms), or null. Cues must come from resolveCues (sorted, non-overlapping). */
export function activeCue(cues, tMs) {
  let lo = 0, hi = cues.length - 1, hit = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (cues[m].startMs <= tMs) { hit = m; lo = m + 1; } else hi = m - 1; }
  if (hit < 0) return null;
  const c = cues[hit];
  return tMs < c.endMs ? c : null;
}

/** Applies a vocal start (ms) to the project: stores it and times the first lyric line at it when appropriate. */
export function applyVocalStart(project, ms, source) {
  const prev = project.vocalStartMs;
  project.vocalStartMs = ms == null ? null : Math.max(0, Math.round(ms));
  project.vocalStartSource = ms == null ? null : source;
  if (ms == null) return null;
  const first = (project.lyrics || []).find(hasText);
  // Time the first line if it is unsynced, or if it was previously tied to the old vocal start.
  if (first && (!isSynced(first) || first.startMs === prev)) {
    const len = isSynced(first) && validEnd(first) ? first.endMs - first.startMs : null;
    first.startMs = project.vocalStartMs;
    first.endMs = len ? first.startMs + len : null;
  }
  return first || null;
}

/** Brings any stored browser project up to schema v2 (see SYNC_SPEC §6). Mutates and returns it. */
export function migrateProject(p) {
  if (!p || p.schemaVersion >= SCHEMA_VERSION) return p;
  p.lyrics = (p.lyrics || []).map(l => {
    if ('startMs' in l) return l;
    const startMs = Number.isFinite(l.start) ? Math.max(0, Math.round(l.start * 1000)) : null;
    const endMs = Number.isFinite(l.end) && startMs != null && Math.round(l.end * 1000) > startMs ? Math.round(l.end * 1000) : null;
    return { id: l.id, text: l.text ?? '', startMs, endMs };
  });
  if (!('vocalStartMs' in p)) p.vocalStartMs = null;
  if (!('vocalStartSource' in p)) p.vocalStartSource = null;
  if (!('detection' in p)) p.detection = null;
  p.schemaVersion = SCHEMA_VERSION;
  return p;
}

/** Migrates an Android v1 project object (startMs default 0 = never synced). Used by tests to mirror Dart. */
export function migrateAndroidV1(p) {
  if (p.schemaVersion >= SCHEMA_VERSION) return p;
  return {
    ...p,
    lines: (p.lines || []).map((l, i) => ({ id: l.id ?? String(i), text: l.text ?? '', startMs: Number.isInteger(l.startMs) && l.startMs > 0 ? l.startMs : null, endMs: null })),
    vocalStartMs: null, vocalStartSource: null, detection: null, schemaVersion: SCHEMA_VERSION,
  };
}
