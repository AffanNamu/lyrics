// Web Worker: runs the vocal model on a range of log-mel patches. Keeps the UI thread free.
import { loadModel, patchLogits, PATCH_HOP_FRAMES } from './vocal.js';
let model = null;
self.onmessage = e => {
  const d = e.data;
  if (d.model) { model = loadModel(d.model); self.postMessage({ ready: true }); return; }
  const { job, mel, count } = d, out = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const z = patchLogits(model, mel, i * PATCH_HOP_FRAMES);
    let m = -Infinity; for (let k = 0; k < z.length; k++) if (z[k] > m) m = z[k];
    out[i] = m;
  }
  self.postMessage({ job, out }, [out.buffer]);
};
