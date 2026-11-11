# LYRICS — Your Private Music Studio

An offline-first, installable music and synchronized-lyrics workspace. No account, backend, cloud API, or network connection is required for core features.

## Features
- Import audio from your device and keep the audio file in browser IndexedDB.
- Create lyric projects and edit multiline lyrics.
- Play, pause, seek, rewind and adjust volume.
- Timestamp the selected lyric line while listening.
- Review and remove line timings.
- Karaoke presentation with active-line highlighting.
- Export synchronized lyrics as standard .lrc.
- Search your library, sort projects and select a visual theme.
- Installable PWA with a service worker that caches the application shell.

## Run locally
The app uses browser APIs and should be served from localhost or HTTPS (required for service workers and PWA installation).

    python -m http.server 8080

Open http://localhost:8080. On a supported browser, use its Install App option. Once installed and the app shell has been cached, the studio opens offline.

## Privacy and storage
Audio blobs, lyrics and timestamps are stored in the browser's IndexedDB on the current device. Theme preference is stored in localStorage. Nothing is uploaded. Clearing browser site data or uninstalling/clearing app storage can delete local projects; export important .lrc files as backups.

## Browser notes
- Audio playback depends on formats supported by the device/browser.
- PWA installation and service-worker offline support require localhost or HTTPS.
- The current export format is .lrc; video rendering is not part of this initial build.
- Large audio files are subject to available browser/device storage.

## Project structure
- index.html — application structure
- styles.css — responsive visual system
- app.js — IndexedDB, audio player, lyrics editor and synchronization
- manifest.webmanifest — install metadata
- sw.js — offline application-shell cache
- assets/icon.svg — application icon
