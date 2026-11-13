// LRC / SRT / plain text <-> lyric lines in milliseconds (docs/SYNC_SPEC.md §7). Mirrors js/lyrics.js.
import 'dart:math';
import 'sync.dart';

final _rnd = Random();
String newId() => '${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}${_rnd.nextInt(1 << 30).toRadixString(36)}';

final _stamp = RegExp(r'\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]');
final _tag = RegExp(r'^\[[a-zA-Z]+:.*\]$');
int _frac(String? f) => f == null || f.isEmpty ? 0 : (double.parse('0.$f') * 1000).round();

List<LyricLine> parseLyrics(String text, {String Function()? id}) {
  final mk = id ?? newId;
  text = text.replaceAll('\r', '');
  if (RegExp(r'^\s*\d+\s*\n\s*\d\d:\d\d:\d\d[,.]\d+\s*-->', multiLine: true).hasMatch(text)) return _parseSrt(text, mk);
  var offset = 0;
  final off = RegExp(r'^\s*\[offset:\s*([+-]?\d+)\s*\]', multiLine: true, caseSensitive: false).firstMatch(text);
  if (off != null) offset = int.parse(off.group(1)!);
  final out = <LyricLine>[];
  var stamped = 0, plain = 0;
  for (final raw in text.split('\n')) {
    if (_tag.hasMatch(raw.trim())) continue;
    final stamps = _stamp.allMatches(raw).toList();
    final body = raw.replaceAll(_stamp, '').trim();
    if (body.isEmpty) continue;
    if (stamps.isNotEmpty) {
      for (final m in stamps) {
        final ms = int.parse(m.group(1)!) * 60000 + int.parse(m.group(2)!) * 1000 + _frac(m.group(3)) - offset;
        out.add(LyricLine(id: mk(), text: body, startMs: max(0, ms)));
        stamped++;
      }
    } else {
      out.add(LyricLine(id: mk(), text: body));
      plain++;
    }
  }
  if (stamped > 0 && plain == 0) out.sort((a, b) => a.startMs!.compareTo(b.startMs!));
  return out;
}

List<LyricLine> _parseSrt(String text, String Function() mk) {
  int ms(String s) {
    final p = s.replaceAll(',', '.').split(':');
    final sec = p[2].split('.');
    return int.parse(p[0]) * 3600000 + int.parse(p[1]) * 60000 + int.parse(sec[0]) * 1000 + _frac(sec.length > 1 ? sec[1] : null);
  }

  final out = <LyricLine>[];
  final re = RegExp(r'(\d\d:\d\d:\d\d[,.]\d+)\s*-->\s*(\d\d:\d\d:\d\d[,.]\d+)[^\n]*\n([\s\S]+)');
  for (final block in text.split(RegExp(r'\n\s*\n'))) {
    final m = re.firstMatch(block);
    if (m == null) continue;
    final s = ms(m.group(1)!), e = ms(m.group(2)!);
    out.add(LyricLine(id: mk(), text: m.group(3)!.replaceAll(RegExp(r'<[^>]+>'), '').replaceAll('\n', ' ').trim(), startMs: s, endMs: e > s ? e : null));
  }
  return out;
}

String _two(int n) => n.toString().padLeft(2, '0');

/// Synced lines get their stamp; unsynced lines are written without one.
String toLrc(List<LyricLine> lines, {String title = ''}) {
  final b = StringBuffer();
  if (title.isNotEmpty) b.writeln('[ti:$title]');
  for (final l in lines.where((l) => l.hasText)) {
    if (!l.synced) {
      b.writeln(l.text);
      continue;
    }
    final m = l.startMs! ~/ 60000, cs = ((l.startMs! % 60000) / 10).round();
    b.writeln('[${_two(m)}:${_two(cs ~/ 100)}.${_two(cs % 100)}]${l.text}');
  }
  return b.toString();
}

/// SRT from resolved cues, so the file matches the video.
String toSrt(List<Cue> cues) {
  String f(int t) => '${_two(t ~/ 3600000)}:${_two(t % 3600000 ~/ 60000)}:${_two(t % 60000 ~/ 1000)},${(t % 1000).toString().padLeft(3, '0')}';
  final b = StringBuffer();
  for (var i = 0; i < cues.length; i++) {
    b.write('${i + 1}\n${f(cues[i].startMs)} --> ${f(cues[i].endMs)}\n${cues[i].text}\n');
    if (i + 1 < cues.length) b.write('\n');
  }
  return b.toString();
}
