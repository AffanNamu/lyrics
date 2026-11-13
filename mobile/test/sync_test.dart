// Runs the shared synchronization fixtures (spec/sync-cases.json) against the Android implementation.
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:lyrics_studio/lyrics_format.dart';
import 'package:lyrics_studio/project.dart';
import 'package:lyrics_studio/sync.dart';

void main() {
  final f = jsonDecode(File('../spec/sync-cases.json').readAsStringSync()) as Map<String, dynamic>;
  test('constants match the spec', () {
    expect(maxAutoHoldMs, f['constants']['MAX_AUTO_HOLD_MS']);
    expect(provisionalSpacingMs, f['constants']['PROVISIONAL_SPACING_MS']);
  });
  for (final c in (f['resolve'] as List).cast<Map<String, dynamic>>()) {
    test('resolve: ${c['name']}', () {
      final lines = <LyricLine>[];
      final raw = c['lines'] as List;
      for (var i = 0; i < raw.length; i++) {
        final l = raw[i] as List;
        lines.add(LyricLine(id: 'l$i', text: l[0] as String, startMs: l[1] as int?, endMs: l[2] as int?));
      }
      final r = resolveCues(lines, durationMs: c['durationMs'] as int?, vocalStartMs: c['vocalStartMs'] as int?);
      expect(r.cues.map((q) => [q.index, q.startMs, q.endMs, q.synced]).toList(), c['cues']);
      expect(r.unplaced, c['unplaced']);
      for (final q in (c['queries'] as List).cast<List>()) {
        expect(activeCue(r.cues, q[0] as int)?.index, q[1], reason: 't=${q[0]}');
      }
    });
  }
  for (final c in (f['migrateAndroidV1'] as List).cast<Map<String, dynamic>>()) {
    test('migrate android v1: ${c['name']}', () {
      final p = Project.fromJson({'id': 'x', 'title': 'old', 'lines': (c['lines'] as List).map((l) => {'text': l[0], 'startMs': l[1]}).toList()});
      expect(p.lines.map((l) => l.startMs).toList(), c['expectStartMs']);
      expect(p.vocalStartMs, isNull);
      expect(p.toJson()['schemaVersion'], 2);
    });
  }
  for (final c in (f['parse'] as List).cast<Map<String, dynamic>>()) {
    test('parse: ${c['name']}', () {
      expect(parseLyrics(c['text'] as String).map((l) => [l.text, l.startMs, l.endMs]).toList(), c['expect']);
    });
  }
  test('LRC round trip keeps timestamps and never invents one', () {
    final back = parseLyrics(toLrc(parseLyrics('[00:00.00]Zero\n[00:15.20]Start\nUntimed')));
    expect(back.map((l) => [l.text, l.startMs]).toList(), [['Zero', 0], ['Start', 15200], ['Untimed', null]]);
  });
  test('SRT export uses resolved cues (identical text to the browser)', () {
    final r = resolveCues([LyricLine(id: 'a', text: 'A', startMs: 15000), LyricLine(id: 'b', text: 'B', startMs: 17500, endMs: 19000)], durationMs: 60000);
    expect(toSrt(r.cues), '1\n00:00:15,000 --> 00:00:17,500\nA\n\n2\n00:00:17,500 --> 00:00:19,000\nB\n');
  });
  test('applyVocalStart times the first lyric and follows later changes', () {
    final p = Project('p', 't', lines: [LyricLine(id: 'e', text: ' '), LyricLine(id: 'a', text: 'A'), LyricLine(id: 'b', text: 'B')]);
    p.applyVocalStart(15000, 'manual');
    expect(p.lines[1].startMs, 15000);
    p.applyVocalStart(15400, 'manual');
    expect(p.lines[1].startMs, 15400);
    p.lines[1].startMs = 16000;
    p.applyVocalStart(14000, 'detected');
    expect(p.lines[1].startMs, 16000);
  });
  test('project save/reopen keeps synchronization exactly', () {
    final p = Project('p', 't', durationMs: 90000, lines: [LyricLine(id: 'a', text: 'A', startMs: 0), LyricLine(id: 'b', text: 'B', startMs: 15234, endMs: 18000), LyricLine(id: 'c', text: 'C')]);
    p.applyVocalStart(15234, 'manual');
    final back = Project.fromJson(jsonDecode(jsonEncode(p.toJson())) as Map<String, dynamic>);
    expect(back.lines.map((l) => [l.startMs, l.endMs]).toList(), [[0, null], [15234, 18000], [null, null]]);
    expect(back.vocalStartMs, 15234);
    expect(back.resolve().cues.map((c) => [c.startMs, c.endMs]).toList(), p.resolve().cues.map((c) => [c.startMs, c.endMs]).toList());
  });
}
