// App shell: project gallery, editor wiring, autosave, keyboard shortcuts and the export dialog.
import { h, $, icon, fmtTime, fmtBytes, toast, modal, confirmDialog } from './util.js';
import * as db from './db.js';
import { store, newProject, duration, ASPECTS } from './store.js';
import { Player } from './player.js';
import { Timeline } from './timeline.js';
import { Panels, TABS } from './panels.js';
import { applyTemplate, TEMPLATES } from './templates.js';
import { releaseUrls, dropBuffers } from './media.js';
import { FONTS } from './lyricfx.js';
import { migrateProject } from './sync.js';

const home = $('#home'), editor = $('#editor');
let player, timeline, panels, saveTimer, opening = false;

// ---- Home / project gallery ---------------------------------------------------
function ago(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 90) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago'; if (s < 86400 * 30) return Math.round(s / 86400) + ' d ago';
  return new Date(ts).toLocaleDateString();
}
async function renderHome() {
  const grid = $('#projectGrid'); let list = [];
  try { list = await db.listProjects(); } catch (e) { console.error(e); toast('Local storage is unavailable in this browser', 'error'); }
  $('#projectCount').textContent = list.length || '';
  const cards = list.map(rec => h('article.project-card', { tabIndex: 0, onclick: () => openProject(rec.id), onkeydown: e => { if (e.key === 'Enter') openProject(rec.id); } },
    h('div.project-thumb', { style: { backgroundImage: rec.thumb ? `url(${rec.thumb})` : '' } }, !rec.thumb && icon('film', 30), h('span.badge', null, rec.data.aspect)),
    h('div.project-meta', null,
      h('div', null, h('b', rec.data.name), h('small', `${fmtTime(duration(rec.data), false)} · edited ${ago(rec.updatedAt)}`)),
      h('button.icon-btn.sm', { title: 'Delete project', onclick: async e => {
        e.stopPropagation();
        if (!await confirmDialog('Delete this project?', `“${rec.data.name}” and its imported media will be removed from this device.`)) return;
        await db.deleteProject(rec.id); renderHome(); toast('Project deleted');
      } }, icon('trash', 15)))));
  grid.replaceChildren(h('button.project-card.new', { onclick: newProjectDialog }, h('span.plus', null, icon('plus', 26)), h('b', 'New project'), h('small', 'Start from a blank timeline')), ...cards);
  const est = await db.storageEstimate();
  $('#storageInfo').textContent = est?.usage != null ? `${fmtBytes(est.usage)} used on this device · projects are stored locally and never uploaded` : 'Projects are stored locally on this device and never uploaded';
}

function newProjectDialog() {
  let aspect = '9:16', tpl = TEMPLATES[0].id;
  modal(close => {
    const name = h('input.input', { type: 'text', placeholder: 'My lyric video', maxLength: 60 });
    const opts = h('div.aspect-grid');
    const draw = () => opts.replaceChildren(...Object.entries(ASPECTS).map(([k, v]) =>
      h('button.aspect' + (k === aspect ? '.on' : ''), { type: 'button', onclick: () => { aspect = k; draw(); } },
        h('i', { style: { aspectRatio: `${v[0]} / ${v[1]}` } }), h('b', k), h('small', v[2]))));
    draw();
    const tsel = h('select.input', { onchange: e => tpl = e.target.value }, TEMPLATES.map(t => h('option', { value: t.id }, `${t.name} — ${t.tag}`)));
    const create = async () => {
      const p = newProject(name.value.trim(), aspect); applyTemplate(p, tpl);
      await db.putProject({ id: p.id, updatedAt: p.updatedAt, thumb: '', data: p });
      close(); openProject(p.id);
    };
    name.addEventListener('keydown', e => { if (e.key === 'Enter') create(); });
    setTimeout(() => name.focus(), 30);
    return h('div', null, h('h3', 'New project'),
      h('label.field', null, h('span.field-top', null, h('span', 'Name')), name),
      h('span.field-label', 'Format'), opts,
      h('label.field', null, h('span.field-top', null, h('span', 'Animated template')), tsel),
      h('div.modal-actions', null, h('button.btn', { onclick: close }, 'Cancel'), h('button.btn.primary', { onclick: create }, 'Create project')));
  });
}

// ---- Editor --------------------------------------------------------------------
async function openProject(id) {
  if (opening) return; opening = true;
  try {
    const rec = await db.getProject(id); if (!rec) return toast('Project not found', 'error');
    const media = await db.listMedia(id);
    home.hidden = true; editor.hidden = false; document.body.classList.remove('panel-open');
    store.load(migrateProject(rec.data), media);
    $('#projectName').value = rec.data.name;
    player.resize(); player.seek(0); player.start();
    timeline.fitted = false; timeline.fit();
    panels.tab = media.length ? 'templates' : 'media';
    if (matchMedia('(min-width: 900px)').matches) panels.open(panels.tab); else setRail(null);
    updateChrome(); history.replaceState(null, '', '#' + id);
  } finally { opening = false; }
}
async function closeProject() {
  await saveNow(); player.stop(); panels.sync = null;
  store.project = null; releaseUrls(); dropBuffers();
  editor.hidden = true; home.hidden = false; history.replaceState(null, '', location.pathname); renderHome();
}
async function saveNow() {
  clearTimeout(saveTimer); const p = store.project; if (!p) return;
  try {
    if (!player.playing) player.draw();
    await db.putProject({ id: p.id, updatedAt: p.updatedAt, thumb: player.snapshot(), data: JSON.parse(JSON.stringify(p)) });
    $('#saveState').textContent = 'Saved on device';
  } catch (e) { console.error(e); $('#saveState').textContent = 'Could not save'; toast('Could not save — device storage may be full', 'error'); }
}
function scheduleSave() { $('#saveState').textContent = 'Saving…'; clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 700); }

function setRail(tab) { for (const b of document.querySelectorAll('#rail button')) b.classList.toggle('on', b.dataset.tab === tab); }
function updateChrome() {
  const p = store.project; if (!p) return; const d = duration(p);
  $('#undoBtn').disabled = !store.undoStack.length; $('#redoBtn').disabled = !store.redoStack.length;
  $('#timeNow').textContent = fmtTime(player.time); $('#timeDur').textContent = fmtTime(d);
  const has = !!store.findSel();
  $('#dupBtn').disabled = !has; $('#delBtn').disabled = !has; $('#exportBtn').disabled = d <= 0;
  $('#stageEmpty').hidden = d > 0 || p.lyrics.length > 0;
}
function setPlayIcon(on) { $('#playBtn').replaceChildren(icon(on ? 'pause' : 'play', 22)); $('#playBtn').title = on ? 'Pause (Space)' : 'Play (Space)'; }

function initEditor() {
  player = new Player($('#preview'));
  timeline = new Timeline($('#timeline'), player);
  panels = new Panels($('#panel'), player, timeline);
  timeline.onEdit = () => panels.open('edit');
  panels.onTab = setRail;
  player.onTime = t => { $('#timeNow').textContent = fmtTime(t); timeline.setTime(t); panels.mark(); };
  player.onState = on => { setPlayIcon(on); if (!on && panels.sync) panels.stopSync(); };

  const rail = $('#rail');
  for (const [id, label, ic] of TABS) rail.append(h('button', { dataset: { tab: id }, onclick: () => {
    if (document.body.classList.contains('panel-open') && panels.tab === id && !matchMedia('(min-width: 900px)').matches) panels.close(); else panels.open(id);
  } }, icon(ic, 20), h('span', label)));

  store.on(what => {
    if (!store.project) return;
    if (what === 'load') { timeline.render(); return; }
    if (what === 'project' || what === 'live') {
      if (player.time > duration(store.project)) player.seek(duration(store.project));
      player.resize(); player.invalidate();
      if (what === 'project') scheduleSave();
    }
    timeline.render(); updateChrome();
  });

  const btn = (id, ic, fn, size = 18) => { const b = $(id); b.prepend(icon(ic, size)); b.addEventListener('click', fn); };
  btn('#backBtn', 'back', closeProject, 20);
  btn('#undoBtn', 'undo', () => store.undo());
  btn('#redoBtn', 'redo', () => store.redo());
  btn('#exportBtn', 'download', exportDialog);
  btn('#startBtn', 'start', () => player.seek(0));
  btn('#endBtn', 'end', () => { player.pause(); player.seek(player.duration); });
  $('#playBtn').addEventListener('click', () => player.toggle()); setPlayIcon(false);
  btn('#splitBtn', 'split', () => { if (!store.splitAt(player.time)) toast('Move the playhead inside a clip to split it', 'warn'); });
  btn('#dupBtn', 'copy', () => store.duplicateSel());
  btn('#delBtn', 'trash', () => store.deleteSel());
  btn('#editBtn', 'sliders', () => panels.open('edit'));
  btn('#zoomOutBtn', 'zoomOut', () => timeline.zoom(1 / 1.4));
  btn('#zoomInBtn', 'zoomIn', () => timeline.zoom(1.4));
  btn('#fitBtn', 'fit', () => timeline.fit());
  $('#stageEmpty').addEventListener('click', () => panels.fileInput.click());
  $('#projectName').addEventListener('change', e => { store.project.name = e.target.value.trim() || 'Untitled video'; e.target.value = store.project.name; store.commit(); });

  // Drag & drop files anywhere on the editor.
  editor.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); editor.classList.add('dropping'); } });
  editor.addEventListener('dragleave', e => { if (!editor.contains(e.relatedTarget)) editor.classList.remove('dropping'); });
  editor.addEventListener('drop', e => { e.preventDefault(); editor.classList.remove('dropping'); if (e.dataTransfer?.files?.length) panels.importFiles([...e.dataTransfer.files]); });

  document.addEventListener('keydown', e => {
    if (editor.hidden || document.querySelector('.modal-back')) return;
    const typing = e.target.matches('input:not([type=range]):not([type=checkbox]):not([type=color]), textarea, select');
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); if (typing) e.target.blur(); e.shiftKey ? store.redo() : store.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); store.redo(); return; }
    if (typing) return;
    if (e.code === 'Space') { e.preventDefault(); if (e.repeat) return; panels.sync ? panels.tapSync() : player.toggle(); }
    else if (mod && k === 'd') { e.preventDefault(); store.duplicateSel(); }
    else if (mod && k === 's') { e.preventDefault(); saveNow(); }
    else if (k === 's' && !mod) store.splitAt(player.time);
    else if (k === 'delete' || k === 'backspace') { if (store.deleteSel()) e.preventDefault(); }
    else if (k === 'arrowleft' || k === 'arrowright') { e.preventDefault(); player.pause(); player.seek(player.time + (k === 'arrowleft' ? -1 : 1) * (e.shiftKey ? 1 : 1 / 30)); }
    else if (k === 'home') player.seek(0);
    else if (k === 'end') player.seek(player.duration);
    else if (k === 'escape') store.select(null);
  });
  window.addEventListener('pagehide', () => { if (store.project) saveNow(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && store.project) { player.pause(); saveNow(); } });
}

// ---- Export dialog ------------------------------------------------------------
async function exportDialog() {
  const p = store.project; if (!p || duration(p) <= 0) return;
  player.pause(); await saveNow();
  const ex = await import('./exporter.js');
  const formats = await ex.exportFormats(p.width, p.height);
  const opts = { height: 1080, fps: 30, format: formats[0] }, signal = { cancelled: false };
  const m = modal(close => {
    const root = h('div.export');
    const setup = () => {
      if (!formats.length) return root.replaceChildren(h('h3', 'Export is not available here'),
        h('p.muted', 'This browser cannot encode video on-device. Open the app in a current version of Chrome, Edge or the Android app and try again. Your project is safe.'),
        h('div.modal-actions', null, h('button.btn', { onclick: close }, 'Close')));
      const pick = (label, items, key) => {
        const box = h('div.chips');
        const draw = () => box.replaceChildren(...items.map(([v, l]) => h('button.chip' + (opts[key] === v ? '.on' : ''), { type: 'button', onclick: () => { opts[key] = v; draw(); } }, l)));
        draw(); return h('div.field', null, h('span.field-top', null, h('span', label)), box);
      };
      root.replaceChildren(h('h3', 'Export video'),
        h('p.muted', `${fmtTime(duration(p), false)} · ${p.aspect} · rendered entirely on this device, no internet needed.`),
        pick('Resolution', [[1080, '1080p'], [720, '720p'], [480, '480p']], 'height'),
        pick('Frame rate', [[24, '24 fps'], [30, '30 fps'], [60, '60 fps']], 'fps'),
        pick('File type', formats.map(f => [f, f.label]), 'format'),
        h('div.modal-actions', null, h('button.btn', { onclick: close }, 'Cancel'), h('button.btn.primary', { onclick: run }, icon('download', 16), 'Export')));
    };
    const run = async () => {
      const cv = h('canvas.export-preview', { width: 2, height: 2 }), bar = h('i'), label = h('p.muted', 'Starting…'), pct = h('b', '0%');
      root.replaceChildren(h('h3', 'Exporting…'), cv, h('div.progress', null, bar), h('div.progress-row', null, label, pct),
        h('p.hint', 'Keep this screen open until the export finishes.'),
        h('div.modal-actions', null, h('button.btn', { onclick: () => { signal.cancelled = true; } }, 'Cancel export')));
      const started = performance.now(); let wake = null;
      try { wake = await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
      try {
        const res = await ex.exportProject(p, store.media, opts, {
          signal,
          onProgress: (f, l) => { bar.style.width = (f * 100).toFixed(1) + '%'; pct.textContent = Math.round(f * 100) + '%'; label.textContent = l; },
          onFrame: c => { if (cv.width !== 2 && cv.width * c.height !== cv.height * c.width) cv.width = 2; if (cv.width === 2) { const s = 360 / Math.max(c.width, c.height); cv.width = Math.round(c.width * s); cv.height = Math.round(c.height * s); } cv.getContext('2d').drawImage(c, 0, 0, cv.width, cv.height); },
        });
        const name = (p.name || 'video').replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.' + res.ext, url = URL.createObjectURL(res.blob);
        const file = new File([res.blob], name, { type: res.blob.type }), canShare = !!navigator.canShare?.({ files: [file] });
        const note = h('p.muted', `${res.width}×${res.height} · ${res.fps} fps · ${fmtBytes(res.blob.size)} · took ${Math.round((performance.now() - started) / 1000)}s`);
        const save = async () => { try { toast(await ex.saveVideo(res.blob, name)); } catch (e) { console.error(e); toast('Could not save the file: ' + e.message, 'error'); } };
        root.replaceChildren(h('h3', 'Your video is ready'), h('video.export-preview', { src: url, controls: true, playsInline: true }), note,
          h('div.modal-actions', null, h('button.btn', { onclick: () => { URL.revokeObjectURL(url); close(); } }, 'Done'),
            canShare && h('button.btn', { onclick: () => navigator.share({ files: [file], title: p.name }).catch(() => {}) }, icon('share', 16), 'Share'),
            h('button.btn.primary', { onclick: save }, icon('download', 16), 'Save video')));
        save();
      } catch (e) {
        if (e.cancelled) { close(); toast('Export cancelled'); return; }
        console.error(e);
        root.replaceChildren(h('h3', 'Export failed'), h('p.muted', e.message || String(e)), h('p.hint', 'Try a lower resolution or a different file type.'),
          h('div.modal-actions', null, h('button.btn', { onclick: close }, 'Close'), h('button.btn.primary', { onclick: () => { signal.cancelled = false; setup(); } }, 'Back to settings')));
      } finally { try { wake?.release(); } catch { /* ignore */ } }
    };
    setup(); return root;
  }, { dismiss: false });
  void m;
}

// ---- Boot --------------------------------------------------------------------------
async function boot() {
  initEditor();
  $('#newProjectBtn').addEventListener('click', newProjectDialog);
  $('#newProjectBtn').prepend(icon('plus', 18));
  const net = () => { $('#netState').textContent = navigator.onLine ? 'Works offline' : 'Offline — fully working'; };
  window.addEventListener('online', net); window.addEventListener('offline', net); net();
  db.requestPersistence();
  // Bundled fonts must be ready before the canvas draws text.
  const loads = []; for (const [name, f] of Object.entries(FONTS)) for (const w of f.weights) loads.push(document.fonts.load(`${w} 32px "${name}"`));
  Promise.allSettled(loads).then(() => player?.invalidate());
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(console.warn);
  await renderHome();
  const id = location.hash.slice(1); if (id && await db.getProject(id).catch(() => null)) openProject(id);
}
boot();
