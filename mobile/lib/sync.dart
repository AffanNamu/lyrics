// Lyric synchronization model — implements docs/SYNC_SPEC.md (same rules as js/sync.js).
// Pure Dart (no Flutter imports) so it is unit-tested against spec/sync-cases.json.

const int schemaVersion = 2;
const int maxAutoHoldMs = 8000;
const int provisionalSpacingMs = 3500;
const int minLineMs = 200;

class LyricLine {
  LyricLine({required this.id, required this.text, this.startMs, this.endMs});
  final String id;
  String text;

  /// When the line appears. `null` = not synced yet. `0` is a real time.
  int? startMs;

  /// Optional explicit end; `null` = until the next line (at most [maxAutoHoldMs]).
  int? endMs;

  bool get synced => startMs != null && startMs! >= 0;
  bool get hasText => text.trim().isNotEmpty;

  Map<String, dynamic> toJson() => {'id': id, 'text': text, 'startMs': startMs, 'endMs': endMs};
  factory LyricLine.fromJson(Map<String, dynamic> j) => LyricLine(
        id: (j['id'] ?? '').toString(),
        text: (j['text'] ?? '').toString(),
        startMs: (j['startMs'] as num?)?.toInt(),
        endMs: (j['endMs'] as num?)?.toInt(),
      );
  LyricLine copy() => LyricLine(id: id, text: text, startMs: startMs, endMs: endMs);
}

class Cue {
  Cue(this.index, this.id, this.text, this.startMs, this.endMs, this.synced);
  final int index;
  final String id;
  final String text;
  final int startMs;
  int endMs;
  final bool synced;
  bool activeAt(num tMs) => startMs <= tMs && tMs < endMs;
}

class Resolved {
  Resolved(this.cues, this.unplaced, this.syncedCount, this.total);
  final List<Cue> cues;
  final List<int> unplaced;
  final int syncedCount;
  final int total;
}

bool _validEnd(LyricLine l) => l.endMs != null && l.synced && l.endMs! > l.startMs!;

/// Resolves lines into display cues (SYNC_SPEC §2–3).
Resolved resolveCues(List<LyricLine> lines, {int? durationMs, int? vocalStartMs}) {
  final dur = (durationMs != null && durationMs > 0) ? durationMs : null;
  final vs = (vocalStartMs != null && vocalStartMs >= 0) ? vocalStartMs : null;
  final items = <({LyricLine l, int index})>[];
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].hasText) items.add((l: lines[i], index: i));
  }
  final placed = List<int?>.filled(items.length, null);
  var anchors = 0;
  for (var i = 0; i < items.length; i++) {
    if (items[i].l.synced) {
      placed[i] = items[i].l.startMs;
      anchors++;
    }
  }
  List<int> spread(int from, int k, int? next, bool startsAtFrom) {
    final out = <int>[];
    for (var j = 0; j < k; j++) {
      double v;
      if (next != null && next > from) {
        v = startsAtFrom ? from + (next - from) * j / k : from + (next - from) * (j + 1) / (k + 1);
      } else {
        v = (from + (startsAtFrom ? j : j + 1) * provisionalSpacingMs).toDouble();
      }
      out.add(_jsRound(v));
    }
    return out;
  }

  var i = 0;
  while (i < items.length) {
    if (placed[i] != null) {
      i++;
      continue;
    }
    var j = i;
    while (j < items.length && placed[j] == null) {
      j++;
    }
    final k = j - i;
    final prev = i > 0 ? placed[i - 1] : null;
    final next = j < items.length ? placed[j] : null;
    List<int>? pos;
    if (prev != null) {
      pos = spread(prev, k, next, false);
    } else if (vs != null) {
      pos = spread(vs, k, next, true);
    }
    if (pos != null) {
      for (var n = 0; n < k; n++) {
        placed[i + n] = pos[n];
      }
    }
    i = j;
  }

  final unplaced = <int>[];
  final cues = <Cue>[];
  final lineOf = <Cue, LyricLine>{};
  for (var n = 0; n < items.length; n++) {
    final s = placed[n];
    if (s == null || (dur != null && s >= dur)) {
      unplaced.add(items[n].index);
      continue;
    }
    final c = Cue(items[n].index, items[n].l.id, items[n].l.text, s, 0, items[n].l.synced);
    cues.add(c);
    lineOf[c] = items[n].l;
  }
  cues.sort((a, b) => a.startMs != b.startMs ? a.startMs.compareTo(b.startMs) : a.index.compareTo(b.index));
  for (var n = 0; n < cues.length; n++) {
    final c = cues[n], l = lineOf[c]!;
    final limit = n + 1 < cues.length ? cues[n + 1].startMs : null;
    int end;
    if (c.synced && _validEnd(l)) {
      end = limit != null ? (l.endMs! < limit ? l.endMs! : limit) : l.endMs!;
    } else {
      final hold = c.startMs + maxAutoHoldMs;
      end = limit != null ? (limit < hold ? limit : hold) : hold;
    }
    if (dur != null && end > dur) end = dur;
    c.endMs = end < c.startMs ? c.startMs : end;
  }
  return Resolved(cues, unplaced, anchors, items.length);
}

/// The cue visible at [tMs], or null (half-open windows, SYNC_SPEC §3).
Cue? activeCue(List<Cue> cues, num tMs) {
  var lo = 0, hi = cues.length - 1, hit = -1;
  while (lo <= hi) {
    final m = (lo + hi) >> 1;
    if (cues[m].startMs <= tMs) {
      hit = m;
      lo = m + 1;
    } else {
      hi = m - 1;
    }
  }
  if (hit < 0) return null;
  return tMs < cues[hit].endMs ? cues[hit] : null;
}

/// JavaScript Math.round semantics (half rounds towards +infinity) so both apps produce identical integers.
int _jsRound(double v) => (v + 0.5).floor();

/// Android schema v1 stored `startMs: 0` for lines that were never synced (SYNC_SPEC §6).
List<LyricLine> migrateAndroidV1Lines(List raw) {
  final out = <LyricLine>[];
  for (var i = 0; i < raw.length; i++) {
    final j = Map<String, dynamic>.from(raw[i] as Map);
    final s = (j['startMs'] as num?)?.toInt();
    out.add(LyricLine(id: (j['id'] ?? 'l$i').toString(), text: (j['text'] ?? '').toString(), startMs: (s != null && s > 0) ? s : null));
  }
  return out;
}
