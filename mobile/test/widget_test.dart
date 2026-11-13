// Drives the Android studio UI with a fake audio clock and fake platform services.
import 'dart:typed_data';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lyrics_studio/export_ass.dart';
import 'package:lyrics_studio/main.dart';
import 'package:lyrics_studio/playback.dart';
import 'package:lyrics_studio/project.dart';
import 'package:lyrics_studio/services.dart';
import 'package:lyrics_studio/vocal_detector.dart';
import 'package:shared_preferences/shared_preferences.dart';

class FakeServices implements StudioServices {
  DetectionResult next = DetectionResult(vocalStartMs: 43000, confidence: 0.9, level: 'high', candidates: [Candidate(43000, 0.9, 'high'), Candidate(60000, 0.8, 'high')], analyzedMs: 180000);
  Project? rendered;
  String? renderedAss;
  @override
  Future<String?> pickAndCopy(FileType type, String folder, String baseName) async => '/fake/$folder/$baseName.mp3';
  @override
  Future<String?> pickTextFile() async => '[00:12.00]From file\n[00:14.50]Second';
  @override
  Future<String?> saveFile(String name, Uint8List bytes) async => '/fake/out/$name';
  @override
  Future<DetectionResult> detect(Project p, {void Function(double)? onProgress, bool Function()? cancelled}) async {
    onProgress?.call(0.5);
    return next;
  }

  @override
  Future<String> render(Project p, {required int durationMs, required String bgHex, required String accentHex, void Function(String)? onStatus}) async {
    rendered = p;
    renderedAss = buildAss(p);
    throw Exception('test stops before encoding');
  }
}

Finder listScroll() => find.descendant(of: find.byType(ListView).first, matching: find.byType(Scrollable)).first;

Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 60));
  }
}

Future<void> reveal(WidgetTester tester, Finder f) async {
  await tester.scrollUntilVisible(f, 250, scrollable: listScroll(), maxScrolls: 60);
  await tester.ensureVisible(f);
  await tester.pump(const Duration(milliseconds: 50));
}

Finder inPreview(String text) => find.descendant(of: find.byType(LyricPreview).first, matching: find.textContaining(text));

Future<(FakePlayback, FakeServices)> openStudio(WidgetTester tester, {String lyrics = 'First words\nSecond line\nThird line'}) async {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 2.5;
  addTearDown(tester.view.reset);
  final fake = FakePlayback(), svc = FakeServices();
  await tester.pumpWidget(LyricsApp(playback: () => fake, services: svc));
  await tester.pump(const Duration(milliseconds: 100));
  await tester.tap(find.text('Create a video project'));
  await settle(tester);
  await reveal(tester, find.byKey(const Key('importSong')));
  await tester.tap(find.byKey(const Key('importSong')));
  await settle(tester);
  await reveal(tester, find.byKey(const Key('editLyrics')));
  await tester.tap(find.byKey(const Key('editLyrics')));
  await settle(tester);
  await tester.enterText(find.byKey(const Key('lyricsText')), lyrics);
  await tester.tap(find.text('Save'));
  await settle(tester);
  return (fake, svc);
}

Future<void> seekTo(WidgetTester tester, FakePlayback fake, int ms) async {
  await fake.seek(Duration(milliseconds: ms));
  await tester.pump(const Duration(milliseconds: 50));
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('native studio opens', (tester) async {
    await tester.pumpWidget(LyricsApp(playback: FakePlayback.new, services: FakeServices()));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('LYRICS'), findsOneWidget);
    expect(find.text('Projects'), findsOneWidget);
    expect(find.text('Studio'), findsOneWidget);
    expect(find.text('Themes'), findsOneWidget);
  });

  testWidgets('pasted lyrics stay hidden during the intro; manual vocal start + tap sync', (tester) async {
    final (fake, _) = await openStudio(tester);
    expect(find.text('Not set'), findsOneWidget);
    await seekTo(tester, fake, 5000);
    expect(inPreview('First words'), findsNothing, reason: 'nothing may show before timing exists');
    expect(inPreview('hidden until timed'), findsOneWidget);

    await reveal(tester, find.byKey(const Key('tapStart')));
    await tester.tap(find.byKey(const Key('tapStart')));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('SINGER STARTS'), findsOneWidget);
    fake.advance(const Duration(milliseconds: 15200));
    await tester.tap(find.byKey(const Key('tapButton')));
    await tester.pump();
    expect(find.text('TAP'), findsOneWidget);
    fake.advance(const Duration(milliseconds: 3800));
    await tester.tap(find.byKey(const Key('tapButton')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('syncDone')));
    await settle(tester);

    expect(find.text('0:15.2'), findsWidgets);
    await seekTo(tester, fake, 15000);
    expect(inPreview('First words'), findsNothing, reason: 'still the intro at 15.0 s');
    expect(inPreview('Intro — lyrics start at 0:15.2'), findsOneWidget);
    await seekTo(tester, fake, 15600);
    expect(inPreview('First words'), findsOneWidget);
    await seekTo(tester, fake, 19400);
    expect(inPreview('Second line'), findsOneWidget);
    await seekTo(tester, fake, 23000);
    expect(inPreview('Third line'), findsOneWidget, reason: 'untimed last line follows at an estimated time');
    await seekTo(tester, fake, 10000);
    expect(inPreview('First words'), findsNothing, reason: 'seeking back into the intro hides lyrics again');

    await tester.tap(find.byTooltip('Undo'));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Not set'), findsOneWidget, reason: 'undo restores the state before syncing');
    await tester.tap(find.byTooltip('Redo'));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('0:15.2'), findsWidgets);
  });

  testWidgets('automatic detection is proposed, accepted, then adjusted', (tester) async {
    final (fake, svc) = await openStudio(tester);
    await reveal(tester, find.byKey(const Key('detect')));
    await tester.tap(find.byKey(const Key('detect')));
    await settle(tester);
    expect(find.text('Detected singing at 0:43.0'), findsOneWidget);
    expect(find.text('HIGH CONFIDENCE'), findsOneWidget);
    expect(find.text('Not set'), findsOneWidget, reason: 'never applied without the user');
    await seekTo(tester, fake, 44000);
    expect(inPreview('First words'), findsNothing);

    await tester.tap(find.text('Other guess (1:00.0)'));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Detected singing at 1:00.0'), findsOneWidget);
    await tester.tap(find.text('Other guess (0:43.0)'));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.tap(find.byKey(const Key('useDetected')));
    await settle(tester);
    expect(find.byKey(const Key('vocalStart')), findsOneWidget);
    expect((tester.widget(find.byKey(const Key('vocalStart'))) as Text).data, '0:43.0');
    await tester.tap(find.text('+0.1s'));
    await tester.pump(const Duration(milliseconds: 100));
    expect((tester.widget(find.byKey(const Key('vocalStart'))) as Text).data, '0:43.1');
    await seekTo(tester, fake, 43000);
    expect(inPreview('First words'), findsNothing);
    await seekTo(tester, fake, 43500);
    expect(inPreview('First words'), findsOneWidget);
    expect(svc.rendered, isNull);
  });

  testWidgets('low confidence asks the user to confirm', (tester) async {
    final (_, svc) = await openStudio(tester);
    svc.next = DetectionResult(vocalStartMs: 9000, confidence: 0.3, level: 'low', candidates: [Candidate(9000, 0.3, 'low')]);
    await reveal(tester, find.byKey(const Key('detect')));
    await tester.tap(find.byKey(const Key('detect')));
    await settle(tester);
    expect(find.text('LOW CONFIDENCE'), findsOneWidget);
    expect(find.text('Use anyway'), findsOneWidget);
    expect(find.textContaining('Not sure'), findsOneWidget);
  });

  testWidgets('export warns about untimed lines and passes the preview cues to the renderer', (tester) async {
    final (fake, svc) = await openStudio(tester);
    await reveal(tester, find.byKey(const Key('tapStart')));
    await tester.tap(find.byKey(const Key('tapStart')));
    await tester.pump(const Duration(milliseconds: 100));
    fake.advance(const Duration(seconds: 20));
    await tester.tap(find.byKey(const Key('tapButton')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('syncDone')));
    await settle(tester);
    // Remove the vocal start: lines 2-3 stay estimated from line 1, nothing is hidden.
    tester.state<ScaffoldMessengerState>(find.byType(ScaffoldMessenger)).clearSnackBars();
    await settle(tester);
    await reveal(tester, find.byKey(const Key('render')));
    await tester.tap(find.byKey(const Key('render')));
    await settle(tester);
    expect(svc.renderedAss, isNotNull);
    final starts = RegExp(r'Dialogue: 0,([0-9:.]+),').allMatches(svc.renderedAss!).map((m) => m.group(1)).toList();
    expect(starts, ['0:00:20.00', '0:00:23.50', '0:00:27.00']);
    expect(find.textContaining('Export failed'), findsOneWidget);
  });

  testWidgets('projects survive an app restart with their timing', (tester) async {
    final (fake, _) = await openStudio(tester);
    await reveal(tester, find.byKey(const Key('tapStart')));
    await tester.tap(find.byKey(const Key('tapStart')));
    await tester.pump(const Duration(milliseconds: 100));
    fake.advance(const Duration(milliseconds: 12345));
    await tester.tap(find.byKey(const Key('tapButton')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('syncDone')));
    await settle(tester);
    await tester.pumpWidget(const SizedBox());
    await tester.pumpWidget(LyricsApp(playback: FakePlayback.new, services: FakeServices()));
    await settle(tester);
    expect(find.textContaining('3 lines · 1 synced'), findsOneWidget);
    await tester.tap(find.text('Untitled project'));
    await settle(tester);
    expect((tester.widget(find.byKey(const Key('vocalStart'))) as Text).data, '0:12.3');
  });
}
