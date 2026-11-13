// Vocal detector: model numerics against the shared test vector, and the onset rule on real song curves.
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:lyrics_studio/vocal_detector.dart';

void main() {
  final c = jsonDecode(File('../spec/vocal-model-cases.json').readAsStringSync()) as Map<String, dynamic>;
  final model = VocalModel.load(File('assets/models/vocal-yamnet-int8.bin').readAsBytesSync());
  Float32List signal() {
    final x = Float32List(c['samples'] as int);
    for (var n = 0; n < x.length; n++) {
      x[n] = 0.3 * math.sin(2 * math.pi * 220 * n / 16000 + 3 * math.sin(2 * math.pi * 5 * n / 16000)) + 0.1 * math.sin(2 * math.pi * 1000 * n / 16000) + 0.05 * math.sin(2 * math.pi * 3150 * n / 16000 * (1 + n / 64000));
    }
    return x;
  }

  test('bundled model is identical to the browser model', () {
    expect(File('assets/models/vocal-yamnet-int8.bin').readAsBytesSync(), File('../models/vocal-yamnet-int8.bin').readAsBytesSync());
  });
  test('log-mel front end matches the reference', () {
    final mel = logMel(signal());
    expect(mel.length ~/ 64, c['melFrames']);
    for (final p in (c['melProbe'] as List).cast<List>()) {
      expect(mel[(p[0] as int) * 64 + (p[1] as int)], closeTo((p[2] as num).toDouble(), (c['tolerance']['mel'] as num).toDouble()));
    }
  });
  test('network logits match the reference', () {
    final mel = logMel(signal());
    final want = (c['patchLogits'] as List).cast<List>();
    for (var i = 0; i < want.length; i++) {
      final got = patchLogits(model, mel, i * patchHopFrames);
      for (var k = 0; k < want[i].length; k++) {
        expect(got[k], closeTo((want[i][k] as num).toDouble(), (c['tolerance']['logit'] as num).toDouble()), reason: 'patch $i class $k');
      }
    }
  });
  final o = jsonDecode(File('../spec/vocal-onset-cases.json').readAsStringSync()) as Map<String, dynamic>;
  for (final k in (o['cases'] as List).cast<Map<String, dynamic>>()) {
    test('onset: ${k['name']}', () {
      final r = detectOnset((k['raw'] as List).map((e) => (e as num).toDouble()).toList());
      expect(r.vocalStartMs, k['expectMs']);
      expect(r.level, k['level']);
      expect(r.confidence, inInclusiveRange(0, 1));
    });
  }
  test('onset: flat input finds no singing', () {
    expect(detectOnset(List.filled(300, -12.0)).level, 'none');
    expect(detectOnset(const []).vocalStartMs, isNull);
  });
  test('whole-song analysis in isolates agrees with the single-thread path', () async {
    final x = signal();
    final mel = logMel(x);
    final single = <double>[for (var i = 0; i < patchCount(mel.length ~/ 64); i++) patchLogits(model, mel, i * patchHopFrames).reduce(math.max)];
    final r = await analyzeVocalStart(File('assets/models/vocal-yamnet-int8.bin').readAsBytesSync(), x, workers: 2);
    expect(r.toJson()['vocalStartMs'], detectOnset(single).vocalStartMs);
  });
}
