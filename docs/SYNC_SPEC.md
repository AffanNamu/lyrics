# LYRICS Studio — lyric synchronization specification (v2)

This document is the single source of truth for how lyric timing is stored and displayed.
The browser app (`js/sync.js`) and the Android app (`mobile/lib/sync.dart`) implement it
independently, and **both are tested against the same fixtures** in `spec/sync-cases.json`.
If you change a rule here, change the fixtures, and both test suites must pass again.

## 1. Canonical data

All times are **integer milliseconds** on the song / project timeline.

```jsonc
// one lyric line
{ "id": "a1", "text": "First words", "startMs": 15200, "endMs": 18900 }
```

| field     | type          | meaning |
|-----------|---------------|---------|
| `startMs` | int ≥ 0 or `null` | When the line appears. **`null` means "not synced yet".** `0` is a real time (the song starts with vocals) and is never treated as "unsynced". |
| `endMs`   | int or `null` | Optional explicit end. `null` means "until the next line" (see §3). Ignored unless `endMs > startMs`. |

Project-level synchronization fields:

| field              | type | meaning |
|--------------------|------|---------|
| `schemaVersion`    | `2`  | Projects without it are migrated (§6). |
| `vocalStartMs`     | int or `null` | When the singer starts. Set manually or by accepted auto-detection. `null` = unknown. |
| `vocalStartSource` | `"manual"` \| `"detected"` \| `"none"` \| `null` | How `vocalStartMs` was set (`"none"` = user said the song starts with vocals at 0). |
| `detection`        | Detection result or `null` | Last automatic analysis (§5). Stored for display only; never applied without the user accepting it. |

## 2. Which lines are shown

Lines whose text is empty or whitespace are never displayed and are ignored by every rule below.

A line is **synced** when `startMs` is an integer ≥ 0. Synced times are always used exactly as stored.
Synced lines are never moved, re-spread or rescaled by the resolver.

Unsynced lines get a **provisional** time only when they can be placed safely, relative to synced lines
(the *anchors*) and `vocalStartMs`:

1. **Between two anchors** `p` and `q` (in list order, `q.startMs > p.startMs`) a run of *k* unsynced
   lines is spaced evenly: `p + (q − p) · j / (k + 1)`, j = 1…k.
2. **After the last anchor** `p` (or when the next anchor is not later than `p`):
   `p + j · PROVISIONAL_SPACING_MS`, j = 1…k.
3. **Before the first anchor** (leading lines):
   - if `vocalStartMs` is known: from `v = vocalStartMs`; up to the next anchor `q > v` they are spaced
     `v + (q − v) · j / k`, j = 0…k−1, otherwise `v + j · PROVISIONAL_SPACING_MS`;
   - if `vocalStartMs` is unknown: **they are not shown** (reported as *unplaced*).
     Lyrics are never invented at 0:00 during an instrumental intro.
4. Any line (synced or provisional) whose start is ≥ `durationMs` (when the duration is known, > 0)
   is unplaced.

So a project with lyrics but no timing and no vocal start shows no lyrics at all until the user sets the
vocal start or syncs a line. A project with a vocal start but no line timing shows the lyrics spread from the
vocal start (provisional), never from 0.

## 3. Display window ("cues")

Placed lines become *cues*, sorted by `startMs` (ties keep list order). For cue *i*:

- `limit` = start of the next cue (or none for the last cue).
- If the line has a valid explicit `endMs`: `end = min(endMs, limit)`.
- Otherwise: `end = min(limit, start + MAX_AUTO_HOLD_MS)`; for the last cue `end = start + MAX_AUTO_HOLD_MS`.
- If `durationMs` is known: `end = min(end, durationMs)`.
- A cue is **active** at time `t` iff `start ≤ t < end` (half-open). At most one cue is active.
  Before the first cue's start nothing is shown.

Constants: `MAX_AUTO_HOLD_MS = 8000`, `PROVISIONAL_SPACING_MS = 3500`, `MIN_LINE_MS = 200`.

## 4. Time base

- Browser: `t` is the project timeline time (the same clock that drives the preview and every exported
  frame at `frame / fps`). Imported audio placed later on the timeline shifts with it, and detection results
  are converted to timeline time before use.
- Android: `t` is the audio player's media position (`AudioPlayer.position`), which stays correct across
  seeking, pausing, resuming and playback-speed changes. Export writes the exact cue windows from §3 into
  the subtitle track, so the MP4 shows the same timing.

Both preview and export call the same resolver — there is no second timing path.

## 5. Automatic vocal-start detection result

```jsonc
{
  "version": 1,
  "algorithm": "yamnet-vocal-1",
  "vocalStartMs": 15360,       // null when no singing was found
  "confidence": 0.82,          // 0..1
  "level": "high",            // "high" | "medium" | "low" | "none"
  "candidates": [ { "ms": 15360, "score": 0.82 }, { "ms": 47040, "score": 0.41 } ],
  "analyzedMs": 210000
}
```

`level` drives the UI: only `high` is offered as "Use this time"; `medium`/`low` ask the user to listen and
confirm; `none` recommends manual sync. A result is never applied automatically.

## 6. Migration to schema v2

- **Browser v1** (`start` / `end` in seconds): `startMs = round(start · 1000)`, `endMs = round(end · 1000)`.
  Every v1 line was timed, so all stay synced.
- **Android v1** (`startMs`, default `0` for never-synced lines): `0` cannot be distinguished from
  "never synced", so every `startMs == 0` becomes `null`; other values are kept. `endMs = null`.
- `vocalStartMs = null`, `vocalStartSource = null`, `detection = null`, `schemaVersion = 2`.

## 7. LRC / SRT

- LRC import: each `[mm:ss.xx]` / `[mm:ss.xxx]` stamp becomes a synced line (a line with several stamps becomes
  several lines). Lines without a stamp are unsynced (`startMs: null`), never spread over the song. `[00:00.00]`
  is a real time. `[offset:±ms]` is applied (positive = earlier). Lines keep file order; when every line has a
  stamp they are sorted by time.
- SRT import: start and end are kept exactly (millisecond precision).
- LRC export writes only synced lines' stamps; unsynced lines are written without a stamp.
  SRT export writes resolved cues (§3), so it matches what the video shows.
