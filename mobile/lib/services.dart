// Platform work (files, decoding, rendering) behind one interface so the studio UI can be tested with fakes.
import 'dart:io';
import 'dart:typed_data';
import 'package:ffmpeg_kit_flutter_new/ffmpeg_kit.dart';
import 'package:ffmpeg_kit_flutter_new/ffmpeg_kit_config.dart';
import 'package:ffmpeg_kit_flutter_new/return_code.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';
import 'export_ass.dart';
import 'project.dart';
import 'vocal_detector.dart';

abstract class StudioServices {
  Future<String?> pickAndCopy(FileType type, String folder, String baseName);
  Future<String?> pickTextFile();
  Future<String?> saveFile(String name, Uint8List bytes);
  Future<DetectionResult> detect(Project p, {void Function(double)? onProgress, bool Function()? cancelled});
  Future<String> render(Project p, {required int durationMs, required String bgHex, required String accentHex, void Function(String)? onStatus});
}

class DeviceServices implements StudioServices {
  Future<Directory> _dir(String name) async {
    final d = Directory('${(await getApplicationDocumentsDirectory()).path}/$name');
    await d.create(recursive: true);
    return d;
  }

  @override
  Future<String?> pickAndCopy(FileType type, String folder, String baseName) async {
    final f = await FilePicker.platform.pickFiles(type: type);
    final path = f?.files.single.path;
    if (path == null) return null;
    final ext = f!.files.single.extension ?? 'bin';
    final out = '${(await _dir(folder)).path}/${baseName}_${DateTime.now().millisecondsSinceEpoch}.$ext';
    await File(path).copy(out);
    return out;
  }

  @override
  Future<String?> pickTextFile() async {
    final f = await FilePicker.platform.pickFiles(type: FileType.custom, allowedExtensions: ['lrc', 'srt', 'txt']);
    final path = f?.files.single.path;
    return path == null ? null : File(path).readAsString();
  }

  @override
  Future<String?> saveFile(String name, Uint8List bytes) => FilePicker.platform.saveFile(fileName: name, bytes: bytes);

  @override
  Future<DetectionResult> detect(Project p, {void Function(double)? onProgress, bool Function()? cancelled}) async {
    final audio = p.audioPath;
    if (audio == null || !File(audio).existsSync()) throw Exception('Import a song first.');
    final tmp = '${(await _dir('render')).path}/analysis.f32';
    // Decode on the device: mono, 16 kHz, 32-bit float — the model's input format.
    final s = await FFmpegKit.executeWithArguments(['-y', '-i', audio, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', tmp]);
    if (!ReturnCode.isSuccess(await s.getReturnCode())) throw Exception('This audio file could not be decoded.');
    final bytes = await File(tmp).readAsBytes();
    final mono = Float32List.view(bytes.buffer, bytes.offsetInBytes, bytes.lengthInBytes ~/ 4);
    final model = (await rootBundle.load('assets/models/vocal-yamnet-int8.bin')).buffer.asUint8List();
    final workers = (Platform.numberOfProcessors - 1).clamp(1, 4);
    try {
      return await analyzeVocalStart(model, mono, workers: workers, onProgress: onProgress, cancelled: cancelled);
    } finally {
      File(tmp).delete().ignore();
    }
  }

  static const _fontFiles = [
    'poppins-latin-800-normal.ttf', 'inter-latin-600-normal.ttf', 'anton-latin-400-normal.ttf', 'bebas-neue-latin-400-normal.ttf', //
    'space-grotesk-latin-700-normal.ttf', 'playfair-display-latin-700-normal.ttf', 'pacifico-latin-400-normal.ttf',
  ];

  @override
  Future<String> render(Project p, {required int durationMs, required String bgHex, required String accentHex, void Function(String)? onStatus}) async {
    final work = await _dir('render'), exports = await _dir('exports'), fontsDir = await _dir('render/fonts');
    // Bundled fonts are copied out of the APK so libass can load them — no system fonts or downloads needed.
    for (final f in _fontFiles) {
      final out = File('${fontsDir.path}/$f');
      if (!out.existsSync()) await out.writeAsBytes((await rootBundle.load('assets/fonts/$f')).buffer.asUint8List());
    }
    await FFmpegKitConfig.setFontDirectoryList([fontsDir.path, '/system/fonts']);
    final assFile = File('${work.path}/captions.ass');
    await assFile.writeAsString(buildAss(p));
    final output = '${exports.path}/${p.id}_${DateTime.now().millisecondsSinceEpoch}.mp4';
    onStatus?.call('Rendering 1080 × 1920 MP4 on this phone…');
    final session = await FFmpegKit.executeWithArguments(
        ffmpegArgs(p: p, assPath: assFile.path, fontsDir: fontsDir.path, output: output, durationMs: durationMs, bgHex: bgHex, accentHex: accentHex));
    if (!ReturnCode.isSuccess(await session.getReturnCode()) || !File(output).existsSync()) {
      final log = await session.getOutput() ?? '';
      throw Exception('Video encoding failed. ${log.length > 600 ? log.substring(log.length - 600) : log}');
    }
    return output;
  }
}
