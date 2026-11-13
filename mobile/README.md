# LYRICS Studio — native Android (Flutter)

Offline lyric-video studio for Android. No account, no network needed.

## Features
- Projects saved on the phone (schema v2, migrated automatically from older versions), undo / redo.
- Import a song; play, seek, ±5 s, playback speed 0.5×–1.25×.
- **Lyric sync:** pasted lyrics stay hidden until timed. *Tap when singer starts* (first tap = vocal start), tap
  through the rest of the lines, or sync from any line. Per line: set at playhead, ±0.1 s, custom end or
  "end with next line", replay, delete. *Song starts with vocals*, nudges, preview, reset.
- **Automatic vocal-start detection** on the phone (`lib/vocal_detector.dart`, same model and rule as the browser;
  decoded with FFmpegKit, analysed in background isolates). Shows a confidence level; only applied when you accept.
- **Live preview** that shows exactly the cue the video will show at the current playback position.
- **Style:** 4 lyric animations (clean fade, karaoke fill, pop bounce, caption box), 7 bundled fonts, size,
  vertical position, uppercase, text and highlight colours, 5 animated themes or your own photo (with slow drift
  and darkening).
- Import `.lrc` / `.srt`; save `.lrc` / `.srt`.
- **MP4 export** (1080×1920, 30 fps, H.264/AAC) with FFmpegKit; subtitle windows are the same resolved cues as the
  preview (`lib/export_ass.dart`); the finished video can be saved anywhere with the system file dialog.

## Shared with the browser app
`lib/sync.dart` (docs/SYNC_SPEC.md), `lib/lyrics_format.dart`, `lib/vocal_detector.dart` implement the same rules
as `js/sync.js`, `js/lyrics.js` and `js/vocal.js`, and are tested against the same fixtures in `../spec/`.

## Browser-only (for now)
Multi-clip video editing (split / trim / reorder clips, transitions, filters, speed per clip), background video,
the 12 canvas templates and 9 procedural backgrounds, word-highlight / neon / glitch / scrolling lyric styles,
and 9:16 / 16:9 / 1:1 / 4:5 formats. They depend on the browser's canvas + WebCodecs pipeline; on Android the
equivalent needs a frame-by-frame renderer, which is planned work rather than a quick port.

## Build and test
    cd mobile
    flutter pub get
    flutter analyze
    flutter test          # sync fixtures, formats, vocal model + onset, export, UI flows (fake clock)
    flutter build apk --debug

## Licensing
The renderer uses FFmpegKit full-gpl (GPL-3.0): distributed binaries must meet GPL obligations. The vocal model
is derived from YAMNet (Apache-2.0, `assets/models/NOTICE.md`). Fonts are SIL OFL 1.1 (`assets/fonts/OFL-*.txt`).
