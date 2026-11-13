// Vocal detector: model numerics against the shared test vector, plus onset-rule behaviour.  node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const V = await import('../js/vocal.js');
const C = JSON.parse(readFileSync(new URL('../spec/vocal-model-cases.json', import.meta.url)));
const buf = readFileSync(new URL('../models/vocal-yamnet-int8.bin', import.meta.url));
const model = V.loadModel(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
function signal() {
  const x = new Float32Array(C.samples);
  for (let n = 0; n < x.length; n++) x[n] = 0.3 * Math.sin(2 * Math.PI * 220 * n / 16000 + 3 * Math.sin(2 * Math.PI * 5 * n / 16000)) + 0.1 * Math.sin(2 * Math.PI * 1000 * n / 16000) + 0.05 * Math.sin(2 * Math.PI * 3150 * n / 16000 * (1 + n / 64000));
  return x;
}
test('log-mel front end matches the reference', () => {
  const mel = V.logMel(signal());
  assert.equal(mel.length / 64, C.melFrames);
  for (const [f, k, want] of C.melProbe) assert.ok(Math.abs(mel[f * 64 + k] - want) < C.tolerance.mel, `mel[${f},${k}] ${mel[f * 64 + k]} vs ${want}`);
});
test('network logits match the reference', () => {
  const mel = V.logMel(signal());
  C.patchLogits.forEach((want, i) => {
    const got = V.patchLogits(model, mel, i * V.PATCH_HOP_FRAMES);
    want.forEach((w, k) => assert.ok(Math.abs(got[k] - w) < C.tolerance.logit, `patch ${i} class ${k}: ${got[k]} vs ${w}`));
  });
});
const O = JSON.parse(readFileSync(new URL('../spec/vocal-onset-cases.json', import.meta.url)));
for (const c of O.cases) test('onset: ' + c.name, () => {
  const r = V.detectOnset(c.raw);
  assert.equal(r.vocalStartMs, c.expectMs); assert.equal(r.level, c.level);
  assert.ok(r.confidence >= 0 && r.confidence <= 1);
  if (r.level === 'none') assert.equal(r.candidates.length, 0); else assert.equal(r.candidates[0].ms, r.vocalStartMs);
});
test('onset: silence / flat input finds no singing', () => {
  assert.equal(V.detectOnset(new Array(300).fill(-12)).level, 'none');
  assert.equal(V.detectOnset([]).vocalStartMs, null);
});
