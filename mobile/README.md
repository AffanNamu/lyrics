# LYRICS Studio — native Android

This is the native Flutter Android application. The legacy web prototype remains outside the mobile directory; it is not the Android product.

## Implemented foundation
- Native Flutter interface and bottom navigation.
- Offline project metadata and local audio copies.
- Local playback, seek controls and lyric-line timestamp capture.
- Five animated theme presets with live previews.
- MP4 rendering integration using FFmpegKit and ASS subtitle overlays.

## Build
    cd mobile
    flutter pub get
    flutter analyze
    flutter test
    flutter build apk --debug

## Important rendering and licensing notes
The renderer uses FFmpegKit with GPL components. Any distributed binary must satisfy the package's GPL-3.0 obligations, including required license notices and corresponding source availability. Confirm licensing before distributing or publishing the APK.

The first video renderer uses portrait 1080x1920, 30 fps, animated background filters, ASS captions and AAC audio. Device performance and codec availability vary. The initial build stores output in app-private storage; an export-to-Gallery workflow and render progress/cancellation are follow-up work.

Projects and copied songs are stored on the device. Clearing app data or uninstalling removes them. There is no account or cloud backend.
