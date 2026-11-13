// Side panels: Media, Templates, Lyrics, Style and Edit (inspector for the selected item).
import { h, icon, $, fmtTime, fmtBytes, toast, modal, confirmDialog, downloadBlob, uid, clamp, round3 } from './util.js';
import { store, duration, layout, ASPECTS, clipDur, cuesOf } from './store.js';
import { isSynced, applyVocalStart, activeCue } from './sync.js';
import * as db from './db.js';
import { importFile, kindOf } from './media.js';
import { TEMPLATES, applyTemplate, SAMPLE_LINES } from './templates.js';
import { Renderer, FILTERS, TRANSITIONS } from './render.js';
import { LYRIC_FX, FONTS } from './lyricfx.js';
import { BACKGROUNDS } from './backgrounds.js';
import { parseLyrics, toLrc, toSrt } from './lyrics.js';

export const TABS = [['media', 'Media', 'film'], ['templates', 'Templates', 'sparkle'], ['lyrics', 'Lyrics', 'text'], ['style', 'Style', 'palette'], ['edit', 'Edit', 'sliders']];
const SRC = 'panel';

// ---- small form controls ----------------------------------------------------
const live = () => store.touch(SRC), done = () => store.commit(SRC);
function range(label, value, min, max, step, set, fmt = v => v) {
  const out = h('output', null, fmt(value));
  const inp = h('input', { type: 'range', min, max, step, value, oninput: () => { set(+inp.value); out.textContent = fmt(+inp.value); live(); }, onchange: done });
  return h('label.field', null, h('span.field-top', null, h('span', label), out), inp);
}
function toggle(label, value, set) {
  const inp = h('input', { type: 'checkbox', checked: !!value, onchange: () => { set(inp.checked); done(); } });
  return h('label.switch', null, h('span', label), inp, h('i'));
}
function chips(options, value, set, cls = '') {
  const box = h('div.chips' + cls);
  for (const [val, label] of options) box.append(h('button.chip' + (val === value ? '.on' : ''), { type: 'button', onclick: () => { set(val); store.commit(); } }, label));
  return box;
}
function color(label, value, set) {
  const inp = h('input', { type: 'color', value, oninput: () => { set(inp.value); live(); }, onchange: done });
  return h('label.color', null, inp, h('span', label));
}
function text(label, value, set, placeholder = '') {
  const inp = h('input.input', { type: 'text', value, placeholder, oninput: () => { set(inp.value); live(); }, onchange: done });
  return h('label.field', null, h('span.field-top', null, h('span', label)), inp);
}
function num(label, value, set, step = 0.1) {
  const inp = h('input.input.num', { type: 'number', value: round3(value), step, min: 0, onchange: () => { const v = parseFloat(inp.value); if (Number.isFinite(v)) { set(Math.max(0, v)); store.commit(); } } });
  return h('label.field.inline', null, h('span', label), inp);
}
const section = (title, ...kids) => h('section.sec', null, h('h4', title), ...kids);

export class Panels {
  constructor(root, player, timeline) {
    this.root = root; this.player = player; this.timeline = timeline; this.tab = 'media'; this.sync = null; this.raf = 0;
    this.body = h('div.panel-body'); this.title = h('h3');
    root.append(h('div.panel-head', null, this.title, h('button.icon-btn.panel-close', { title: 'Close panel', onclick: () => this.close() }, icon('x'))), this.body);
    this.fileInput = h('input', { type: 'file', multiple: true, hidden: true, accept: 'video/*,audio/*,image/*,.mkv,.mov,.m4a,.flac', onchange: e => { this.importFiles([...e.target.files]); e.target.value = ''; } });
    this.lrcInput = h('input', { type: 'file', hidden: true, accept: '.lrc,.srt,.txt,text/plain', onchange: async e => { const f = e.target.files[0]; e.target.value = ''; if (f) this.setLyrics(await f.text(), true); } });
    root.append(this.fileInput, this.lrcInput);
    store.on((what, source) => {
      if (what === 'live' || source === SRC) return;
      if (what === 'sel' && this.tab !== 'edit' && this.tab !== 'lyrics') return;
      this.render();
    });
  }
  open(tab) { this.tab = tab; document.body.classList.add('panel-open'); this.render(); this.onTab?.(tab); }
  close() { document.body.classList.remove('panel-open'); this.onTab?.(null); }

  render() {
    cancelAnimationFrame(this.raf);
    if (!store.project) return;
    this.title.textContent = TABS.find(t => t[0] === this.tab)[1];
    const keep = this.body.scrollTop;
    this.body.replaceChildren(this[this.tab]());
    this.body.scrollTop = keep;
  }

  // ---- Media ----------------------------------------------------------------
  async importFiles(files) {
    const p = store.project; let ok = 0;
    for (const f of files) {
      if (!kindOf(f)) { toast('Skipped unsupported file: ' + f.name, 'warn'); continue; }
      const busy = toast('Importing ' + f.name + '…');
      try {
        const m = await importFile(f, p.id); await db.putMedia(m); store.media.set(m.id, m);
        store.addMediaToTimeline(m, m.kind === 'audio' ? 0 : null); ok++;
      } catch (err) { console.error(err); toast(err.message || 'Could not import ' + f.name, 'error'); }
      void busy;
    }
    if (ok) { toast(ok === 1 ? 'Added to your timeline' : ok + ' files added to your timeline'); store.emit('media'); this.timeline.fit(); }
  }
  media() {
    const list = [...store.media.values()].sort((a, b) => a.addedAt - b.addedAt);
    const used = id => store.project.clips.some(c => c.mediaId === id) || store.project.audio.some(a => a.mediaId === id);
    const grid = h('div.media-grid');
    for (const m of list) {
      grid.append(h('div.media-card', { title: 'Add to timeline' },
        h('button.media-thumb' + '.' + m.kind, { style: { backgroundImage: m.thumb ? `url(${m.thumb})` : '' }, onclick: () => { store.addMediaToTimeline(m, m.kind === 'audio' ? round3(this.player.time) : null); toast('Added to timeline'); } },
          m.kind === 'audio' && icon('music', 26), h('span.badge', null, m.kind === 'image' ? 'Photo' : fmtTime(m.duration, false)), h('span.add', null, icon('plus', 16))),
        h('div.media-meta', null, h('span.name', { title: m.name }, m.name),
          h('button.icon-btn.sm', { title: 'Remove from project', onclick: async () => {
            if (used(m.id) && !await confirmDialog('Remove this file?', 'It is used on your timeline. Those clips will be removed too.', 'Remove')) return;
            await db.deleteMedia(m.id); store.removeMedia(m.id);
          } }, icon('trash', 14)))));
    }
    return h('div', null,
      h('button.dropzone', { onclick: () => this.fileInput.click() }, icon('upload', 22), h('b', 'Import videos, photos or music'), h('small', 'Files stay on this device — nothing is uploaded')),
      list.length ? h('p.hint', 'Tap a file to add it to the timeline again.') : null, grid);
  }

  // ---- Templates ------------------------------------------------------------
  templates() {
    const p = store.project, grid = h('div.tpl-grid'), cells = [], r = new Renderer();
    const cw = 150, chh = Math.round(cw * p.height / p.width / 2) * 2;
    for (const t of TEMPLATES) {
      const cv = h('canvas', { width: cw * 2, height: chh * 2 });
      const mock = { width: p.width, height: p.height, clips: [], audio: [], lyrics: SAMPLE_LINES, background: t.background, style: t.style, overlay: t.overlay };
      cells.push({ cv, ctx: cv.getContext('2d'), mock });
      grid.append(h('button.tpl' + (p.template === t.id ? '.on' : ''), { onclick: () => { applyTemplate(p, t.id); store.commit(); toast(t.name + ' applied'); } },
        cv, h('span.tpl-name', null, t.name), h('span.tpl-tag', null, t.tag), p.template === t.id && h('span.tpl-check', null, icon('check', 14))));
    }
    let lastDraw = 0;
    const tick = now => {
      if (!grid.isConnected) return;
      this.raf = requestAnimationFrame(tick);
      if (now - lastDraw < 45) return; lastDraw = now;
      const t = (now / 1000) % 8;
      for (const c of cells) r.render(c.ctx, c.cv.width, c.cv.height, c.mock, t, () => null, { dur: 8, level: 0.5 + 0.4 * Math.sin(now / 180), cues: SAMPLE_LINES });
    };
    this.raf = requestAnimationFrame(tick);
    return h('div', null, h('p.hint', 'Pick an animated look. It sets the background, lyric animation and fonts — then fine-tune everything in Style.'), grid);
  }

  // ---- Lyrics ---------------------------------------------------------------
  setLyrics(textValue, replace) {
    const p = store.project, lines = parseLyrics(textValue);
    if (!lines.length) { toast('No lyric lines found', 'warn'); return; }
    p.lyrics = replace ? lines : [...p.lyrics, ...lines]; store.sortLyrics(); store.commit();
    const timed = lines.filter(isSynced).length;
    toast(timed ? `${lines.length} lines added · ${timed} already timed` : `${lines.length} lines added — now set when the singer starts`);
  }
  editAllDialog() {
    const p = store.project;
    modal(close => {
      const ta = h('textarea.input.area', { placeholder: 'Paste or type your lyrics here, one line per row.\n\nYou can also paste timed .LRC or .SRT text.', value: p.lyrics.map(l => l.text).join('\n') });
      setTimeout(() => ta.focus(), 30);
      return h('div', null, h('h3', 'Write or paste lyrics'),
        h('p.muted', 'One lyric line per row. Lyrics only appear once they are timed — set when the singer starts, then tap along to sync each line.'), ta,
        h('div.modal-actions', null, h('button.btn', { onclick: close }, 'Cancel'),
          h('button.btn.primary', { onclick: () => {
            const rows = ta.value.split('\n').map(s => s.trim()).filter(Boolean), old = p.lyrics.filter(l => l.text.trim());
            // Keep existing timing when only the wording changed.
            if (rows.length === old.length && !/\[\d+:\d+|-->/.test(ta.value)) { rows.forEach((t, i) => old[i].text = t); p.lyrics = old; store.commit(); }
            else this.setLyrics(ta.value, true);
            close();
          } }, 'Save lyrics')));
    }, { wide: true });
  }

  /** Tap-to-sync. The first tap on the first line is the vocal start (SYNC_SPEC). */
  startSync(fromId = null) {
    const p = store.project, lines = p.lyrics.filter(l => l.text.trim());
    if (!lines.length) return toast('Add lyrics first', 'warn');
    if (duration(p) <= 0) return toast('Add a song or video first', 'warn');
    const from = Math.max(0, fromId ? lines.findIndex(l => l.id === fromId) : 0);
    this.sync = { ids: lines.map(l => l.id), i: from };
    // First line: listen from the very beginning (through the intro). Later lines: a short run-up.
    const prev = from > 0 ? lines[from - 1] : null;
    this.player.seek(from === 0 ? 0 : Math.max(0, (isSynced(prev) ? prev.startMs / 1000 : this.player.time) - 1));
    this.player.play(); this.render();
  }
  tapSync() {
    const s = this.sync, p = store.project; if (!s) return;
    const l = p.lyrics.find(x => x.id === s.ids[s.i]); if (!l) return;
    const t = Math.round(this.player.time * 1000);
    l.startMs = t; l.endMs = null;                      // end follows the next line (or the hold limit)
    if (s.i === 0) { p.vocalStartMs = t; p.vocalStartSource = 'manual'; if (p.detection) p.detection.decision = 'replaced'; }
    s.i++;
    store.touch(SRC);
    // Finish a moment later so the finger's follow-up click cannot land on a freshly rendered button.
    if (s.i >= s.ids.length) setTimeout(() => this.stopSync(), 400); else this.render();
  }
  stopSync() {
    const s = this.sync; if (!s) return; this.sync = null; this.player.pause();
    store.commit(); toast(s.i ? `${s.i} line${s.i > 1 ? 's' : ''} synced` : 'Sync stopped');
  }

  // Vocal start --------------------------------------------------------------------------------------------
  setVocalStart(ms, source) {
    const p = store.project; applyVocalStart(p, ms, source); store.commit();
  }
  nudgeVocal(deltaMs) {
    const p = store.project; if (!Number.isInteger(p.vocalStartMs)) return;
    this.setVocalStart(Math.max(0, p.vocalStartMs + deltaMs), 'manual');
    this.player.pause(); this.player.seek(p.vocalStartMs / 1000);
  }
  previewAt(ms, lead = 3) {
    this.player.seek(Math.max(0, ms / 1000 - lead)); this.player.play();
    clearTimeout(this.pv); this.pv = setTimeout(() => this.player.pause(), (lead + 4) * 1000);
  }
  resetTiming() {
    confirmDialog('Reset all timing?', 'Every lyric line and the vocal start become untimed again. The words stay.', 'Reset').then(ok => {
      if (!ok) return; const p = store.project;
      for (const l of p.lyrics) { l.startMs = null; l.endMs = null; }
      p.vocalStartMs = null; p.vocalStartSource = null; store.commit(); toast('Timing cleared — sync again any time');
    });
  }
  async detectVocals() {
    const p = store.project;
    if (!p.audio.length && !p.clips.some(c => c.kind === 'video')) return toast('Add a song or a video with sound first', 'warn');
    this.player.pause();
    const job = this.detecting = { progress: 0, label: 'Preparing audio…', signal: { cancelled: false } }; this.render();
    try {
      const { detectProject } = await import('./vocal-run.js');
      const res = await detectProject(p, store.media, {
        signal: job.signal,
        onProgress: (f, label) => { job.progress = f; if (label) job.label = label; this.updateDetectProgress(); },
      });
      if (store.project !== p) return;
      p.detection = { ...res, series: undefined, decision: 'pending', at: Date.now() };
      store.commit();
      if (res.vocalStartMs == null) toast('No singing detected — set the start by tapping instead', 'warn');
    } catch (e) {
      if (!e.cancelled) { console.error(e); toast('Analysis failed: ' + (e.message || e), 'error'); }
    } finally { this.detecting = null; this.render(); }
  }
  updateDetectProgress() {
    const d = this.detecting; if (!d || !this.detBar) return;
    this.detBar.style.width = Math.round(d.progress * 100) + '%'; this.detLabel.textContent = d.label + ' ' + Math.round(d.progress * 100) + '%';
  }
  vocalCard() {
    const p = store.project, vs = p.vocalStartMs, det = p.detection;
    const src = { manual: 'Set by you', detected: 'Detected automatically — you confirmed it', none: 'Song starts with vocals' }[p.vocalStartSource] || '';
    if (this.detecting) {
      this.detBar = h('i'); this.detLabel = h('span.muted', this.detecting.label);
      setTimeout(() => this.updateDetectProgress());
      return h('div.vocal-card', null, h('div.vc-top', null, icon('wand', 18), h('b', 'Listening for the singer…')),
        h('p.hint', 'Analysed on this device. Nothing is uploaded.'), h('div.progress', null, this.detBar), h('div.progress-row', null, this.detLabel),
        h('button.btn.ghost.wide', { onclick: () => { this.detecting.signal.cancelled = true; } }, 'Cancel'));
    }
    const card = h('div.vocal-card', null,
      h('div.vc-top', null, icon('mic', 18), h('span.vc-title', 'Singer starts at'),
        h('b.vc-time', Number.isInteger(vs) ? fmtTime(vs / 1000) : 'Not set')),
      h('p.hint', Number.isInteger(vs) ? src : 'Lyrics stay hidden during the intro until you set this or sync the first line.'));
    if (Number.isInteger(vs)) card.append(
      h('div.vc-nudge', null,
        ...[[-500, '−0.5s'], [-100, '−0.1s'], [100, '+0.1s'], [500, '+0.5s']].map(([d, l]) => h('button.chip', { title: 'Move the vocal start', onclick: () => this.nudgeVocal(d) }, l)),
        h('button.chip', { title: 'Play the moment the singer starts', onclick: () => this.previewAt(vs) }, icon('play2', 13), 'Preview')));
    card.append(h('div.btn-row', null,
      h('button.btn.primary', { onclick: () => this.startSync(), title: 'Play from the beginning and tap when the singing starts' }, icon('tap', 16), Number.isInteger(vs) ? 'Re-tap start' : 'Tap when singer starts'),
      h('button.btn', { onclick: () => this.detectVocals(), title: 'Analyse the song on this device' }, icon('wand', 16), 'Detect')));
    card.append(h('div.vc-links', null,
      h('button.linkish', { onclick: () => { this.setVocalStart(0, 'none'); toast('Lyrics can start right away'); } }, 'Song starts with vocals'),
      Number.isInteger(vs) && h('button.linkish', { onclick: () => { this.setVocalStart(null, null); } }, 'Clear vocal start')));
    if (det && det.decision === 'pending') card.append(this.detectionCard(det));
    return card;
  }
  detectionCard(det) {
    const p = store.project;
    if (det.vocalStartMs == null) return h('div.det-card.none', null, h('b', 'No singing found'),
      h('p.hint', 'The analysis did not hear a singer. If this song has vocals, use “Tap when singer starts”.'),
      h('button.btn.ghost', { onclick: () => { det.decision = 'rejected'; store.commit(); } }, 'OK'));
    const msg = { high: 'Clear change from instrumental to singing.', medium: 'Probably right — listen before you use it.', low: 'Not sure — please listen and confirm, or tap the start yourself.' }[det.level];
    const pick = det.pick || 0, c = det.candidates?.[pick] || { ms: det.vocalStartMs };
    return h('div.det-card.' + det.level, null,
      h('div.vc-top', null, h('b', 'Detected singing at ' + fmtTime(c.ms / 1000)), h('span.badge-lvl', null, det.level + ' confidence')),
      h('p.hint', msg),
      h('div.btn-row', null,
        h('button.btn.ghost', { onclick: () => this.previewAt(c.ms) }, icon('play2', 14), 'Listen'),
        h('button.btn' + (det.level === 'high' ? '.primary' : ''), { onclick: () => { det.decision = 'accepted'; det.acceptedMs = c.ms; this.setVocalStart(c.ms, 'detected'); toast('Vocal start set — fine-tune with the ± buttons'); } }, det.level === 'high' ? 'Use this time' : 'Use anyway')),
      h('div.vc-links', null,
        det.candidates?.length > 1 && h('button.linkish', { onclick: () => { det.pick = (pick + 1) % det.candidates.length; store.commit(); } }, `Other guess (${fmtTime(det.candidates[(pick + 1) % det.candidates.length].ms / 1000)})`),
        h('button.linkish', { onclick: () => { det.decision = 'rejected'; store.commit(); } }, 'Dismiss')));
  }

  lyrics() {
    const p = store.project, list = h('div.lyric-list'); this.rows = [];
    if (this.sync) {
      const at = k => p.lyrics.find(x => x.id === this.sync.ids[k]);
      const first = this.sync.i === 0, next = at(this.sync.i);
      return h('div.sync-mode', null,
        h('p.hint', first ? 'Listen through the intro and tap the moment the singer starts the first words.' : 'Tap the moment each line starts.'),
        h('div.sync-prev', null, at(this.sync.i - 1)?.text || ''),
        h('div.sync-next', null, next?.text || ''),
        h('div.sync-after', null, at(this.sync.i + 1)?.text || ''),
        h('button.tap-btn', { onpointerdown: e => { e.preventDefault(); this.tapSync(); } }, icon(first ? 'mic' : 'tap', 30),
          h('b', first ? 'SINGER STARTS' : 'TAP'), h('small', `Line ${this.sync.i + 1} of ${this.sync.ids.length} · or press Space`)),
        h('button.btn.wide', { onclick: () => this.stopSync() }, 'Done'));
    }
    const { cues } = cuesOf(p), cueOf = new Map(cues.map(c => [c.id, c]));
    p.lyrics.forEach(l => {
      if (!l.text.trim() && !(store.sel?.id === l.id)) { /* keep empty rows editable */ }
      const c = cueOf.get(l.id), synced = isSynced(l);
      const label = synced ? fmtTime(l.startMs / 1000) : c ? '≈' + fmtTime(c.startMs / 1000) : '--:--';
      const inp = h('input.input', { type: 'text', value: l.text, placeholder: 'Lyric line', oninput: () => { l.text = inp.value; live(); }, onchange: done, onfocus: () => { if (store.sel?.id !== l.id) { store.sel = { type: 'lyric', id: l.id }; this.timeline.render(); this.mark(); } } });
      const row = h('div.lyric-row' + (store.sel?.type === 'lyric' && store.sel.id === l.id ? '.sel' : '') + (synced ? '' : c ? '.prov' : '.untimed'), { dataset: { id: l.id } },
        h('button.time', { title: synced ? 'Jump to this line' : c ? 'Estimated time — not synced yet' : 'Not timed yet', onclick: () => { if (!c) return; this.player.pause(); this.player.seek(c.startMs / 1000); store.select('lyric', l.id); } }, label),
        inp,
        h('button.icon-btn.sm', { title: 'Start this line at the playhead', onclick: () => {
          l.startMs = Math.round(this.player.time * 1000); l.endMs = null;
          const firstLine = p.lyrics.find(x => x.text.trim()); if (firstLine === l) { p.vocalStartMs = l.startMs; p.vocalStartSource = 'manual'; }
          store.sortLyrics(); store.commit(); } }, icon('tap', 15)),
        h('button.icon-btn.sm', { title: 'Replay this line', disabled: !c, onclick: () => c && this.previewAt(c.startMs, 1.5) }, icon('play2', 14)),
        h('button.icon-btn.sm', { title: 'Delete line', onclick: () => { p.lyrics.splice(p.lyrics.indexOf(l), 1); store.commit(); } }, icon('x', 15)));
      this.rows.push({ l, row, c }); list.append(row);
    });
    const add = () => {
      const t = Math.round(this.player.time * 1000), l = { id: uid(), text: '', startMs: t, endMs: t + 3000 };
      p.lyrics.push(l); store.sortLyrics(); store.sel = { type: 'lyric', id: l.id }; store.commit();
      setTimeout(() => $(`.lyric-row[data-id="${l.id}"] input`)?.focus(), 30);
    };
    const exp = kind => {
      if (!p.lyrics.length) return toast('No lyrics to export', 'warn');
      downloadBlob(new Blob([kind === 'lrc' ? toLrc(p.lyrics, p.name) : toSrt(cuesOf(p).cues)], { type: 'text/plain;charset=utf-8' }), (p.name || 'lyrics') + '.' + kind);
    };
    const synced = p.lyrics.filter(l => l.text.trim() && isSynced(l)).length, total = p.lyrics.filter(l => l.text.trim()).length;
    setTimeout(() => this.mark());
    return h('div', null,
      p.lyrics.length ? this.vocalCard() : null,
      h('div.btn-row', null,
        h('button.btn' + (p.lyrics.length ? '' : '.primary'), { onclick: () => this.editAllDialog() }, icon('edit', 16), p.lyrics.length ? 'Edit all' : 'Write / paste lyrics'),
        p.lyrics.length ? h('button.btn', { onclick: () => this.startSync(store.sel?.type === 'lyric' ? store.sel.id : null), title: 'Tap along with the song to time each line (from the selected line)' }, icon('tap', 16), 'Tap to sync') : null),
      h('div.btn-row', null,
        h('button.btn.ghost', { onclick: () => this.lrcInput.click(), title: 'Import .lrc or .srt lyrics' }, icon('upload', 15), 'Import'),
        h('button.btn.ghost', { onclick: () => exp('lrc') }, icon('download', 15), '.lrc'),
        h('button.btn.ghost', { onclick: () => exp('srt') }, icon('download', 15), '.srt')),
      total ? h('p.hint.sync-count', null, `${synced} of ${total} lines synced`, synced < total ? ' · ≈ = estimated, --:-- = hidden until timed' : '') : null,
      p.lyrics.length ? list : h('div.empty', null, icon('text', 28), h('b', 'No lyrics yet'), h('span', 'Write or paste your lyrics, set when the singer starts, then tap along to sync.')),
      h('button.btn.wide.ghost', { onclick: add }, icon('plus', 16), 'Add line at playhead'),
      synced ? h('button.btn.wide.ghost.danger-text', { onclick: () => this.resetTiming() }, 'Reset timing and sync again') : null);
  }
  /** Highlights the line under the playhead (called on every time update). */
  mark() {
    if (this.tab !== 'lyrics' || !this.rows) return; const t = this.player.time * 1000;
    const now = activeCue(cuesOf(store.project).cues, t);
    for (const { l, row } of this.rows) {
      row.classList.toggle('now', !!now && now.id === l.id);
      row.classList.toggle('sel', store.sel?.type === 'lyric' && store.sel.id === l.id);
    }
  }

  // ---- Style ----------------------------------------------------------------
  style() {
    const p = store.project, st = p.style, bg = p.background, ov = p.overlay;
    const custom = () => { p.template = 'custom'; };
    return h('div', null,
      section('Lyric animation', chips(Object.entries(LYRIC_FX).map(([k, v]) => [k, v.name]), st.fx, v => { st.fx = v; custom(); }, '.grid2')),
      section('Text',
        h('label.field', null, h('span.field-top', null, h('span', 'Font')),
          h('select.input', { onchange: e => { st.font = e.target.value; st.weight = FONTS[st.font].weights.at(-1); store.commit(); } },
            Object.keys(FONTS).map(f => h('option', { value: f, selected: f === st.font, style: { fontFamily: FONTS[f].stack } }, f)))),
        range('Size', st.size, 36, 150, 1, v => st.size = v),
        range('Vertical position', st.posY, 0.08, 0.92, 0.01, v => st.posY = v, v => Math.round(v * 100) + '%'),
        h('div.color-row', null, color('Text', st.color, v => st.color = v), color('Accent', st.accent, v => st.accent = v)),
        toggle('UPPERCASE', st.upper, v => st.upper = v)),
      section('Animated background', h('p.hint', 'Shown behind photos/videos set to “Fit”, and whenever there is no clip.'),
        chips(Object.entries(BACKGROUNDS).map(([k, v]) => [k, v.name]), bg.type, v => { bg.type = v; custom(); }, '.grid3'),
        h('div.color-row', null, ...[0, 1, 2].map(i => color('Color ' + (i + 1), bg.colors[i], v => bg.colors[i] = v)))),
      section('Finishing touches',
        range('Vignette', ov.vignette, 0, 0.8, 0.05, v => ov.vignette = v, v => Math.round(v * 100) + '%'),
        range('Film grain', ov.grain, 0, 1, 0.05, v => ov.grain = v, v => Math.round(v * 100) + '%'),
        toggle('Cinema bars', ov.letterbox, v => ov.letterbox = v),
        toggle('Progress bar', ov.progress, v => ov.progress = v),
        text('Song title', ov.title || '', v => ov.title = v, 'Shown at the top'),
        text('Artist', ov.artist || '', v => ov.artist = v, 'Optional')),
      section('Canvas', chips(Object.entries(ASPECTS).map(([k, v]) => [k, `${k} ${v[2]}`]), p.aspect, v => { p.aspect = v; [p.width, p.height] = ASPECTS[v]; }, '.grid2')));
  }

  // ---- Edit (inspector) -----------------------------------------------------
  edit() {
    const p = store.project, s = store.sel, x = store.findSel();
    if (!x) return h('div.empty', null, icon('sliders', 28), h('b', 'Nothing selected'), h('span', 'Tap a clip, lyric or song on the timeline to edit it here.'));
    const actions = h('div.btn-row', null,
      h('button.btn.ghost', { onclick: () => store.duplicateSel() }, icon('copy', 15), 'Duplicate'),
      h('button.btn.ghost.danger-text', { onclick: () => store.deleteSel() }, icon('trash', 15), 'Delete'));
    if (s.type === 'lyric') {
      const c = cuesOf(p).cues.find(q => q.id === x.id), sec = ms => ms / 1000, toMs = v => Math.round(v * 1000);
      const timing = isSynced(x)
        ? h('div', null,
            h('div.inline-row', null,
              num('Start (s)', sec(x.startMs), v => { x.startMs = toMs(v); if (Number.isInteger(x.endMs) && x.endMs <= x.startMs) x.endMs = null; store.sortLyrics(); }, 0.05),
              num('End (s)', sec(c ? c.endMs : x.startMs + 3000), v => { x.endMs = Math.max(x.startMs + 200, toMs(v)); }, 0.05)),
            h('p.hint', Number.isInteger(x.endMs) ? 'Custom end time.' : 'Ends when the next line starts (at most 8 s).'),
            Number.isInteger(x.endMs) && h('button.btn.ghost', { onclick: () => { x.endMs = null; store.commit(); } }, 'End with next line'))
        : h('div', null, h('p.hint', c ? `Not synced yet — shown at an estimated ${fmtTime(c.startMs / 1000)}.` : 'Not timed yet — hidden in the video until it is timed.'),
            h('button.btn.ghost', { onclick: () => { x.startMs = Math.round(this.player.time * 1000); x.endMs = null; store.commit(); } }, icon('tap', 15), 'Start at playhead'));
      return h('div', null, section('Lyric line', text('Text', x.text, v => x.text = v), timing), actions);
    }
    const m = store.media.get(x.mediaId);
    if (s.type === 'audio') {
      return h('div', null, section(m?.name || 'Audio',
        range('Volume', x.volume, 0, 1, 0.01, v => x.volume = v, v => Math.round(v * 100) + '%'),
        range('Fade in', x.fadeIn, 0, 5, 0.1, v => x.fadeIn = v, v => v.toFixed(1) + 's'),
        range('Fade out', x.fadeOut, 0, 5, 0.1, v => x.fadeOut = v, v => v.toFixed(1) + 's'),
        h('div.inline-row', null, num('Starts at', x.start, v => x.start = v))), actions);
    }
    const i = p.clips.indexOf(x), f = x.filter, tr = x.transition, isVid = x.kind === 'video';
    return h('div', null,
      section(m?.name || 'Clip',
        h('p.hint', `${isVid ? 'Video' : 'Photo'} · ${fmtTime(clipDur(x))} on timeline${m ? ' · ' + fmtBytes(m.size) : ''}`),
        h('div.btn-row', null,
          h('button.btn.ghost', { disabled: i === 0, onclick: () => { store.moveClip(x.id, i - 1); store.commit(); } }, icon('left', 15), 'Earlier'),
          h('button.btn.ghost', { disabled: i === p.clips.length - 1, onclick: () => { store.moveClip(x.id, i + 1); store.commit(); } }, 'Later', icon('right', 15)))),
      isVid ? section('Speed & sound',
        chips([[0.5, '0.5×'], [1, '1×'], [1.5, '1.5×'], [2, '2×'], [4, '4×']], x.speed, v => x.speed = v),
        range('Volume', x.volume, 0, 1, 0.01, v => x.volume = v, v => Math.round(v * 100) + '%'),
        toggle('Mute clip', x.muted, v => x.muted = v))
        : section('Photo', h('div.inline-row', null, num('Duration (s)', x.out, v => x.out = clamp(v, 0.2, 600))), toggle('Slow zoom motion', x.motion, v => x.motion = v)),
      section('Frame',
        chips([['cover', 'Fill frame'], ['contain', 'Fit inside']], x.fit, v => x.fit = v),
        h('div.btn-row', null,
          h('button.btn.ghost', { onclick: () => { x.rotate = ((x.rotate || 0) + 90) % 360; store.commit(); } }, 'Rotate 90°'),
          h('button.btn.ghost', { onclick: () => { x.flip = !x.flip; store.commit(); } }, 'Flip'))),
      section('Look',
        chips(Object.entries(FILTERS).map(([k, v]) => [k, v[0]]), f.preset, v => f.preset = v, '.grid4'),
        range('Brightness', f.brightness, 0.4, 1.6, 0.02, v => f.brightness = v, v => Math.round(v * 100) + '%'),
        range('Contrast', f.contrast, 0.4, 1.6, 0.02, v => f.contrast = v, v => Math.round(v * 100) + '%'),
        range('Saturation', f.saturate, 0, 2, 0.02, v => f.saturate = v, v => Math.round(v * 100) + '%')),
      section('Transition in',
        chips(Object.entries(TRANSITIONS), tr.type, v => { tr.type = v; const e = layout(p)[i]; if (v !== 'none') setTimeout(() => { this.player.seek(Math.max(0, e.start - 0.6)); this.player.play(); clearTimeout(this.pv); this.pv = setTimeout(() => this.player.pause(), 2400); }); }, '.grid4'),
        tr.type !== 'none' ? range('Duration', tr.dur, 0.2, 2, 0.1, v => tr.dur = v, v => v.toFixed(1) + 's') : null),
      actions);
  }
}
