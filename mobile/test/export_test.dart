// The MP4 subtitle track must carry exactly the resolved cue windows the preview shows.
import 'package:flutter_test/flutter_test.dart';
import 'package:lyrics_studio/export_ass.dart';
import 'package:lyrics_studio/project.dart';
import 'package:lyrics_studio/sync.dart';

int parseAss(String t) {
  final p = t.split(':');
  final s = p[2].split('.');
  return int.parse(p[0]) * 3600000 + int.parse(p[1]) * 60000 + int.parse(s[0]) * 1000 + int.parse(s[1]) * 10;
}

void main() {
  Project longIntro() => Project('p', 'Long intro', durationMs: 120000, audioPath: '/a.mp3', lines: [
        LyricLine(id: 'a', text: 'First words', startMs: 43000),
        LyricLine(id: 'b', text: 'Second {line}'),
        LyricLine(id: 'c', text: 'Break before chorus', startMs: 50000, endMs: 53000),
        LyricLine(id: 'd', text: 'Chorus', startMs: 70000),
      ])
        ..vocalStartMs = 43000;

  for (final fx in lyricEffects.keys) {
    test('ASS dialogue windows equal the preview cues ($fx)', () {
      final p = longIntro()..style.fx = fx;
      final ass = buildAss(p);
      final d = RegExp(r'^Dialogue: 0,([^,]+),([^,]+),', multiLine: true).allMatches(ass).map((m) => [parseAss(m.group(1)!), parseAss(m.group(2)!)]).toList();
      expect(d, p.resolve().cues.map((c) => [c.startMs, c.endMs]).toList());
      expect(d.first.first, 43000, reason: 'nothing may appear during the 43 s intro');
      expect(d.last.last, 78000, reason: 'final line held 8 s');
    });
  }
  test('lines that cannot be placed are left out and counted', () {
    final p = Project('p', 'x', durationMs: 60000, audioPath: '/a.mp3', lines: [LyricLine(id: 'a', text: 'Untimed'), LyricLine(id: 'b', text: 'Timed', startMs: 20000)]);
    expect(hiddenLineCount(p), 1);
    expect(RegExp('Dialogue').allMatches(buildAss(p)).length, 1);
  });
  test('ASS escapes override braces and uses the bundled font name', () {
    final p = longIntro()..style.font = 'Inter';
    final ass = buildAss(p);
    expect(ass, contains(r'Second \{line\}'));
    expect(ass, contains('Style: Lyric,Inter SemiBold,'));
  });
  test('karaoke timing spreads words over 92 % of the line', () {
    final p = Project('p', 'x', durationMs: 60000, lines: [LyricLine(id: 'a', text: 'one two three', startMs: 1000, endMs: 4000)])..style.fx = 'karaoke';
    final ks = RegExp(r'\\kf(\d+)').allMatches(buildAss(p)).map((m) => int.parse(m.group(1)!)).toList();
    expect(ks.length, 3);
    expect(ks.reduce((a, b) => a + b), 276);
  });
  test('FFmpeg arguments: image background and subtitle filter', () {
    final p = longIntro()..backgroundImage = '/img/bg.jpg';
    final a = ffmpegArgs(p: p, assPath: '/r/c.ass', fontsDir: '/r/fonts', output: '/o.mp4', durationMs: 120000, bgHex: '0x000000', accentHex: '0xffffff');
    expect(a.sublist(0, 7), ['-y', '-loop', '1', '-framerate', '30', '-i', '/img/bg.jpg']);
    expect(a[a.indexOf('-filter_complex') + 1], contains("ass=filename='/r/c.ass':fontsdir='/r/fonts'"));
    expect(a.last, '/o.mp4');
  });
}
