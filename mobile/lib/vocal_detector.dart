// Automatic vocal-start detection — on device, no network. Dart port of js/vocal.js (same model, same numerics,
// same onset rule), verified against spec/vocal-model-cases.json and spec/vocal-onset-cases.json.
//
// Model: YAMNet (Google, tensorflow/models research/audioset/yamnet, Apache-2.0), batch-norm folded, int8
// per-channel weights, voice-class outputs only (assets/models/vocal-yamnet-int8.bin). See docs/VOCAL_DETECTION.md.
import 'dart:convert';
import 'dart:isolate';
import 'dart:math' as math;
import 'dart:typed_data';

const int sampleRate = 16000;
const int _win = 400, _hop = 160, _nfft = 512, _mels = 64, _patch = 96;
const int patchHopFrames = 48; // 0.48 s
const String algorithm = 'yamnet-vocal-1';

class VocalLayer {
  VocalLayer(this.kind, this.stride, this.rows, this.cols, this.w, this.bias);
  final String kind;
  final int stride, rows, cols;
  final Float32List w, bias;
}

class VocalModel {
  VocalModel(this.layers);
  final List<VocalLayer> layers;

  static VocalModel load(Uint8List bytes) {
    final bd = ByteData.sublistView(bytes);
    if (utf8.decode(bytes.sublist(0, 4)) != 'YVD1') throw const FormatException('Not a vocal model file');
    final n = bd.getUint32(4, Endian.little);
    final meta = jsonDecode(utf8.decode(bytes.sublist(8, 8 + n))) as Map<String, dynamic>;
    final base = 8 + n;
    final layers = <VocalLayer>[];
    for (final m in (meta['layers'] as List).cast<Map<String, dynamic>>()) {
      final rows = m['rows'] as int, cols = m['cols'] as int;
      final q = Int8List.sublistView(bytes, base + (m['w'] as int), base + (m['w'] as int) + rows * cols);
      Float32List f32(int off) {
        final o = Float32List(cols);
        for (var i = 0; i < cols; i++) {
          o[i] = bd.getFloat32(base + off + i * 4, Endian.little);
        }
        return o;
      }

      final sc = f32(m['scale'] as int), bias = f32(m['bias'] as int);
      final w = Float32List(rows * cols);
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          w[r * cols + c] = q[r * cols + c] * sc[c];
        }
      }
      layers.add(VocalLayer(m['kind'] as String, m['stride'] as int, rows, cols, w, bias));
    }
    return VocalModel(layers);
  }
}

// ---- log-mel front end (matches YAMNet features.py and js/vocal.js) ------------------------------------------
Float32List? _mel;
Float32List? _hann;
Float64List? _tw;
void _setup() {
  if (_mel != null) return;
  _hann = Float32List(_win);
  for (var i = 0; i < _win; i++) {
    _hann![i] = 0.5 - 0.5 * math.cos(2 * math.pi * i / _win);
  }
  double hz2mel(double f) => 1127 * math.log(1 + f / 700);
  const nb = _nfft ~/ 2 + 1;
  final lo = hz2mel(125), hi = hz2mel(7500);
  final edges = List<double>.generate(_mels + 2, (i) => lo + (hi - lo) * i / (_mels + 1));
  _mel = Float32List(nb * _mels);
  for (var b = 1; b < nb; b++) {
    final m = hz2mel((sampleRate / 2) * b / (nb - 1));
    for (var k = 0; k < _mels; k++) {
      final l = edges[k], c = edges[k + 1], u = edges[k + 2];
      _mel![b * _mels + k] = math.max(0, math.min((m - l) / (c - l), (u - m) / (u - c)));
    }
  }
  _tw = Float64List(_nfft);
  for (var i = 0; i < _nfft ~/ 2; i++) {
    _tw![2 * i] = math.cos(-2 * math.pi * i / _nfft);
    _tw![2 * i + 1] = math.sin(-2 * math.pi * i / _nfft);
  }
}

void _fft(Float64List re, Float64List im) {
  const n = _nfft;
  for (var i = 1, j = 0; i < n; i++) {
    var bit = n >> 1;
    for (; (j & bit) != 0; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      var t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  final tw = _tw!;
  for (var len = 2; len <= n; len <<= 1) {
    final half = len >> 1, step = n ~/ len;
    for (var i = 0; i < n; i += len) {
      for (var k = 0; k < half; k++) {
        final wr = tw[2 * k * step], wi = tw[2 * k * step + 1], a = i + k, b = a + half;
        final xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

/// Log-mel spectrogram, frames x 64 (row-major), from mono 16 kHz samples.
Float32List logMel(Float32List x) {
  _setup();
  final frames = x.length < _win ? 0 : 1 + (x.length - _win) ~/ _hop;
  final out = Float32List(frames * _mels);
  final re = Float64List(_nfft), im = Float64List(_nfft), mag = Float64List(_nfft ~/ 2 + 1);
  final mel = _mel!, hann = _hann!;
  for (var f = 0; f < frames; f++) {
    re.fillRange(0, _nfft, 0);
    im.fillRange(0, _nfft, 0);
    for (var i = 0; i < _win; i++) {
      re[i] = x[f * _hop + i] * hann[i];
    }
    _fft(re, im);
    for (var b = 0; b <= _nfft ~/ 2; b++) {
      mag[b] = math.sqrt(re[b] * re[b] + im[b] * im[b]);
    }
    for (var k = 0; k < _mels; k++) {
      var s = 0.0;
      for (var b = 1; b <= _nfft ~/ 2; b++) {
        final w = mel[b * _mels + k];
        if (w != 0) s += mag[b] * w;
      }
      out[f * _mels + k] = math.log(s + 0.001);
    }
  }
  return out;
}

// ---- network --------------------------------------------------------------------------------------------------
(int, int) _same(int n, int s) {
  final o = (n + s - 1) ~/ s, tot = math.max((o - 1) * s + 3 - n, 0);
  return (o, tot >> 1);
}

(Float32List, int, int, int) _conv3(Float32List x, int h, int w, int c, VocalLayer l, bool depthwise) {
  final s = l.stride;
  final (oh, pt) = _same(h, s);
  final (ow, pl) = _same(w, s);
  final o = depthwise ? c : l.cols;
  final out = Float32List(oh * ow * o), wt = l.w, b = l.bias;
  for (var oy = 0; oy < oh; oy++) {
    for (var ox = 0; ox < ow; ox++) {
      final o0 = (oy * ow + ox) * o;
      for (var k = 0; k < o; k++) {
        out[o0 + k] = b[k];
      }
      for (var ky = 0; ky < 3; ky++) {
        final iy = oy * s + ky - pt;
        if (iy < 0 || iy >= h) continue;
        for (var kx = 0; kx < 3; kx++) {
          final ix = ox * s + kx - pl;
          if (ix < 0 || ix >= w) continue;
          final tap = (ky * 3 + kx) * o, i0 = (iy * w + ix) * c;
          if (depthwise) {
            for (var ch = 0; ch < c; ch++) {
              out[o0 + ch] += x[i0 + ch] * wt[tap + ch];
            }
          } else {
            final xv = x[i0];
            for (var k = 0; k < o; k++) {
              out[o0 + k] += xv * wt[tap + k];
            }
          }
        }
      }
      for (var k = 0; k < o; k++) {
        if (out[o0 + k] < 0) out[o0 + k] = 0;
      }
    }
  }
  return (out, oh, ow, o);
}

Float32List _pointwise(Float32List x, int p, int c, VocalLayer l) {
  final o = l.cols, out = Float32List(p * o), w = l.w, b = l.bias;
  final idx = Int32List(c), val = Float32List(c);
  for (var px = 0; px < p; px++) {
    final o0 = px * o, i0 = px * c;
    var nz = 0;
    for (var ch = 0; ch < c; ch++) {
      final v = x[i0 + ch];
      if (v != 0) {
        idx[nz] = ch * o;
        val[nz++] = v;
      }
    }
    for (var k = 0; k < o; k++) {
      out[o0 + k] = b[k];
    }
    var k = 0;
    for (; k + 4 <= nz; k += 4) {
      final r0 = idx[k], r1 = idx[k + 1], r2 = idx[k + 2], r3 = idx[k + 3];
      final v0 = val[k], v1 = val[k + 1], v2 = val[k + 2], v3 = val[k + 3];
      for (var q = 0; q < o; q++) {
        out[o0 + q] += v0 * w[r0 + q] + v1 * w[r1 + q] + v2 * w[r2 + q] + v3 * w[r3 + q];
      }
    }
    for (; k < nz; k++) {
      final r = idx[k], v = val[k];
      for (var q = 0; q < o; q++) {
        out[o0 + q] += v * w[r + q];
      }
    }
    for (var q = 0; q < o; q++) {
      if (out[o0 + q] < 0) out[o0 + q] = 0;
    }
  }
  return out;
}

/// Voice-class logits for the 96-frame patch starting at frame [f0].
Float32List patchLogits(VocalModel model, Float32List mel, int f0) {
  var x = Float32List.sublistView(mel, f0 * _mels, (f0 + _patch) * _mels);
  var h = _patch, w = _mels, c = 1;
  for (final l in model.layers) {
    if (l.kind == 'conv' || l.kind == 'dw') {
      final r = _conv3(x, h, w, c, l, l.kind == 'dw');
      x = r.$1;
      h = r.$2;
      w = r.$3;
      c = r.$4;
    } else if (l.kind == 'pw') {
      x = _pointwise(x, h * w, c, l);
      c = l.cols;
    } else {
      final emb = Float32List(c), p = h * w;
      for (var px = 0; px < p; px++) {
        for (var ch = 0; ch < c; ch++) {
          emb[ch] += x[px * c + ch];
        }
      }
      final out = Float32List(l.cols);
      for (var o = 0; o < l.cols; o++) {
        var s = l.bias[o].toDouble();
        for (var ch = 0; ch < c; ch++) {
          s += (emb[ch] / p) * l.w[ch * l.cols + o];
        }
        out[o] = s;
      }
      return out;
    }
  }
  throw StateError('model has no output layer');
}

int patchCount(int melFrames) => melFrames < _patch ? 0 : 1 + (melFrames - _patch) ~/ patchHopFrames;

// ---- onset rule (same constants as js/vocal.js) ----------------------------------------------------------------
const _loP = 20.0, _hiP = 70.0, _k = 0.6, _wnd = 8, _need = 5, _offMs = 300, _postN = 20, _selectFloor = -6.0, _noneBelow = -7.0;

class Candidate {
  Candidate(this.ms, this.score, this.level);
  final int ms;
  final double score;
  final String level;
  Map<String, dynamic> toJson() => {'ms': ms, 'score': score, 'level': level};
  factory Candidate.fromJson(Map<String, dynamic> j) => Candidate((j['ms'] as num).toInt(), (j['score'] as num).toDouble(), j['level'] as String? ?? 'low');
}

/// Detection result — the format of docs/SYNC_SPEC.md §5.
class DetectionResult {
  DetectionResult({this.vocalStartMs, this.confidence = 0, this.level = 'none', this.candidates = const [], this.analyzedMs = 0, this.decision = 'pending'});
  final int? vocalStartMs;
  final double confidence;
  final String level;
  final List<Candidate> candidates;
  final int analyzedMs;
  String decision;
  Map<String, dynamic> toJson() => {'version': 1, 'algorithm': algorithm, 'vocalStartMs': vocalStartMs, 'confidence': confidence, 'level': level, 'candidates': candidates.map((c) => c.toJson()).toList(), 'analyzedMs': analyzedMs, 'decision': decision};
  factory DetectionResult.fromJson(Map<String, dynamic> j) => DetectionResult(
        vocalStartMs: (j['vocalStartMs'] as num?)?.toInt(),
        confidence: (j['confidence'] as num?)?.toDouble() ?? 0,
        level: j['level'] as String? ?? 'none',
        candidates: ((j['candidates'] as List?) ?? []).map((e) => Candidate.fromJson(Map<String, dynamic>.from(e as Map))).toList(),
        analyzedMs: (j['analyzedMs'] as num?)?.toInt() ?? 0,
        decision: j['decision'] as String? ?? 'pending',
      );
}

double _percentile(List<double> sorted, double p) {
  if (sorted.isEmpty) return 0;
  final pos = (sorted.length - 1) * p / 100, lo = pos.floor(), hi = math.min(sorted.length - 1, lo + 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

double _median(List<double> a) {
  final s = [...a]..sort();
  final n = s.length;
  if (n == 0) return 0;
  return n.isOdd ? s[(n - 1) ~/ 2] : (s[n ~/ 2 - 1] + s[n ~/ 2]) / 2;
}

List<double> smoothSeries(List<double> raw) =>
    List<double>.generate(raw.length, (i) => _median(raw.sublist(math.max(0, i - 1), math.min(raw.length, i + 2))));

String _levelOf(({double post, double contrast, double cover}) f) {
  if (f.post < _noneBelow) return 'none';
  if (f.post >= -4.6 && f.contrast >= 1.5 && f.cover >= 0.6) return 'high';
  if (f.post >= -5.2 && f.contrast >= 1.0 && f.cover >= 0.6) return 'medium';
  return 'low';
}

double _scoreOf(({double post, double contrast, double cover}) f, String lv) {
  if (lv == 'none') return 0;
  double cl(double v) => v < 0 ? 0 : (v > 1 ? 1 : v);
  final m = cl((f.post + 7) / 4) * 0.5 + cl(f.contrast / 4) * 0.3 + cl(f.cover) * 0.2;
  final (lo, hi) = lv == 'high' ? (0.75, 1.0) : lv == 'medium' ? (0.5, 0.75) : (0.15, 0.45);
  return ((lo + (hi - lo) * m) * 100).roundToDouble() / 100;
}

/// Finds when singing starts from per-patch voice logits (patch i covers [i*0.48 s, i*0.48 s + 0.96 s]).
DetectionResult detectOnset(List<double> raw) {
  final s = smoothSeries(raw), n = s.length;
  final analyzed = n == 0 ? 0 : ((n - 1) * patchHopFrames * 10 + 960);
  if (n < _wnd) return DetectionResult(analyzedMs: analyzed);
  final sorted = [...s]..sort();
  final b = _percentile(sorted, _loP), v = _percentile(sorted, _hiP), th = b + _k * (v - b);
  final above = s.map((e) => e > th ? 1 : 0).toList();
  final starts = <int>[];
  var run = 0;
  for (var i = 0; i < _wnd; i++) {
    run += above[i];
  }
  for (var i = 0; i + _wnd <= n; i++) {
    if (i > 0) run += above[i + _wnd - 1] - above[i - 1];
    if (above[i] == 1 && run >= _need && (starts.isEmpty || i - starts.last > 2 * _wnd)) starts.add(i);
  }
  if (starts.isEmpty) return DetectionResult(analyzedMs: analyzed);
  ({double post, double contrast, double cover}) feats(int i) {
    final post = s.sublist(i, math.min(n, i + _postN)), pre = s.sublist(0, i), pm = _median(post);
    final cov = post.where((e) => e > th).length / post.length;
    return (post: pm, contrast: pm - (pre.length >= 4 ? _median(pre) : b), cover: cov);
  }

  final f = starts.map(feats).toList();
  var pick = f.indexWhere((x) => x.post >= _selectFloor);
  if (pick < 0) pick = 0;
  final order = [pick, ...List.generate(starts.length, (j) => j).where((j) => j != pick)].take(3);
  final cands = order.map((j) {
    final lv = _levelOf(f[j]);
    return Candidate(starts[j] * patchHopFrames * 10 + _offMs, _scoreOf(f[j], lv), lv);
  }).toList();
  final best = cands.first;
  if (best.level == 'none') return DetectionResult(analyzedMs: analyzed);
  return DetectionResult(vocalStartMs: best.ms, confidence: best.score, level: best.level, candidates: cands, analyzedMs: analyzed);
}

// ---- whole-song analysis in background isolates -------------------------------------------------------------
void _workerEntry(List<Object> args) {
  final port = args[0] as SendPort;
  final model = VocalModel.load(args[1] as Uint8List);
  final mel = args[2] as Float32List;
  final count = args[3] as int;
  final out = Float64List(count);
  for (var i = 0; i < count; i++) {
    final z = patchLogits(model, mel, i * patchHopFrames);
    var m = double.negativeInfinity;
    for (final v in z) {
      if (v > m) m = v;
    }
    out[i] = m;
    if (i % 4 == 3) port.send(4);
  }
  port.send(out);
}

/// Analyzes mono 16 kHz audio with [workers] long-lived isolates (the model is loaded once per isolate).
Future<DetectionResult> analyzeVocalStart(Uint8List modelBytes, Float32List mono, {int workers = 3, void Function(double)? onProgress, bool Function()? cancelled}) async {
  final mel = await Isolate.run(() => logMel(mono));
  final count = patchCount(mel.length ~/ _mels);
  if (count == 0) return detectOnset(const []);
  final raw = List<double>.filled(count, 0);
  final n = math.max(1, math.min(workers, count));
  var done = 0;
  final isolates = <Isolate>[];
  final futures = <Future<void>>[];
  for (var w = 0; w < n; w++) {
    final a = count * w ~/ n, b = count * (w + 1) ~/ n;
    if (b <= a) continue;
    final slice = Float32List.fromList(Float32List.sublistView(mel, a * patchHopFrames * _mels, ((b - 1) * patchHopFrames + _patch) * _mels));
    final rp = ReceivePort();
    isolates.add(await Isolate.spawn(_workerEntry, <Object>[rp.sendPort, modelBytes, slice, b - a]));
    futures.add(() async {
      await for (final msg in rp) {
        if (msg is int) {
          done += msg;
          onProgress?.call(math.min(1, done / count));
          if (cancelled?.call() == true) {
            for (final i in isolates) {
              i.kill(priority: Isolate.immediate);
            }
            rp.close();
            throw const VocalAnalysisCancelled();
          }
        } else if (msg is Float64List) {
          for (var i = 0; i < msg.length; i++) {
            raw[a + i] = msg[i];
          }
          rp.close();
        }
      }
    }());
  }
  await Future.wait(futures);
  onProgress?.call(1);
  return detectOnset(raw);
}

class VocalAnalysisCancelled implements Exception {
  const VocalAnalysisCancelled();
  @override
  String toString() => 'Analysis cancelled';
}
