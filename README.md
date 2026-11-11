# LYRICS Studio — offline video & lyric editor

A video editor that runs entirely on your device. Cut and join clips, add a song, put synced lyrics on the
video and pick an animated template. No login, no server, no upload, no internet connection needed.

## What it does

- **Edit video** — import videos, photos and music; split at the playhead, trim by dragging clip edges,
  drag to reorder, duplicate, delete, undo/redo. Per clip: speed (0.5×–4×), volume/mute, fill or fit,
  rotate, flip, colour filters, brightness/contrast/saturation and transitions (crossfade, dip, slide,
  push, zoom, wipe). Photos get an optional slow-zoom motion.
- **Lyrics** — write or paste lyrics, or import `.lrc` / `.srt`. *Tap to sync* times each line while the
  song plays. Edit text and timing in the list or drag lyric blocks on the timeline. Export `.lrc` / `.srt`.
- **Animated templates** — 12 looks (Aurora Karaoke, Neon Nights, Midnight Scroll, Pop Punch, Kinetic
  Type, Typewriter Noir, Cinematic, Caption Box, Word Highlight, Glitch EQ, Ocean Wave, Vinyl Session).
  Each sets an animated background, a lyric animation, fonts and finishing touches; everything can be
  adjusted in the Style tab (12 lyric animations, 9 animated backgrounds, 7 bundled fonts).
- **Formats** — 9:16, 16:9, 1:1 and 4:5.
- **Export** — rendered on-device with WebCodecs at 480p/720p/1080p, 24/30/60 fps, to MP4 (H.264) or
  WebM (VP9), depending on what the device can encode.
- **Storage** — projects and imported media are saved automatically in the browser's IndexedDB on the
  device.

## Run it

    npm start            # or: python3 -m http.server 8080

Open http://localhost:8080 in Chrome or Edge. After the first load the service worker has cached the whole
app, so it keeps working with the network switched off, and it can be installed ("Install app" / "Add to
Home screen"). Service workers need `localhost` or HTTPS.

There is no build step: `index.html`, `styles.css`, `js/`, `vendor/` and `fonts/` are the app.

    npm run check        # verifies all modules parse, the offline cache list is complete, no remote URLs

## Android APK

The **Build LYRICS Studio Android APK (offline web app)** workflow wraps these same files with Capacitor
and uploads a debug APK as a build artifact (run it from the Actions tab, or push to `main`). All assets are
inside the APK, so it opens without internet. Exported videos are written to `Documents/LyricsStudio/`.
This APK pipeline has not been run on a device yet — test it on a phone before relying on it.

`mobile/` contains an earlier native Flutter prototype with its own workflow; it is separate from this app.

## Shortcuts

Space play/pause (or tap in sync mode) · S split · Delete remove · Ctrl+Z / Ctrl+Shift+Z undo/redo ·
Ctrl+D duplicate · ←/→ step a frame (Shift: one second) · Ctrl+scroll zoom the timeline.

## Notes and limits

- Export needs a browser with WebCodecs (current Chrome, Edge, Android WebView). Which file types appear in
  the export dialog depends on the encoders the device has.
- A video can only be imported if the device's browser can play its codec.
- Clearing site data or uninstalling the app deletes local projects. Export videos you want to keep.
- Very long 1080p exports are held in memory until saved; use 720p on low-memory phones.

## Third-party files (bundled, no network use)

- `vendor/mediabunny.min.mjs` — Mediabunny (MPL-2.0), used for muxing/encoding. Licence in `vendor/`.
- `fonts/` — Inter, Poppins, Anton, Bebas Neue, Space Grotesk, Playfair Display, Pacifico (SIL Open Font
  License 1.1), from the Fontsource packages.
