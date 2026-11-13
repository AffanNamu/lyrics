// Builds the subtitle (ASS) track and FFmpeg arguments for the MP4 export. The dialogue windows are exactly the
// resolved cues from sync.dart — the same windows the live preview shows (ASS resolution: 10 ms).
import 'project.dart';
import 'sync.dart';

String assTime(int ms) {
  final cs = (ms / 10).round();
  return '${cs ~/ 360000}:${(cs ~/ 6000 % 60).toString().padLeft(2, '0')}:${(cs ~/ 100 % 60).toString().padLeft(2, '0')}.${(cs % 100).toString().padLeft(2, '0')}';
}

/// ARGB int -> ASS &HAABBGGRR (ASS alpha 00 = opaque).
String assColor(int argb, {int alpha = 0}) {
  final r = (argb >> 16) & 255, g = (argb >> 8) & 255, b = argb & 255;
  String h(int v) => v.toRadixString(16).padLeft(2, '0').toUpperCase();
  return '&H${h(alpha)}${h(b)}${h(g)}${h(r)}';
}

int _contrast(int argb) {
  final r = (argb >> 16) & 255, g = (argb >> 8) & 255, b = argb & 255;
  return (r * .299 + g * .587 + b * .114) > 150 ? 0xFF0B0C10 : 0xFFFFFFFF;
}

String _escape(String t) => t.replaceAll(r'\', r'\\').replaceAll('{', r'\{').replaceAll('}', r'\}').replaceAll('\n', r'\N');

/// Karaoke word timing: each word gets a share of 92 % of the line, proportional to its length (as the browser).
String _karaoke(String text, int durMs) {
  final words = text.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
  final total = words.fold<int>(0, (s, w) => s + w.length + 1);
  final b = StringBuffer();
  var acc = 0, usedCs = 0;
  for (var i = 0; i < words.length; i++) {
    acc += words[i].length + 1;
    final endCs = (durMs * 0.092 * acc / total).round();
    b.write('{\\kf${endCs - usedCs}}${_escape(words[i])}${i + 1 < words.length ? ' ' : ''}');
    usedCs = endCs;
  }
  return b.toString();
}

const playResX = 1080, playResY = 1920;

String buildAss(Project p) {
  final st = p.style, font = fonts[st.font] ?? fonts['Poppins']!;
  final boxed = st.fx == 'boxed', karaoke = st.fx == 'karaoke';
  final primary = boxed ? assColor(_contrast(st.accent)) : karaoke ? assColor(st.accent) : assColor(st.color);
  final secondary = karaoke ? assColor(st.color, alpha: 0x60) : assColor(st.color);
  final outline = boxed ? assColor(st.accent) : assColor(0xFF000000, alpha: 0x70);
  final back = boxed ? assColor(st.accent) : assColor(0xFF000000, alpha: 0x90);
  final b = StringBuffer()
    ..writeln('[Script Info]')
    ..writeln('ScriptType: v4.00+')
    ..writeln('PlayResX: $playResX')
    ..writeln('PlayResY: $playResY')
    ..writeln('WrapStyle: 0')
    ..writeln('ScaledBorderAndShadow: yes')
    ..writeln()
    ..writeln('[V4+ Styles]')
    ..writeln('Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding')
    ..writeln('Style: Lyric,${font.$2},${st.size.round()},$primary,$secondary,$outline,$back,${font.$3 ? -1 : 0},0,0,0,100,100,0,0,${boxed ? 3 : 1},${boxed ? 18 : 3},${boxed ? 0 : 2},5,90,90,0,1')
    ..writeln()
    ..writeln('[Events]')
    ..writeln('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');
  final y = (st.posY * playResY).round();
  for (final c in p.resolve().cues) {
    if (c.endMs <= c.startMs) continue;
    final text = st.upper ? c.text.toUpperCase() : c.text, d = c.endMs - c.startMs;
    final pos = '\\an5\\pos(${playResX ~/ 2},$y)';
    final String body;
    switch (st.fx) {
      case 'karaoke':
        body = '{$pos\\fad(150,150)}${_karaoke(text, d)}';
      case 'pop':
        body = '{$pos\\fad(80,150)\\fscx55\\fscy55\\t(0,170,\\fscx110\\fscy110)\\t(170,260,\\fscx100\\fscy100)}${_escape(text)}';
      case 'boxed':
        body = '{$pos\\fad(200,150)}${_escape(text)}';
      default:
        body = '{$pos\\fad(250,200)}${_escape(text)}';
    }
    b.writeln('Dialogue: 0,${assTime(c.startMs)},${assTime(c.endMs)},Lyric,,0,0,0,,$body');
  }
  return b.toString();
}

String _fx(String path) => path.replaceAll(r'\', '/').replaceAll(':', r'\:').replaceAll("'", r"\'");

/// FFmpeg arguments (no shell quoting involved) for a 1080x1920 30 fps MP4.
List<String> ffmpegArgs({required Project p, required String assPath, required String fontsDir, required String output, required int durationMs, required String bgHex, required String accentHex}) {
  final secs = (durationMs / 1000).toStringAsFixed(2);
  final subs = "ass=filename='${_fx(assPath)}':fontsdir='${_fx(fontsDir)}'";
  final img = p.backgroundImage;
  final dim = p.backgroundDim.clamp(0, 0.85).toStringAsFixed(2);
  final inputs = <String>[];
  String video;
  if (img != null) {
    inputs.addAll(['-loop', '1', '-framerate', '30', '-i', img]);
    // Slight overscan with a slow drift, then dim for legibility.
    video = "[0:v]scale=1188:2112:force_original_aspect_ratio=increase,crop=1188:2112,"
        "crop=1080:1920:x='54+54*sin(t/6)':y='96+96*sin(t/8)',drawbox=x=0:y=0:w=iw:h=ih:color=black@$dim:t=fill,$subs,format=yuv420p[v]";
  } else {
    inputs.addAll(['-f', 'lavfi', '-i', 'color=c=$bgHex:s=1080x1920:r=30:d=$secs']);
    video = "[0:v]drawbox=x='mod(t*78,1080)-220':y='mod(t*34,1920)-180':w=520:h=520:color=$accentHex@0.34:t=fill,"
        "drawbox=x='mod(t*39+500,1080)-160':y='mod(t*23+800,1920)-160':w=320:h=320:color=$bgHex@0.42:t=fill,$subs,format=yuv420p[v]";
  }
  return [
    '-y', ...inputs, '-i', p.audioPath!, //
    '-filter_complex', video, '-map', '[v]', '-map', '1:a:0',
    '-t', secs, '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
    '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', output,
  ];
}

/// Lines that will not appear in the export (not timed and not placeable), for a warning before rendering.
int hiddenLineCount(Project p) => p.resolve().unplaced.length;

List<Cue> exportCues(Project p) => p.resolve().cues;
