// Browser orchestration for vocal-start detection: renders the project's audio exactly as it will be exported
// (timeline positions, trims, fades), resamples to 16 kHz mono, and runs the model in Web Workers.
import { logMel, detectOnset, loadModel, patchLogits, PATCH_HOP_FRAMES, SAMPLE_RATE } from './vocal.js';
import { duration } from './store.js';
import { mixAudio } from './exporter.js';

const MODEL_URL = 'models/vocal-yamnet-int8.bin', MELS = 64, PATCH = 96, JOB = 12;
let modelBuf = null;
async function modelBuffer() {
  if (!modelBuf) {
    const r = await fetch(MODEL_URL);
    if (!r.ok) throw new Error('The vocal model file is missing from this installation');
    modelBuf = await r.arrayBuffer();
  }
  return modelBuf;
}

async function runInWorkers(buf, mel, count, onProgress, signal) {
  const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
  const workers = [];
  try { for (let i = 0; i < n; i++) workers.push(new Worker(new URL('./vocal-worker.js', import.meta.url), { type: 'module' })); }
  catch { workers.forEach(w => w.terminate()); return null; }
  const out = new Float64Array(count), jobs = [];
  for (let s = 0; s < count; s += JOB) jobs.push([s, Math.min(count, s + JOB)]);
  let done = 0, next = 0;
  try {
    await new Promise((resolve, reject) => {
      const feed = w => {
        if (signal?.cancelled) return reject(Object.assign(new Error('Analysis cancelled'), { cancelled: true }));
        if (next >= jobs.length) { if (done === count) resolve(); return; }
        const job = next++, [a, b] = jobs[job];
        const slice = mel.slice(a * PATCH_HOP_FRAMES * MELS, ((b - 1) * PATCH_HOP_FRAMES + PATCH) * MELS);
        w.postMessage({ job, mel: slice, count: b - a }, [slice.buffer]);
      };
      workers.forEach(w => {
        w.onerror = ev => reject(new Error(ev.message || 'Worker failed'));
        w.onmessage = ev => {
          if (ev.data.ready) { feed(w); return; }
          const [a] = jobs[ev.data.job]; out.set(ev.data.out, a); done += ev.data.out.length;
          onProgress(done / count); feed(w);
        };
        w.postMessage({ model: buf.slice(0) });
      });
    });
  } finally { workers.forEach(w => w.terminate()); }
  return out;
}

async function runInline(buf, mel, count, onProgress, signal) {
  const model = loadModel(buf.slice(0)), out = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    if (signal?.cancelled) throw Object.assign(new Error('Analysis cancelled'), { cancelled: true });
    const z = patchLogits(model, mel, i * PATCH_HOP_FRAMES); let m = -Infinity;
    for (let k = 0; k < z.length; k++) if (z[k] > m) m = z[k];
    out[i] = m;
    if (i % 4 === 0) { onProgress((i + 1) / count); await new Promise(r => setTimeout(r)); }
  }
  return out;
}

/** Detects when singing starts in the project's soundtrack. Times are project-timeline milliseconds. */
export async function detectProject(project, media, { onProgress = () => {}, signal } = {}) {
  const dur = duration(project);
  onProgress(0, 'Preparing audio…');
  const mixed = await mixAudio(project, media, dur, null, { rate: SAMPLE_RATE, channels: 1 });
  if (!mixed) throw new Error('This project has no audio to analyse');
  if (signal?.cancelled) throw Object.assign(new Error('Analysis cancelled'), { cancelled: true });
  const buf = await modelBuffer();
  onProgress(0.02, 'Reading the music…');
  await new Promise(r => setTimeout(r));
  const mel = logMel(mixed.getChannelData(0)), frames = mel.length / MELS;
  const count = frames < PATCH ? 0 : 1 + Math.floor((frames - PATCH) / PATCH_HOP_FRAMES);
  const prog = f => onProgress(0.05 + 0.95 * f, 'Listening for vocals…');
  const series = (await runInWorkers(buf, mel, count, prog, signal)) || (await runInline(buf, mel, count, prog, signal));
  return { ...detectOnset(series), series: Array.from(series, v => Math.round(v * 1000) / 1000) };
}
