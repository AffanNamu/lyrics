// Automatic vocal-start detection — runs fully on the device, no network.
//
// Model: YAMNet (Google, tensorflow/models research/audioset/yamnet, Apache-2.0), an AudioSet sound-event
// classifier with explicit Singing / Choir / Rapping / A capella classes. We ship its convolution weights with
// batch-norm folded in and int8 per-channel quantization (models/vocal-yamnet-int8.bin, ~3.3 MB) and only the
// voice-class outputs. Inference is implemented here in plain JS (no ML runtime) and mirrored exactly in
// mobile/lib/vocal_detector.dart; both are checked against spec/vocal-model-cases.json.
//
// Pipeline: mono 16 kHz audio -> log-mel patches (0.96 s, hop 0.48 s) -> per-patch "singing" log-odds ->
// onset rule (detectOnset) -> {vocalStartMs, confidence, level, candidates}. See docs/VOCAL_DETECTION.md.

export const SAMPLE_RATE = 16000;
const WIN = 400, HOP = 160, NFFT = 512, MELS = 64, PATCH = 96;
export const PATCH_HOP_FRAMES = 48;          // 0.48 s
export const PATCH_HOP_SEC = PATCH_HOP_FRAMES * HOP / SAMPLE_RATE;
export const ALGORITHM = 'yamnet-vocal-1';

// ---- model loading --------------------------------------------------------------------------------------------
export function loadModel(buffer) {
  const u8 = new Uint8Array(buffer), dv = new DataView(buffer);
  if (String.fromCharCode(...u8.subarray(0, 4)) !== 'YVD1') throw new Error('Not a vocal model file');
  const n = dv.getUint32(4, true), meta = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + n))), base = 8 + n;
  const layers = meta.layers.map(m => {
    const q = new Int8Array(buffer, base + m.w, m.rows * m.cols);
    const sc = new Float32Array(buffer.slice(base + m.scale, base + m.scale + m.cols * 4));
    const bias = new Float32Array(buffer.slice(base + m.bias, base + m.bias + m.cols * 4));
    const w = new Float32Array(m.rows * m.cols);
    for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) w[r * m.cols + c] = q[r * m.cols + c] * sc[c];
    return { kind: m.kind, stride: m.stride, rows: m.rows, cols: m.cols, w, bias };
  });
  return { layers, classes: meta.classes };
}

// ---- log-mel front end (matches YAMNet features.py) ----------------------------------------------------------
let MEL = null, HANN = null, TW = null;
function setup() {
  if (MEL) return;
  HANN = new Float32Array(WIN);
  for (let i = 0; i < WIN; i++) HANN[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / WIN);
  const hz2mel = f => 1127 * Math.log1p(f / 700), nb = NFFT / 2 + 1;
  const lo = hz2mel(125), hi = hz2mel(7500), edges = [];
  for (let i = 0; i < MELS + 2; i++) edges.push(lo + (hi - lo) * i / (MELS + 1));
  MEL = new Float32Array(nb * MELS);                      // row = spectrogram bin, col = mel band; bin 0 is zero
  for (let b = 1; b < nb; b++) {
    const m = hz2mel((SAMPLE_RATE / 2) * b / (nb - 1));
    for (let k = 0; k < MELS; k++) {
      const l = edges[k], c = edges[k + 1], u = edges[k + 2];
      MEL[b * MELS + k] = Math.max(0, Math.min((m - l) / (c - l), (u - m) / (u - c)));
    }
  }
  TW = new Float64Array(NFFT); for (let i = 0; i < NFFT / 2; i++) { TW[2 * i] = Math.cos(-2 * Math.PI * i / NFFT); TW[2 * i + 1] = Math.sin(-2 * Math.PI * i / NFFT); }
}
function fft(re, im) {                                     // in-place radix-2, length NFFT
  const n = NFFT;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1, step = n / len;
    for (let i = 0; i < n; i += len) for (let k = 0; k < half; k++) {
      const wr = TW[2 * k * step], wi = TW[2 * k * step + 1], a = i + k, b = a + half;
      const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
      re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
    }
  }
}
/** Log-mel spectrogram, frames x 64 (row-major). */
export function logMel(x) {
  setup();
  const frames = x.length < WIN ? 0 : 1 + Math.floor((x.length - WIN) / HOP), out = new Float32Array(frames * MELS);
  const re = new Float64Array(NFFT), im = new Float64Array(NFFT), mag = new Float64Array(NFFT / 2 + 1);
  for (let f = 0; f < frames; f++) {
    re.fill(0); im.fill(0);
    for (let i = 0; i < WIN; i++) re[i] = x[f * HOP + i] * HANN[i];
    fft(re, im);
    for (let b = 0; b <= NFFT / 2; b++) mag[b] = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
    for (let k = 0; k < MELS; k++) {
      let s = 0; for (let b = 1; b <= NFFT / 2; b++) { const w = MEL[b * MELS + k]; if (w) s += mag[b] * w; }
      out[f * MELS + k] = Math.log(s + 0.001);
    }
  }
  return out;
}

// ---- network ---------------------------------------------------------------------------------------------------
const same = (n, s) => { const o = Math.ceil(n / s), tot = Math.max((o - 1) * s + 3 - n, 0); return [o, tot >> 1]; };
function conv3(x, H, W, C, L, depthwise) {
  const s = L.stride, [OH, pt] = same(H, s), [OW, pl] = same(W, s), O = depthwise ? C : L.cols;
  const out = new Float32Array(OH * OW * O), w = L.w, b = L.bias;
  for (let oy = 0; oy < OH; oy++) for (let ox = 0; ox < OW; ox++) {
    const o0 = (oy * OW + ox) * O;
    for (let o = 0; o < O; o++) out[o0 + o] = b[o];
    for (let ky = 0; ky < 3; ky++) {
      const iy = oy * s + ky - pt; if (iy < 0 || iy >= H) continue;
      for (let kx = 0; kx < 3; kx++) {
        const ix = ox * s + kx - pl; if (ix < 0 || ix >= W) continue;
        const tap = (ky * 3 + kx) * O, i0 = (iy * W + ix) * C;
        if (depthwise) for (let c = 0; c < C; c++) out[o0 + c] += x[i0 + c] * w[tap + c];
        else { const xv = x[i0]; for (let o = 0; o < O; o++) out[o0 + o] += xv * w[tap + o]; }   // first layer: C = 1
      }
    }
    for (let o = 0; o < O; o++) if (out[o0 + o] < 0) out[o0 + o] = 0;
  }
  return [out, OH, OW, O];
}
function pointwise(x, P, C, L) {
  // 1x1 convolution = (P x C) * (C x O). Four input channels per pass quarters the read/write traffic on the
  // accumulator row; zero inputs (ReLU) are skipped.
  const O = L.cols, out = new Float32Array(P * O), w = L.w, b = L.bias, idx = new Int32Array(C), val = new Float32Array(C);
  for (let p = 0; p < P; p++) {
    const o0 = p * O, i0 = p * C;
    let nz = 0;
    for (let c = 0; c < C; c++) { const v = x[i0 + c]; if (v !== 0) { idx[nz] = c * O; val[nz++] = v; } }
    const acc = out.subarray(o0, o0 + O); acc.set(b);
    let k = 0;
    for (; k + 4 <= nz; k += 4) {
      const r0 = idx[k], r1 = idx[k + 1], r2 = idx[k + 2], r3 = idx[k + 3], v0 = val[k], v1 = val[k + 1], v2 = val[k + 2], v3 = val[k + 3];
      for (let o = 0; o < O; o++) acc[o] += v0 * w[r0 + o] + v1 * w[r1 + o] + v2 * w[r2 + o] + v3 * w[r3 + o];
    }
    for (; k < nz; k++) { const r = idx[k], v = val[k]; for (let o = 0; o < O; o++) acc[o] += v * w[r + o]; }
    for (let o = 0; o < O; o++) if (acc[o] < 0) acc[o] = 0;
  }
  return out;
}
/** Voice-class logits for one 96-frame patch starting at frame `f0` of a log-mel matrix. */
export function patchLogits(model, mel, f0) {
  let x = mel.subarray(f0 * MELS, (f0 + PATCH) * MELS), H = PATCH, W = MELS, C = 1;
  for (const L of model.layers) {
    if (L.kind === 'conv' || L.kind === 'dw') [x, H, W, C] = conv3(x, H, W, C, L, L.kind === 'dw');
    else if (L.kind === 'pw') { x = pointwise(x, H * W, C, L); C = L.cols; }
    else {
      const emb = new Float32Array(C), P = H * W;
      for (let p = 0; p < P; p++) for (let c = 0; c < C; c++) emb[c] += x[p * C + c];
      const out = new Float32Array(L.cols);
      for (let o = 0; o < L.cols; o++) { let s = L.bias[o]; for (let c = 0; c < C; c++) s += (emb[c] / P) * L.w[c * L.cols + o]; out[o] = s; }
      return out;
    }
  }
  throw new Error('model has no output layer');
}

// ---- onset rule --------------------------------------------------------------------------------------------------
// Tuned and evaluated on 104 real test songs (MUSDB18 test tracks with vocal-stem ground truth, plus loud long-intro,
// quiet-vocal and instrumental-only variants). See docs/VOCAL_DETECTION.md for the numbers.
export const ONSET = { loP: 20, hiP: 70, k: 0.6, W: 8, need: 5, offMs: 300, postN: 20, selectFloor: -6.0, noneBelow: -7.0 };
export const LEVELS = { high: { post: -4.6, contrast: 1.5, cover: 0.6 }, medium: { post: -5.2, contrast: 1.0, cover: 0.6 } };
function percentile(sorted, p) {                       // numpy 'linear' definition
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * p / 100, lo = Math.floor(pos), hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
const median = a => { const s = Array.from(a).sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
/** Per-patch singing evidence: max voice-class logit, 3-tap median smoothed. */
export function smoothSeries(raw) {
  const out = new Float64Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = median(Array.prototype.slice.call(raw, Math.max(0, i - 1), i + 2));
  return out;
}
export function levelOf(f) {
  if (!f || f.post < ONSET.noneBelow) return 'none';
  for (const lv of ['high', 'medium']) { const L = LEVELS[lv]; if (f.post >= L.post && f.contrast >= L.contrast && f.cover >= L.cover) return lv; }
  return 'low';
}
// A 0..1 score that orders results inside a level (high 0.75-1, medium 0.5-0.75, low 0.15-0.45, none 0).
function scoreOf(f, lv) {
  if (lv === 'none') return 0;
  const m = Math.max(0, Math.min(1, (f.post + 7) / 4)) * 0.5 + Math.max(0, Math.min(1, f.contrast / 4)) * 0.3 + Math.max(0, Math.min(1, f.cover)) * 0.2;
  const [lo, hi] = lv === 'high' ? [0.75, 1] : lv === 'medium' ? [0.5, 0.75] : [0.15, 0.45];
  return Math.round((lo + (hi - lo) * m) * 100) / 100;
}
/**
 * Finds when singing starts.
 *  1. Candidate rises: the first patch of every sustained run above a song-relative threshold.
 *  2. The first candidate whose following ~10 s has enough absolute singing evidence is chosen.
 *  3. Confidence comes from the absolute evidence after the onset, the contrast with what came before and how
 *     consistently the singing continues. Low-evidence results are reported as low/none, never as certain.
 * @param raw per-patch max voice logit (patch i covers [i*0.48 s, i*0.48 s + 0.96 s])
 */
export function detectOnset(raw, P = ONSET) {
  const s = smoothSeries(raw), n = s.length;
  const result = { version: 1, algorithm: ALGORITHM, vocalStartMs: null, confidence: 0, level: 'none', candidates: [], analyzedMs: n ? Math.round((n - 1) * PATCH_HOP_SEC * 1000 + 960) : 0 };
  if (n < P.W) return result;
  const sorted = Array.from(s).sort((a, b) => a - b);
  const B = percentile(sorted, P.loP), V = percentile(sorted, P.hiP), th = B + P.k * (V - B);
  const starts = [];
  let run = 0; const above = Array.from(s, v => v > th);
  for (let i = 0; i < P.W; i++) run += above[i];
  for (let i = 0; i + P.W <= n; i++) {
    if (i > 0) run += above[i + P.W - 1] - above[i - 1];
    if (above[i] && run >= P.need && (!starts.length || i - starts[starts.length - 1] > 2 * P.W)) starts.push(i);
  }
  if (!starts.length) return result;
  const feats = i => {
    const post = s.subarray(i, i + P.postN), pre = s.subarray(0, i), pm = median(post);
    let cov = 0; for (const v of post) if (v > th) cov++;
    return { post: pm, contrast: pm - (pre.length >= 4 ? median(pre) : B), cover: cov / post.length };
  };
  const F = starts.map(feats);
  let pick = F.findIndex(f => f.post >= P.selectFloor); if (pick < 0) pick = 0;
  const order = [pick, ...starts.map((_, j) => j).filter(j => j !== pick)].slice(0, 3);
  result.candidates = order.map(j => { const lv = levelOf(F[j]); return { ms: Math.round(starts[j] * PATCH_HOP_FRAMES * 10 + P.offMs), score: scoreOf(F[j], lv), level: lv }; });
  const best = result.candidates[0];
  result.level = best.level;
  result.confidence = best.score;
  result.vocalStartMs = best.level === 'none' ? null : best.ms;
  if (best.level === 'none') result.candidates = [];
  return result;
}

/**
 * Analyzes mono 16 kHz audio. Yields to the caller between patches so a UI stays responsive.
 * @returns DetectionResult (see docs/SYNC_SPEC.md §5) plus `series` (per-patch logits) for display.
 */
export async function analyzeVocalStart(model, mono, { onProgress, signal, yieldEvery = 4 } = {}) {
  const mel = logMel(mono), frames = mel.length / MELS;
  const count = frames < PATCH ? 0 : 1 + Math.floor((frames - PATCH) / PATCH_HOP_FRAMES), raw = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    if (signal?.cancelled) throw Object.assign(new Error('Analysis cancelled'), { cancelled: true });
    const z = patchLogits(model, mel, i * PATCH_HOP_FRAMES); let m = -Infinity;
    for (let k = 0; k < z.length; k++) if (z[k] > m) m = z[k];
    raw[i] = m;
    if (i % yieldEvery === 0) { onProgress?.((i + 1) / count); await new Promise(r => setTimeout(r)); }
  }
  onProgress?.(1);
  return { ...detectOnset(raw), series: Array.from(raw, v => Math.round(v * 1000) / 1000) };
}
