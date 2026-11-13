// Offline export: renders every frame with the same compositor as the preview and encodes with WebCodecs
// through the bundled Mediabunny muxer. No server, no upload — the file is produced on this device.
import * as MB from '../vendor/mediabunny.min.mjs';
import { clamp } from './util.js';
import { layout, duration, cuesOf } from './store.js';
import { Renderer, levelAt } from './render.js';
import { audioBufferOf, mediaUrl } from './media.js';

const even = n => Math.max(2, Math.round(n / 2) * 2);
export const QUALITIES = { 720: 'HD 720p', 1080: 'Full HD 1080p', 480: 'Small 480p' };

/** Which container/codec combinations this device can encode. */
export async function exportFormats(w = 1280, h = 720) {
  if (typeof VideoEncoder === 'undefined') return [];
  const out = [], can = async (fn, c, o) => { try { return await fn(c, o); } catch { return false; } };
  const avc = await can(MB.canEncodeVideo, 'avc', { width: w, height: h });
  const aac = await can(MB.canEncodeAudio, 'aac'), opus = await can(MB.canEncodeAudio, 'opus');
  let wv = null; for (const c of ['vp9', 'vp8', 'av1']) if (await can(MB.canEncodeVideo, c, { width: w, height: h })) { wv = c; break; }
  if (avc && aac) out.push({ id: 'mp4', label: 'MP4 (H.264 + AAC)', ext: 'mp4', mime: 'video/mp4', video: 'avc', audio: 'aac' });
  if (wv && opus) out.push({ id: 'webm', label: `WebM (${wv.toUpperCase()} + Opus)`, ext: 'webm', mime: 'video/webm', video: wv, audio: 'opus' });
  if (avc && !aac) out.push({ id: 'mp4', label: 'MP4 (H.264' + (opus ? ' + Opus' : ', no audio') + ')', ext: 'mp4', mime: 'video/mp4', video: 'avc', audio: opus ? 'opus' : null });
  return out;
}

/**
 * Mixes all clip audio + soundtrack into one buffer on the project timeline. Returns null when the project is silent.
 * Also used by vocal detection (at 16 kHz mono) so detection hears exactly what the exported video contains.
 */
export async function mixAudio(project, media, dur, onStep, { rate = 48000, channels = 2 } = {}) {
  const L = layout(project), jobs = [];
  for (const e of L) {
    const c = e.clip; if (c.kind !== 'video' || c.muted || c.volume <= 0) continue;
    jobs.push({ m: media.get(c.mediaId), start: e.start, off: c.in, len: c.out - c.in, rate: c.speed, vol: c.volume, fi: 0, fo: 0 });
  }
  for (const a of project.audio) jobs.push({ m: media.get(a.mediaId), start: a.start, off: a.in, len: a.out - a.in, rate: 1, vol: a.volume, fi: a.fadeIn, fo: a.fadeOut });
  if (!jobs.length) return null;
  const ctx = new OfflineAudioContext(channels, Math.max(1, Math.ceil(dur * rate)), rate); let any = false;
  for (const j of jobs) {
    if (!j.m) continue;
    onStep?.('Reading audio: ' + j.m.name);
    const buf = await audioBufferOf(j.m); if (!buf) continue;
    const src = ctx.createBufferSource(), g = ctx.createGain(), tl = j.len / j.rate;
    src.buffer = buf; src.playbackRate.value = j.rate; src.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(j.fi > 0 ? 0 : j.vol, j.start);
    if (j.fi > 0) g.gain.linearRampToValueAtTime(j.vol, j.start + Math.min(j.fi, tl));
    if (j.fo > 0) { g.gain.setValueAtTime(j.vol, Math.max(j.start, j.start + tl - j.fo)); g.gain.linearRampToValueAtTime(0, j.start + tl); }
    src.start(j.start, j.off, j.len); any = true;
  }
  if (!any) return null;
  onStep?.('Mixing audio');
  return ctx.startRendering();
}

function sliceBuffer(buf, from, to) {
  const n = to - from, out = new AudioBuffer({ length: n, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(from, to), c);
  return out;
}

/** Frame access for one source video during export: fast WebCodecs decode, with <video> seeking as fallback. */
class FrameSource {
  constructor(m) { this.m = m; this.iters = new Map(); this.last = null; }
  async init() {
    try {
      this.input = new MB.Input({ source: new MB.BlobSource(this.m.blob), formats: MB.ALL_FORMATS });
      const track = await this.input.getPrimaryVideoTrack();
      if (track && await track.canDecode()) { this.sink = new MB.CanvasSink(track, { poolSize: 3 }); this.first = await track.getFirstTimestamp(); }
    } catch { this.sink = null; }
    if (!this.sink) {
      const v = this.video = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = mediaUrl(this.m);
      await new Promise((res, rej) => { v.addEventListener('loadeddata', res, { once: true }); v.addEventListener('error', () => rej(new Error('Cannot decode ' + this.m.name)), { once: true }); });
    }
  }
  /** Declare upfront which timestamps a clip will ask for (enables sequential decoding). */
  plan(clipId, times) { if (this.sink) this.iters.set(clipId, this.sink.canvasesAtTimestamps(times.map(t => Math.max(t, this.first || 0)))); }
  async frame(clipId, time) {
    if (this.sink) {
      const r = await this.iters.get(clipId).next();
      if (r.value) this.last = { img: r.value.canvas, w: r.value.canvas.width, h: r.value.canvas.height };
      return this.last;
    }
    const v = this.video, want = clamp(time, 0, Math.max(0, v.duration - 0.03));
    if (Math.abs(v.currentTime - want) > 0.001) {
      await new Promise(res => { const tm = setTimeout(res, 4000); v.addEventListener('seeked', () => { clearTimeout(tm); res(); }, { once: true }); v.currentTime = want; });
    }
    return { img: v, w: v.videoWidth, h: v.videoHeight };
  }
  async close() {
    for (const it of this.iters.values()) { try { await it.return(); } catch { /* already finished */ } }
    try { this.input?.dispose?.(); } catch { /* ignore */ }
    if (this.video) { this.video.removeAttribute('src'); this.video.load(); }
  }
}

function loadImage(m) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res({ img: im, w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => rej(new Error('Cannot read ' + m.name)); im.src = mediaUrl(m); });
}

/**
 * Renders the project to a video Blob.
 * @param opts {height, fps, format (from exportFormats), bitrate?}
 * @param hooks {onProgress(fraction, label), onFrame(canvas), signal: {cancelled}}
 */
export async function exportProject(project, media, opts, hooks = {}) {
  const dur = duration(project);
  if (dur <= 0) throw new Error('Add a video, photo or song before exporting');
  const fps = opts.fps || 30, fmt = opts.format, short = Math.min(project.width, project.height), sc = (opts.height || 1080) / short;
  const W = even(project.width * sc), H = even(project.height * sc), total = Math.max(1, Math.round(dur * fps));
  const step = (f, label) => hooks.onProgress?.(f, label);
  const cancelled = () => { if (hooks.signal?.cancelled) throw Object.assign(new Error('Export cancelled'), { cancelled: true }); };

  step(0, 'Preparing audio');
  const mixed = fmt.audio ? await mixAudio(project, media, dur, l => step(0, l)) : null;
  cancelled();

  // Frame schedule: which clip + source time each output frame needs.
  const L = layout(project), sched = new Array(total), plans = new Map();
  for (let i = 0; i < total; i++) {
    const t = i / fps; let e = L.find(x => t >= x.start && t < x.end) || null;
    if (e) { const st = e.clip.in + (t - e.start) * e.clip.speed; sched[i] = { e, st }; if (e.clip.kind === 'video') { if (!plans.has(e.clip.id)) plans.set(e.clip.id, []); plans.get(e.clip.id).push(st); } }
  }
  const sources = new Map(), images = new Map();
  step(0, 'Opening media');
  for (const e of L) {
    const m = media.get(e.clip.mediaId); if (!m) continue;
    if (e.clip.kind === 'image') { if (!images.has(m.id)) images.set(m.id, await loadImage(m)); }
    else if (plans.has(e.clip.id)) {
      // One decoder per clip keeps sequential access simple even when a source is reused.
      const fs = new FrameSource(m); await fs.init(); fs.plan(e.clip.id, plans.get(e.clip.id)); sources.set(e.clip.id, fs);
    }
  }
  cancelled();

  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false }), renderer = new Renderer();
  const output = new MB.Output({
    format: fmt.id === 'mp4' ? new MB.Mp4OutputFormat({ fastStart: 'in-memory' }) : new MB.WebMOutputFormat(),
    target: new MB.BufferTarget(),
  });
  const bitrate = opts.bitrate || Math.round(W * H * fps * 0.11);
  const vsrc = new MB.CanvasSource(canvas, { codec: fmt.video, bitrate, keyFrameInterval: 2 });
  output.addVideoTrack(vsrc, { frameRate: fps });
  let asrc = null;
  if (mixed) { asrc = new MB.AudioBufferSource({ codec: fmt.audio, bitrate: 160000 }); output.addAudioTrack(asrc); }
  const cues = cuesOf(project).cues;   // identical timing to the preview
  let current = null, audioPos = 0; const chunk = mixed ? mixed.sampleRate : 0;

  try {
    await output.start();
    for (let i = 0; i < total; i++) {
      cancelled();
      const t = i / fps, s = sched[i]; current = null;
      if (s) {
        const c = s.e.clip;
        current = c.kind === 'image' ? images.get(c.mediaId) : await sources.get(c.id)?.frame(c.id, s.st);
      }
      renderer.render(ctx, W, H, project, t, () => current, { level: levelAt(project, media, t), dur, cues });
      await vsrc.add(t, 1 / fps);
      while (asrc && audioPos < mixed.length && audioPos / mixed.sampleRate <= t + 1) {
        const to = Math.min(mixed.length, audioPos + chunk); await asrc.add(sliceBuffer(mixed, audioPos, to)); audioPos = to;
      }
      if (i % 3 === 0) { step((i + 1) / total, `Rendering frame ${i + 1} of ${total}`); hooks.onFrame?.(canvas); await new Promise(r => setTimeout(r)); }
    }
    while (asrc && audioPos < mixed.length) { const to = Math.min(mixed.length, audioPos + chunk); await asrc.add(sliceBuffer(mixed, audioPos, to)); audioPos = to; }
    step(1, 'Finishing file');
    await output.finalize();
  } catch (err) {
    try { await output.cancel(); } catch { /* ignore */ }
    throw err;
  } finally {
    for (const fs of sources.values()) await fs.close();
  }
  return { blob: new Blob([output.target.buffer], { type: fmt.mime }), width: W, height: H, fps, duration: dur, ext: fmt.ext };
}

/** Saves the result: native folder inside the Android app, otherwise a normal browser download. */
export async function saveVideo(blob, name) {
  const cap = window.Capacitor, FS = cap?.Plugins?.Filesystem;
  if (cap?.isNativePlatform?.() && FS) {
    const path = 'LyricsStudio/' + name, size = 512 * 1024;
    const b64 = buf => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
    for (let off = 0, first = true; off < blob.size; off += size, first = false) {
      const data = b64(await blob.slice(off, off + size).arrayBuffer());
      if (first) await FS.writeFile({ path, data, directory: 'DOCUMENTS', recursive: true }); else await FS.appendFile({ path, data, directory: 'DOCUMENTS' });
    }
    return 'Saved to Documents/' + path;
  }
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return 'Saved to your downloads as ' + name;
}
