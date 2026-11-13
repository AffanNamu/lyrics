# Automatic vocal-start detection

LYRICS Studio can estimate when the singer starts. It is an **assistant**: the result is shown with a
confidence level, the user can listen to it, pick another guess, adjust it in ±0.1 s / ±0.5 s steps, or reject it.
It is never applied without the user, and manual "tap when the singer starts" is always available.

Everything runs on the device (browser: Web Workers; Android: Dart isolates). No audio is uploaded.

## Why not silence detection

Instrumental intros are often loud (drums, guitars, synths), so "first loud moment" is not "first sung word".
We measured simple signal features against real vocal tracks (per-song AUC, 0.5 = chance):
stereo-centre energy 0.64, harmonicity 0.42, pitch-fluctuation 0.52, syllable-rate modulation 0.54,
loudness 0.83 — loudness is the best of them and is exactly the approach that fails on loud intros.

## Model

**YAMNet** (Google, `tensorflow/models/research/audioset/yamnet`, Apache-2.0), a MobileNet-v1 sound-event
classifier trained on AudioSet with explicit *Singing*, *Choir*, *Rapping*, *A capella* … classes.
Its *Singing* output reached a median per-song AUC of **0.91** on the same songs, while its *Speech* output was
at chance (0.50) — it responds to singing, not to loudness or any voice-like sound.

- Our own inference code (`js/vocal.js`, `mobile/lib/vocal_detector.dart`), no ML runtime dependency.
  Verified layer-by-layer against TensorFlow ops (max error ~2e-5 in float).
- Batch-norm folded, int8 per-channel weights, only the 6 voice outputs kept: `models/vocal-yamnet-int8.bin`,
  3.3 MB (vs 15 MB original). Quantization changes the voice logits by ~0.05–0.5 (singing vs. none differs by ~5).
- Input: mono 16 kHz, log-mel patches of 0.96 s every 0.48 s.
- Alternatives considered: training a classifier on public multitrack sets (licences are research/non-commercial,
  so weights derived from them were not shipped); ONNX/TFLite runtimes (8–10 MB extra on the web and a native
  dependency on Android, for the same model); source separation models (40–80 MB, minutes per song on a phone).

## Onset rule and confidence

Per patch: evidence = max voice-class logit, 3-tap median smoothing. Candidates = first patch of each sustained
run above a song-relative threshold (20th + 0.6 × (70th − 20th) percentile; ≥ 5 of 8 patches). The first
candidate whose next ~10 s has a median logit ≥ −6.0 is chosen. Confidence from the absolute evidence after the
onset, its contrast with what came before, and how consistently it continues:

| level  | rule (median logit after onset, contrast, share above threshold) | UI |
|--------|------------------------------------------------------------------|----|
| high   | ≥ −4.6, ≥ 1.5, ≥ 60 %                                            | "Use this time" |
| medium | ≥ −5.2, ≥ 1.0, ≥ 60 %                                            | "Probably right — listen first", "Use anyway" |
| low    | otherwise                                                        | "Not sure — listen and confirm, or tap it yourself" |
| none   | median < −7.0 or no candidate                                    | "No singing found" |

## Evaluation (real songs)

Test material: 26 songs from the MUSDB18 test set (rock, pop, folk, electronic, metal, ballads; used for
evaluation only). Ground truth = first sustained activity in the isolated vocal stem, cross-checked with
MUSDB's human word-level lyric annotations (e.g. 17.05 s stem onset vs 17.57 s first annotated word).
Harder variants built from the stems: **long intro** (20–45 s of the song's loudest instrumental-only passage
prepended), **quiet vocals** (−10 dB), **instrumental** (no vocals at all).

Results of the shipped rule (104 cases, "within" = distance to the true vocal start):

| level  | results | within 2 s | wrong | notes |
|--------|---------|------------|-------|-------|
| high   | 20      | 19 (17 within 1 s) | 1 (2.3 s off) | never produced for instrumental tracks |
| medium | 25      | 18         | 7     | 2 of the 7 are instrumental tracks |
| low    | 48      | 11         | 37    | shown as "not sure"; 17 are instrumental tracks |
| none   | 11      | —          | —     | 7 correct (instrumental), 4 missed (quiet vocals) |

- Original songs: 22 / 26 within 2 s (18 within 1 s); every *high* result was correct.
- The thresholds above were calibrated on these 104 cases. Held-out (2-fold cross-validated) accuracy of the
  locating step alone was 58 % within 1 s and 69 % within 2 s — expect numbers in that range on new music.
- The shipped JavaScript (int8 model) was also run end-to-end on decoded audio: original songs — high 9/9
  within 2 s; long-intro songs — high 6/7, medium 6/7 within 1 s. Browser test: a song with a 43.0 s intro was
  detected at 43.5 s with high confidence.

Known weaknesses: lead instruments that "sing" (guitar, synth, sax lines) can be mistaken for a voice, quiet or
heavily processed vocals are often reported as low/none, and spoken intros may be detected as singing.

## Speed

~57 ms per patch in desktop JS (one thread) — about 24 s for a 4-minute song on one core; the browser spreads
the work over up to 4 Web Workers, Android over up to 4 isolates. Phone speed depends on the CPU.

## Shared tests

- `spec/vocal-model-cases.json`: a deterministic test signal with reference log-mel values and logits.
- `spec/vocal-onset-cases.json`: 28 real per-patch evidence curves with the expected result and level.

Both are run by `tests/vocal.test.mjs` (browser) and `mobile/test/vocal_test.dart` (Android); the JS port also
matched the reference rule on all 104 evaluation curves.
