// Project data (schema v2, docs/SYNC_SPEC.md) with a versioned migration from the original Android format.
import 'package:flutter/painting.dart';
import 'sync.dart';
import 'vocal_detector.dart';

/// Bundled fonts: display name -> (Flutter family, font family name inside the TTF used by libass, bold flag).
const fonts = <String, (String, String, bool)>{
  'Poppins': ('Poppins', 'Poppins ExtraBold', false),
  'Inter': ('Inter', 'Inter SemiBold', false),
  'Anton': ('Anton', 'Anton', false),
  'Bebas Neue': ('Bebas Neue', 'Bebas Neue', false),
  'Space Grotesk': ('Space Grotesk', 'Space Grotesk Light', true),
  'Playfair Display': ('Playfair Display', 'Playfair Display', true),
  'Pacifico': ('Pacifico', 'Pacifico', false),
};

/// Lyric animations available on Android. Each has a matching ASS effect in export_ass.dart.
const lyricEffects = <String, String>{'fade': 'Clean fade', 'karaoke': 'Karaoke fill', 'pop': 'Pop bounce', 'boxed': 'Caption box'};

class LyricStyle {
  LyricStyle({this.fx = 'fade', this.font = 'Poppins', this.size = 72, this.color = 0xFFFFFFFF, this.accent = 0xFFC8F36B, this.posY = 0.5, this.upper = false});
  String fx, font;
  double size, posY;
  int color, accent;
  bool upper;
  Color get textColor => Color(color);
  Color get accentColor => Color(accent);
  Map<String, dynamic> toJson() => {'fx': fx, 'font': font, 'size': size, 'color': color, 'accent': accent, 'posY': posY, 'upper': upper};
  factory LyricStyle.fromJson(Map<String, dynamic>? j) => j == null
      ? LyricStyle()
      : LyricStyle(
          fx: lyricEffects.containsKey(j['fx']) ? j['fx'] as String : 'fade',
          font: fonts.containsKey(j['font']) ? j['font'] as String : 'Poppins',
          size: (j['size'] as num?)?.toDouble() ?? 72,
          color: (j['color'] as num?)?.toInt() ?? 0xFFFFFFFF,
          accent: (j['accent'] as num?)?.toInt() ?? 0xFFC8F36B,
          posY: (j['posY'] as num?)?.toDouble() ?? 0.5,
          upper: j['upper'] == true,
        );
}

class Project {
  Project(this.id, this.title, {this.audioPath, this.durationMs = 0, this.theme = 'aurora', List<LyricLine>? lines, LyricStyle? style, this.vocalStartMs, this.vocalStartSource, this.detection, this.backgroundImage, this.backgroundDim = 0.35})
      : lines = lines ?? [],
        style = style ?? LyricStyle();
  String id, title, theme;
  String? audioPath, backgroundImage, vocalStartSource;
  int durationMs;
  int? vocalStartMs;
  double backgroundDim;
  List<LyricLine> lines;
  LyricStyle style;
  DetectionResult? detection;

  Resolved resolve() => resolveCues(lines, durationMs: durationMs > 0 ? durationMs : null, vocalStartMs: vocalStartMs);

  Map<String, dynamic> toJson() => {
        'schemaVersion': schemaVersion,
        'id': id,
        'title': title,
        'audioPath': audioPath,
        'durationMs': durationMs,
        'theme': theme,
        'lines': lines.map((e) => e.toJson()).toList(),
        'style': style.toJson(),
        'vocalStartMs': vocalStartMs,
        'vocalStartSource': vocalStartSource,
        'detection': detection?.toJson(),
        'backgroundImage': backgroundImage,
        'backgroundDim': backgroundDim,
      };

  /// Reads any stored project; schema v1 (no `schemaVersion`) is migrated per SYNC_SPEC §6.
  factory Project.fromJson(Map<String, dynamic> j) {
    final v = (j['schemaVersion'] as num?)?.toInt() ?? 1;
    final rawLines = (j['lines'] as List?) ?? const [];
    final lines = v < 2 ? migrateAndroidV1Lines(rawLines) : rawLines.map((e) => LyricLine.fromJson(Map<String, dynamic>.from(e as Map))).toList();
    return Project(
      (j['id'] ?? '').toString(),
      (j['title'] ?? 'Untitled').toString(),
      audioPath: j['audioPath'] as String?,
      durationMs: (j['durationMs'] as num?)?.toInt() ?? 0,
      theme: (j['theme'] ?? 'aurora').toString(),
      lines: lines,
      style: v < 2 ? null : LyricStyle.fromJson((j['style'] as Map?)?.cast<String, dynamic>()),
      vocalStartMs: v < 2 ? null : (j['vocalStartMs'] as num?)?.toInt(),
      vocalStartSource: v < 2 ? null : j['vocalStartSource'] as String?,
      detection: j['detection'] is Map ? DetectionResult.fromJson(Map<String, dynamic>.from(j['detection'] as Map)) : null,
      backgroundImage: j['backgroundImage'] as String?,
      backgroundDim: (j['backgroundDim'] as num?)?.toDouble() ?? 0.35,
    );
  }

  /// Sets the vocal start and times the first lyric when it is unsynced or was tied to the old vocal start
  /// (same rule as js/sync.js applyVocalStart).
  void applyVocalStart(int? ms, String? source) {
    final prev = vocalStartMs;
    vocalStartMs = ms == null ? null : (ms < 0 ? 0 : ms);
    vocalStartSource = ms == null ? null : source;
    if (ms == null) return;
    final first = lines.where((l) => l.hasText).firstOrNull;
    if (first != null && (!first.synced || first.startMs == prev)) {
      final len = first.synced && first.endMs != null && first.endMs! > first.startMs! ? first.endMs! - first.startMs! : null;
      first.startMs = vocalStartMs;
      first.endMs = len == null ? null : vocalStartMs! + len;
    }
  }
}
