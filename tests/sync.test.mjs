// Runs the shared synchronization fixtures against the browser implementation.  node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
globalThis.crypto ??= (await import('node:crypto')).webcrypto;
const sync = await import('../js/sync.js');
const { parseLyrics, toLrc, toSrt } = await import('../js/lyrics.js');
const F = JSON.parse(readFileSync(new URL('../spec/sync-cases.json', import.meta.url)));

test('constants match the spec', () => {
  assert.equal(sync.MAX_AUTO_HOLD_MS, F.constants.MAX_AUTO_HOLD_MS);
  assert.equal(sync.PROVISIONAL_SPACING_MS, F.constants.PROVISIONAL_SPACING_MS);
});
for (const c of F.resolve) {
  test('resolve: ' + c.name, () => {
    const lines = c.lines.map(([text, startMs, endMs], i) => ({ id: 'l' + i, text, startMs, endMs }));
    const r = sync.resolveCues(lines, { durationMs: c.durationMs ?? undefined, vocalStartMs: c.vocalStartMs });
    assert.deepEqual(r.cues.map(q => [q.index, q.startMs, q.endMs, q.synced]), c.cues);
    assert.deepEqual(r.unplaced, c.unplaced);
    for (const [t, want] of c.queries) assert.equal(sync.activeCue(r.cues, t)?.index ?? null, want, `t=${t}`);
  });
}
for (const c of F.migrateAndroidV1) test('migrate android v1: ' + c.name, () => {
  const m = sync.migrateAndroidV1({ lines: c.lines.map(([text, startMs]) => ({ text, startMs })) });
  assert.deepEqual(m.lines.map(l => l.startMs), c.expectStartMs);
  assert.equal(m.schemaVersion, 2);
});
for (const c of F.migrateWebV1) test('migrate web v1: ' + c.name, () => {
  const m = sync.migrateProject({ lyrics: c.lyrics.map(([text, start, end], i) => ({ id: 'x' + i, text, start, end })) });
  assert.deepEqual(m.lyrics.map(l => [l.startMs, l.endMs]), c.expect);
  assert.equal(m.schemaVersion, 2); assert.equal(m.vocalStartMs, null);
});
for (const c of F.parse) test('parse: ' + c.name, () => {
  assert.deepEqual(parseLyrics(c.text).map(l => [l.text, l.startMs, l.endMs]), c.expect);
});
test('LRC round trip keeps timestamps and never invents one', () => {
  const lines = parseLyrics('[00:00.00]Zero\n[00:15.20]Start\nUntimed');
  const back = parseLyrics(toLrc(lines));
  assert.deepEqual(back.map(l => [l.text, l.startMs]), [['Zero', 0], ['Start', 15200], ['Untimed', null]]);
});
test('SRT export uses resolved cues', () => {
  const { cues } = sync.resolveCues([{ id: 'a', text: 'A', startMs: 15000, endMs: null }, { id: 'b', text: 'B', startMs: 17500, endMs: 19000 }], { durationMs: 60000 });
  assert.equal(toSrt(cues), '1\n00:00:15,000 --> 00:00:17,500\nA\n\n2\n00:00:17,500 --> 00:00:19,000\nB\n');
});
test('applyVocalStart times the first lyric and follows later changes', () => {
  const p = { lyrics: [{ id: 'e', text: ' ', startMs: null, endMs: null }, { id: 'a', text: 'A', startMs: null, endMs: null }, { id: 'b', text: 'B', startMs: null, endMs: null }], vocalStartMs: null };
  sync.applyVocalStart(p, 15000, 'manual');
  assert.equal(p.lyrics[1].startMs, 15000); assert.equal(p.vocalStartSource, 'manual');
  sync.applyVocalStart(p, 15400, 'manual');   // adjusting moves the tied first line
  assert.equal(p.lyrics[1].startMs, 15400);
  p.lyrics[1].startMs = 16000;                // user re-timed the line by hand
  sync.applyVocalStart(p, 14000, 'detected');
  assert.equal(p.lyrics[1].startMs, 16000);   // an explicit, different timing is never overwritten
});
