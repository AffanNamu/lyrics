// Side panels: Media, Templates, Lyrics, Style and Edit (inspector for the selected item).
import { h, icon, $, fmtTime, fmtBytes, toast, modal, confirmDialog, downloadBlob, uid, clamp, round3 } from './util.js';
import { store, duration, layout, ASPECTS, clipDur } from './store.js';
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
      for (const c of cells) r.render(c.ctx, c.cv.width, c.cv.height, c.mock, t, () => null, { dur: 8, level: 0.5 + 0.4 * Math.sin(now / 180), sorted: SAMPLE_LINES });
    };
    this.raf = requestAnimationFrame(tick);
    return h('div', null, h('p.hint', 'Pick an animated look. It sets the background, lyric animation and fonts — then fine-tune everything in Style.'), grid);
  }

  // ---- Lyrics ---------------------------------------------------------------
  setLyrics(textValue, replace) {
    const p = store.project, from = replace ? 0 : (p.lyrics.reduce((m, l) => Math.max(m, l.end), 0));
    const lines = parseLyrics(textValue, from, duration(p));
    if (!lines.length) { toast('No lyric lines found', 'warn'); return; }
    p.lyrics = replace ? lines : [...p.lyrics, ...lines]; store.sortLyrics(); store.commit();
    toast(lines.length + ' lines added');
  }
  editAllDialog() {
    const p = store.project;
    modal(close => {
      const ta = h('textarea.input.area', { placeholder: 'Paste or type your lyrics here, one line per row.\n\nYou can also paste timed .LRC or .SRT text.', value: p.lyrics.map(l => l.text).join('\n') });
      setTimeout(() => ta.focus(), 30);
      return h('div', null, h('h3', 'Write or paste lyrics'), h('p.muted', 'One lyric line per row. Timing is spread out automatically — use Tap to sync to match the song.'), ta,
        h('div.modal-actions', null, h('button.btn', { onclick: close }, 'Cancel'),
          h('button.btn.primary', { onclick: () => {
            const rows = ta.value.split('\n').map(s => s.trim()).filter(Boolean), old = p.lyrics;
            // Keep existing timing when only the wording changed.
            if (rows.length === old.length && !/\[\d+:\d+/.test(ta.value)) { rows.forEach((t, i) => old[i].text = t); store.commit(); }
            else this.setLyrics(ta.value, true);
            close();
          } }, 'Save lyrics')));
    }, { wide: true });
  }
  startSync() {
    const p = store.project; if (!p.lyrics.length) return toast('Add lyrics first', 'warn');
    if (duration(p) <= 0) return toast('Add a song or video first', 'warn');
    store.sortLyrics();
    const from = store.sel?.type === 'lyric' ? Math.max(0, p.lyrics.findIndex(l => l.id === store.sel.id)) : 0;
    this.sync = { i: from }; if (from === 0) this.player.seek(0);
    this.player.play(); this.render();
  }
  tapSync() {
    const s = this.sync, p = store.project; if (!s) return;
    const t = round3(this.player.time), l = p.lyrics[s.i]; if (!l) return;
    const len = Math.max(0.4, l.end - l.start);
    if (s.i > 0) { const prev = p.lyrics[s.i - 1]; if (prev.start < t) prev.end = t; }
    l.start = t; l.end = round3(t + len); s.i++;
    store.touch(SRC);
    // Finish a moment later so the finger's follow-up click cannot land on a freshly rendered button.
    if (s.i >= p.lyrics.length) setTimeout(() => this.stopSync(), 400); else this.render();
  }
  stopSync() {
    const p = store.project, s = this.sync; if (!s) return; this.sync = null; this.player.pause();
    // Push any untouched later lines after the last synced one so nothing overlaps.
    for (let i = Math.max(1, s.i); i < p.lyrics.length; i++) {
      const a = p.lyrics[i - 1], b = p.lyrics[i];
      if (b.start < a.end) { if (i < s.i) a.end = b.start; else { const d = b.end - b.start; b.start = a.end; b.end = round3(b.start + d); } }
    }
    store.commit(); toast('Lyrics synced');
  }
  lyrics() {
    const p = store.project, list = h('div.lyric-list'); this.rows = [];
    if (this.sync) {
      const next = p.lyrics[this.sync.i];
      return h('div.sync-mode', null, h('p.hint', 'Listen and tap the moment each line starts.'),
        h('div.sync-prev', null, p.lyrics[this.sync.i - 1]?.text || ''),
        h('div.sync-next', null, next?.text || ''),
        h('div.sync-after', null, p.lyrics[this.sync.i + 1]?.text || ''),
        h('button.tap-btn', { onpointerdown: e => { e.preventDefault(); this.tapSync(); } }, icon('tap', 30), h('b', 'TAP'), h('small', `Line ${this.sync.i + 1} of ${p.lyrics.length} · or press Space`)),
        h('button.btn.wide', { onclick: () => this.stopSync() }, 'Done'));
    }
    p.lyrics.forEach((l, i) => {
      const inp = h('input.input', { type: 'text', value: l.text, placeholder: 'Lyric line', oninput: () => { l.text = inp.value; live(); }, onchange: done, onfocus: () => { if (store.sel?.id !== l.id) { store.sel = { type: 'lyric', id: l.id }; this.timeline.render(); this.mark(); } } });
      const row = h('div.lyric-row' + (store.sel?.type === 'lyric' && store.sel.id === l.id ? '.sel' : ''), { dataset: { id: l.id } },
        h('button.time', { title: 'Jump to this line', onclick: () => { this.player.pause(); this.player.seek(l.start + 0.01); store.select('lyric', l.id); } }, fmtTime(l.start)),
        inp,
        h('button.icon-btn.sm', { title: 'Start this line at the playhead', onclick: () => { const d = l.end - l.start; l.start = round3(this.player.time); l.end = round3(l.start + d); store.sortLyrics(); store.commit(); } }, icon('tap', 15)),
        h('button.icon-btn.sm', { title: 'Delete line', onclick: () => { p.lyrics.splice(p.lyrics.indexOf(l), 1); store.commit(); } }, icon('x', 15)));
      this.rows.push({ l, row }); list.append(row); void i;
    });
    const add = () => {
      const t = round3(this.player.time), l = { id: uid(), text: '', start: t, end: round3(t + 3) };
      p.lyrics.push(l); store.sortLyrics(); store.sel = { type: 'lyric', id: l.id }; store.commit();
      setTimeout(() => $(`.lyric-row[data-id="${l.id}"] input`)?.focus(), 30);
    };
    const exp = kind => {
      if (!p.lyrics.length) return toast('No lyrics to export', 'warn');
      downloadBlob(new Blob([kind === 'lrc' ? toLrc(p.lyrics, p.name) : toSrt(p.lyrics)], { type: 'text/plain;charset=utf-8' }), (p.name || 'lyrics') + '.' + kind);
    };
    setTimeout(() => this.mark());
    return h('div', null,
      h('div.btn-row', null,
        h('button.btn.primary', { onclick: () => this.editAllDialog() }, icon('edit', 16), p.lyrics.length ? 'Edit all' : 'Write / paste lyrics'),
        h('button.btn', { onclick: () => this.startSync(), title: 'Tap along with the song to time each line' }, icon('tap', 16), 'Tap to sync')),
      h('div.btn-row', null,
        h('button.btn.ghost', { onclick: () => this.lrcInput.click() }, icon('upload', 15), 'Import .lrc / .srt'),
        h('button.btn.ghost', { onclick: () => exp('lrc') }, icon('download', 15), '.lrc'),
        h('button.btn.ghost', { onclick: () => exp('srt') }, icon('download', 15), '.srt')),
      p.lyrics.length ? list : h('div.empty', null, icon('text', 28), h('b', 'No lyrics yet'), h('span', 'Write or paste your lyrics, then tap along with the song to sync them.')),
      h('button.btn.wide.ghost', { onclick: add }, icon('plus', 16), 'Add line at playhead'));
  }
  /** Highlights the line under the playhead (called on every time update). */
  mark() {
    if (this.tab !== 'lyrics' || !this.rows) return; const t = this.player.time;
    for (const { l, row } of this.rows) {
      row.classList.toggle('now', t >= l.start && t < l.end);
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
      return h('div', null, section('Lyric line', text('Text', x.text, v => x.text = v),
        h('div.inline-row', null, num('Start', x.start, v => { x.start = v; if (x.end <= v) x.end = v + 1; store.sortLyrics(); }), num('End', x.end, v => { x.end = Math.max(x.start + 0.2, v); }))), actions);
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
