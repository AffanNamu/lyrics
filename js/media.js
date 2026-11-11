// Importing local files: probes duration/size, makes a thumbnail and audio waveform peaks. Nothing leaves the device.
import { uid } from './util.js';

const urls = new Map();
export function mediaUrl(m) {
  if (!urls.has(m.id)) urls.set(m.id, URL.createObjectURL(m.blob));
  return urls.get(m.id);
}
export function releaseUrls() { for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear(); }

export function kindOf(file) {
  const t = file.type || '', n = file.name.toLowerCase();
  if (t.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv|3gp)$/.test(n)) return 'video';
  if (t.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus)$/.test(n)) return 'audio';
  if (t.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif|bmp)$/.test(n)) return 'image';
  return null;
}

const once = (el, ok, ms = 15000) => new Promise((res, rej) => {
  const done = () => { clearTimeout(tm); res(); }, fail = () => { clearTimeout(tm); rej(new Error('This file could not be read by the browser')); };
  const tm = setTimeout(fail, ms);
  el.addEventListener(ok, done, { once: true }); el.addEventListener('error', fail, { once: true });
});

function thumbOf(src, w, h, max = 240) {
  const s = Math.min(1, max / Math.max(w, h)), c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(w * s)); c.height = Math.max(2, Math.round(h * s));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}

let actx;
export function audioContext() { return actx || (actx = new (window.AudioContext || window.webkitAudioContext)()); }

/** Decodes the audio of a media file (cached). Returns null if it has no decodable audio. */
const buffers = new Map();
export async function audioBufferOf(m) {
  if (buffers.has(m.id)) return buffers.get(m.id);
  let buf = null;
  try { buf = await audioContext().decodeAudioData(await m.blob.arrayBuffer()); } catch { buf = null; }
  buffers.set(m.id, buf); return buf;
}
export function dropBuffers() { buffers.clear(); }

function peaksOf(buf) {
  const step = Math.floor(buf.sampleRate / 50), n = Math.ceil(buf.length / step), out = new Uint8Array(n);
  const a = buf.getChannelData(0), b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : a;
  for (let i = 0; i < n; i++) {
    let mx = 0; const end = Math.min(buf.length, (i + 1) * step);
    for (let j = i * step; j < end; j += 8) { const v = Math.max(Math.abs(a[j]), Math.abs(b[j])); if (v > mx) mx = v; }
    out[i] = Math.min(255, Math.round(mx * 255));
  }
  return out;
}

export async function importFile(file, projectId) {
  const kind = kindOf(file);
  if (!kind) throw new Error('Unsupported file type: ' + file.name);
  const m = { id: uid(), projectId, name: file.name, kind, blob: file, size: file.size, duration: 0, width: 0, height: 0, thumb: '', peaks: null, addedAt: Date.now() };
  const url = mediaUrl(m);
  if (kind === 'image') {
    const img = new Image(); img.src = url; await once(img, 'load');
    m.width = img.naturalWidth; m.height = img.naturalHeight; m.duration = 4; m.thumb = thumbOf(img, m.width, m.height);
  } else if (kind === 'video') {
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    await once(v, 'loadedmetadata');
    if (!Number.isFinite(v.duration)) { v.currentTime = 1e7; await once(v, 'seeked'); }
    m.duration = v.duration; m.width = v.videoWidth; m.height = v.videoHeight;
    if (!m.width || !m.duration) throw new Error('This video format is not supported on this device');
    v.currentTime = Math.min(0.4, m.duration / 3); await once(v, 'seeked');
    if (v.readyState < 2) await once(v, 'loadeddata').catch(() => {});
    m.thumb = thumbOf(v, m.width, m.height); v.removeAttribute('src'); v.load();
  } else {
    const buf = await audioBufferOf(m);
    if (buf) { m.duration = buf.duration; m.peaks = peaksOf(buf); }
    else {
      const a = new Audio(); a.preload = 'metadata'; a.src = url; await once(a, 'loadedmetadata'); m.duration = a.duration;
      if (!Number.isFinite(m.duration)) throw new Error('This audio format is not supported on this device');
    }
  }
  return m;
}
