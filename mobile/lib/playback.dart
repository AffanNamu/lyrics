// Audio playback behind a small interface so the studio UI can be widget-tested with a fake clock.
import 'dart:async';
import 'package:just_audio/just_audio.dart';

abstract class Playback {
  Duration get position;
  Duration? get duration;
  bool get playing;
  Stream<Duration> get positionStream;
  Stream<bool> get playingStream;
  Future<Duration?> setFile(String path);
  Future<void> play();
  Future<void> pause();
  Future<void> seek(Duration d);
  Future<void> setSpeed(double s);
  double get speed;
  Future<void> dispose();
}

class JustAudioPlayback implements Playback {
  final _p = AudioPlayer();
  @override
  Duration get position => _p.position;
  @override
  Duration? get duration => _p.duration;
  @override
  bool get playing => _p.playing;
  @override
  Stream<Duration> get positionStream => _p.positionStream;
  @override
  Stream<bool> get playingStream => _p.playingStream;
  @override
  Future<Duration?> setFile(String path) => _p.setFilePath(path);
  @override
  Future<void> play() async {
    unawaited(_p.play());
  }

  @override
  Future<void> pause() => _p.pause();
  @override
  Future<void> seek(Duration d) => _p.seek(d < Duration.zero ? Duration.zero : d);
  @override
  Future<void> setSpeed(double s) => _p.setSpeed(s);
  @override
  double get speed => _p.speed;
  @override
  Future<void> dispose() => _p.dispose();
}

/// Deterministic clock used by widget tests.
class FakePlayback implements Playback {
  FakePlayback({this.length = const Duration(minutes: 3)});
  Duration length;
  Duration _pos = Duration.zero;
  bool _playing = false;
  double _speed = 1;
  final _posCtl = StreamController<Duration>.broadcast(), _playCtl = StreamController<bool>.broadcast();
  void advance(Duration d) {
    _pos += d * _speed;
    _posCtl.add(_pos);
  }

  @override
  Duration get position => _pos;
  @override
  Duration? get duration => length;
  @override
  bool get playing => _playing;
  @override
  Stream<Duration> get positionStream => _posCtl.stream;
  @override
  Stream<bool> get playingStream => _playCtl.stream;
  @override
  Future<Duration?> setFile(String path) async => length;
  @override
  Future<void> play() async {
    _playing = true;
    _playCtl.add(true);
  }

  @override
  Future<void> pause() async {
    _playing = false;
    _playCtl.add(false);
  }

  @override
  Future<void> seek(Duration d) async {
    _pos = d < Duration.zero ? Duration.zero : d;
    _posCtl.add(_pos);
  }

  @override
  Future<void> setSpeed(double s) async => _speed = s;
  @override
  double get speed => _speed;
  @override
  Future<void> dispose() async {}
}
