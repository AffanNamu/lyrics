# LYRICS — Your Private Music Studio

An offline-first music and synchronized-lyrics workspace for Android and the web. No account, backend, cloud API, or network connection is required for core features.

## Android APK

Every push to `main` that changes the app or Android build files triggers **Build LYRICS Android APK**. You can also start it manually from GitHub Actions using **Run workflow**. When the run succeeds, open its **Artifacts** section and download `lyrics-android-debug-apk`; install the included `app-debug.apk` on an Android phone. This is a debug-signed APK for direct testing, not a Play Store release build.

The Android app packages the HTML, CSS, JavaScript and artwork inside the APK. The app shell therefore opens without internet after installation. Imported audio, lyrics, timestamps and artwork remain on that device in its local IndexedDB storage. Uninstalling the app or clearing its storage can delete projects; export important .lrc files as backups.

## Features
- Import audio from your device and keep the audio file in local IndexedDB.
- Create lyric projects and edit multiline lyrics.
- Play, pause, seek, rewind and adjust volume.
- Timestamp the selected lyric line while listening.
- Review and remove line timings.
- Karaoke presentation with active-line highlighting.
- Export synchronized lyrics as standard .lrc.
- Search your library, sort projects and select a visual theme.
- Installable PWA with a service worker that caches the application shell.

## Run locally

    python -m http.server 8080

Open http://localhost:8080. For PWA installation and service-worker caching, use localhost or HTTPS. The Android build is generated with Capacitor by the workflow.

## Privacy and storage

Audio blobs, lyrics and timestamps are stored in the browser/app's IndexedDB on the current device. Theme preference is stored in localStorage. Nothing is uploaded. Clearing app/site data or uninstalling can delete local projects.

## Notes
- Audio playback depends on formats supported by the device's Android WebView/browser.
- The APK build produced by CI is debug-signed and intended for installation/testing, not Play Store publication.
- The current export format is .lrc; video rendering is not part of this build.
- Large audio files are subject to available device storage.
