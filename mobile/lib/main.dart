import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'export_ass.dart' show hiddenLineCount;
import 'lyrics_format.dart';
import 'playback.dart';
import 'project.dart';
import 'services.dart';
import 'sync.dart';
import 'vocal_detector.dart' show DetectionResult;

const lime = Color(0xFFC8F36B);
const pink = Color(0xFFFF6FAE);
const panel = Color(0xFF141B27);
const panel2 = Color(0xFF1B2433);

void main() => runApp(const LyricsApp());

class LyricsApp extends StatelessWidget {
  const LyricsApp({super.key, this.playback, this.services});
  final Playback Function()? playback;
  final StudioServices? services;
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'LYRICS Studio',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          brightness: Brightness.dark,
          scaffoldBackgroundColor: const Color(0xFF090C13),
          colorScheme: ColorScheme.fromSeed(seedColor: lime, brightness: Brightness.dark),
          useMaterial3: true,
          inputDecorationTheme: InputDecorationTheme(
            filled: true,
            fillColor: panel,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: Colors.white12)),
            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: Colors.white12)),
            focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: lime)),
          ),
        ),
        home: StudioHome(playback: playback ?? JustAudioPlayback.new, services: services ?? DeviceServices()),
      );
}

class ThemePreset {
  const ThemePreset(this.id, this.name, this.description, this.colors, this.accent, this.motion);
  final String id, name, description, motion;
  final List<Color> colors;
  final Color accent;
}

const themes = [
  ThemePreset('aurora', 'Aurora Flow', 'Moving northern lights', [Color(0xFF071B35), Color(0xFF51316F), Color(0xFF08111E)], lime, 'aurora'),
  ThemePreset('ember', 'Golden Ember', 'Warm cinematic glow', [Color(0xFF32120F), Color(0xFF91451F), Color(0xFF120B18)], Color(0xFFFFC36A), 'ember'),
  ThemePreset('ocean', 'Deep Ocean', 'Blue flowing light', [Color(0xFF031B2B), Color(0xFF07506A), Color(0xFF07121E)], Color(0xFF70E4E8), 'ocean'),
  ThemePreset('velvet', 'Velvet Night', 'Elegant purple atmosphere', [Color(0xFF160D2B), Color(0xFF512C69), Color(0xFF0A0A18)], Color(0xFFE6B7FF), 'velvet'),
  ThemePreset('minimal', 'Minimal Light', 'Clean editorial look', [Color(0xFF101820), Color(0xFF263746), Color(0xFF101820)], Colors.white, 'minimal'),
];

const swatches = [0xFFFFFFFF, 0xFFC8F36B, 0xFFFFE14D, 0xFFFF6FAE, 0xFF70E4E8, 0xFFE6B7FF, 0xFFFFC36A, 0xFF0B0C10];

String fmtMs(int? ms, {bool tenths = true}) {
  if (ms == null) return '--:--';
  final t = ms < 0 ? 0 : ms;
  final m = t ~/ 60000, s = t % 60000 ~/ 1000, d = t % 1000 ~/ 100;
  return tenths ? '$m:${s.toString().padLeft(2, '0')}.$d' : '$m:${s.toString().padLeft(2, '0')}';
}

class StudioHome extends StatefulWidget {
  const StudioHome({super.key, required this.playback, required this.services});
  final Playback Function() playback;
  final StudioServices services;
  @override
  State<StudioHome> createState() => _StudioHomeState();
}

class _StudioHomeState extends State<StudioHome> with SingleTickerProviderStateMixin {
  late final Playback player = widget.playback();
  final titleCtl = TextEditingController();
  final clock = ValueNotifier<int>(0); // playback position in ms (media time)
  late final Ticker _ticker = createTicker((_) {
    if (player.playing) clock.value = player.position.inMilliseconds;
  });
  StreamSubscription<Duration>? _posSub;
  List<Project> projects = [];
  Project? current;
  int tab = 0;
  bool loading = true, rendering = false;
  String renderStatus = '';
  Timer? saveTimer;
  final undo = <String>[], redo = <String>[];
  String _snapshot = '';
  List<String>? syncIds;
  int syncIndex = 0;
  double? detectProgress;
  bool _cancelDetect = false;
  Timer? _previewStop;

  StudioServices get svc => widget.services;

  @override
  void initState() {
    super.initState();
    _ticker.start();
    _posSub = player.positionStream.listen((d) => clock.value = d.inMilliseconds);
    _load();
  }

  @override
  void dispose() {
    saveTimer?.cancel();
    _previewStop?.cancel();
    _posSub?.cancel();
    _ticker.dispose();
    player.dispose();
    titleCtl.dispose();
    clock.dispose();
    super.dispose();
  }

  // ---- persistence + history --------------------------------------------------------------------------------
  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    try {
      projects = (jsonDecode(prefs.getString('lyrics_projects') ?? '[]') as List).map((e) => Project.fromJson(Map<String, dynamic>.from(e as Map))).toList();
    } catch (_) {
      projects = [];
    }
    if (mounted) setState(() => loading = false);
  }

  Future<void> _persist() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('lyrics_projects', jsonEncode(projects.map((e) => e.toJson()).toList()));
  }

  /// Every edit goes through here: records an undo step, saves (debounced) and rebuilds.
  void commit() {
    final p = current;
    if (p != null) {
      final now = jsonEncode(p.toJson());
      if (now != _snapshot) {
        if (_snapshot.isNotEmpty) undo.add(_snapshot);
        if (undo.length > 60) undo.removeAt(0);
        redo.clear();
        _snapshot = now;
      }
    }
    saveTimer?.cancel();
    saveTimer = Timer(const Duration(milliseconds: 400), _persist);
    if (mounted) setState(() {});
  }

  void _restore(String json) {
    final p = Project.fromJson(jsonDecode(json) as Map<String, dynamic>);
    final i = projects.indexWhere((e) => e.id == p.id);
    if (i >= 0) projects[i] = p;
    current = p;
    _snapshot = json;
    titleCtl.text = p.title;
    saveTimer?.cancel();
    saveTimer = Timer(const Duration(milliseconds: 400), _persist);
    setState(() {});
  }

  void _undo() {
    if (undo.isEmpty) return;
    redo.add(_snapshot);
    _restore(undo.removeLast());
  }

  void _redo() {
    if (redo.isEmpty) return;
    undo.add(_snapshot);
    _restore(redo.removeLast());
  }

  // ---- projects ------------------------------------------------------------------------------------------------
  Future<void> _open(Project p) async {
    await player.pause();
    setState(() {
      current = p;
      titleCtl.text = p.title;
      tab = 1;
      undo.clear();
      redo.clear();
      _snapshot = jsonEncode(p.toJson());
      syncIds = null;
      clock.value = 0;
    });
    if (p.audioPath != null && (p.audioPath!.startsWith('/fake') || File(p.audioPath!).existsSync())) {
      final d = await player.setFile(p.audioPath!);
      if (d != null && d.inMilliseconds != p.durationMs) {
        p.durationMs = d.inMilliseconds;
        commit();
      }
    }
  }

  Future<void> _new() async {
    final p = Project(newId(), 'Untitled project');
    projects.insert(0, p);
    await _open(p);
    commit();
  }

  Future<void> _delete(Project p) async {
    final ok = await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(title: const Text('Delete project?'), content: Text('“${p.title}” will be removed from this phone.'), actions: [
              TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
              FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Delete')),
            ]));
    if (ok != true) return;
    setState(() {
      projects.remove(p);
      if (current == p) current = null;
    });
    await _persist();
  }

  Future<void> _importSong() async {
    final p = current;
    if (p == null) return;
    final path = await svc.pickAndCopy(FileType.audio, 'audio', p.id);
    if (path == null) return;
    final d = await player.setFile(path);
    p.audioPath = path;
    p.durationMs = (d ?? Duration.zero).inMilliseconds;
    commit();
  }

  Future<void> _pickBackground() async {
    final p = current;
    if (p == null) return;
    final path = await svc.pickAndCopy(FileType.image, 'images', p.id);
    if (path == null) return;
    p.backgroundImage = path;
    commit();
  }

  // ---- lyrics ------------------------------------------------------------------------------------------------
  Future<void> _editText() async {
    final p = current!;
    final ctl = TextEditingController(text: p.lines.map((l) => l.text).join('\n'));
    final saved = await Navigator.push<String>(
        context,
        MaterialPageRoute(
            fullscreenDialog: true,
            builder: (c) => Scaffold(
                  appBar: AppBar(title: const Text('Lyrics'), actions: [TextButton(onPressed: () => Navigator.pop(c, ctl.text), child: const Text('Save'))]),
                  body: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(children: [
                      const Text('One lyric per line. Lyrics only appear once timed — set when the singer starts, then tap along. You can also paste .LRC or .SRT text.',
                          style: TextStyle(color: Colors.white60, fontSize: 12, height: 1.5)),
                      const SizedBox(height: 10),
                      Expanded(child: TextField(key: const Key('lyricsText'), controller: ctl, maxLines: null, expands: true, textAlignVertical: TextAlignVertical.top, style: const TextStyle(height: 1.7))),
                    ]),
                  ),
                )));
    if (saved == null) return;
    final rows = saved.split('\n').map((e) => e.trim()).where((e) => e.isNotEmpty).toList();
    final old = p.lines.where((l) => l.hasText).toList();
    if (rows.length == old.length && !RegExp(r'\[\d+:\d+|-->').hasMatch(saved)) {
      for (var i = 0; i < rows.length; i++) {
        old[i].text = rows[i]; // only the words changed — keep every timestamp
      }
      p.lines = old;
    } else {
      p.lines = parseLyrics(saved);
    }
    commit();
  }

  Future<void> _importLyrics() async {
    final text = await svc.pickTextFile();
    if (text == null) return;
    final lines = parseLyrics(text);
    if (lines.isEmpty) return _toast('No lyric lines found in that file.');
    current!.lines = lines;
    commit();
    _toast('${lines.length} lines imported · ${lines.where((l) => l.synced).length} already timed');
  }

  Future<void> _exportLyrics(String kind) async {
    final p = current!;
    final text = kind == 'lrc' ? toLrc(p.lines, title: p.title) : toSrt(p.resolve().cues);
    final saved = await svc.saveFile('${p.title}.$kind', Uint8List.fromList(utf8.encode(text)));
    if (saved != null) _toast('Saved ${p.title}.$kind');
  }

  // ---- vocal start + tap sync ----------------------------------------------------------------------------------
  void _startSync({String? fromId}) {
    final p = current!;
    final ids = p.lines.where((l) => l.hasText).map((l) => l.id).toList();
    if (ids.isEmpty) return _toast('Write your lyrics first.');
    if (p.audioPath == null) return _toast('Import a song first.');
    final from = fromId == null ? 0 : math.max(0, ids.indexOf(fromId));
    setState(() {
      syncIds = ids;
      syncIndex = from;
    });
    final prev = from > 0 ? p.lines.firstWhere((l) => l.id == ids[from - 1]) : null;
    player.seek(Duration(milliseconds: from == 0 ? 0 : math.max(0, (prev?.startMs ?? player.position.inMilliseconds) - 1000)));
    player.play();
  }

  void tapSync() {
    final p = current, ids = syncIds;
    if (p == null || ids == null || syncIndex >= ids.length) return;
    final t = player.position.inMilliseconds;
    final l = p.lines.firstWhere((x) => x.id == ids[syncIndex]);
    l.startMs = t;
    l.endMs = null;
    if (syncIndex == 0) {
      // The first tap is the moment the singer starts.
      p.vocalStartMs = t;
      p.vocalStartSource = 'manual';
      p.detection?.decision = 'replaced';
    }
    syncIndex++;
    if (syncIndex >= ids.length) {
      _stopSync();
    } else {
      setState(() {});
    }
  }

  void _stopSync() {
    final n = syncIndex;
    player.pause();
    setState(() => syncIds = null);
    commit();
    _toast(n == 0 ? 'Sync stopped' : '$n line${n == 1 ? '' : 's'} synced');
  }

  void _setVocal(int? ms, String? source) {
    current!.applyVocalStart(ms, source);
    commit();
  }

  void _nudgeVocal(int d) {
    final p = current!;
    if (p.vocalStartMs == null) return;
    _setVocal(math.max(0, p.vocalStartMs! + d), 'manual');
    player.pause();
    player.seek(Duration(milliseconds: p.vocalStartMs!));
  }

  void _previewAt(int ms, {int leadMs = 3000}) {
    player.seek(Duration(milliseconds: math.max(0, ms - leadMs)));
    player.play();
    _previewStop?.cancel();
    _previewStop = Timer(Duration(milliseconds: leadMs + 4000), () => player.pause());
  }

  Future<void> _detect() async {
    final p = current!;
    if (p.audioPath == null) return _toast('Import a song first.');
    await player.pause();
    setState(() {
      detectProgress = 0;
      _cancelDetect = false;
    });
    try {
      final r = await svc.detect(p, onProgress: (f) {
        if (mounted) setState(() => detectProgress = f);
      }, cancelled: () => _cancelDetect);
      r.decision = 'pending';
      p.detection = r; // proposed only — never applied without the user
      commit();
      if (r.vocalStartMs == null) _toast('No singing detected — tap the start yourself.');
    } catch (e) {
      if (e.toString() != 'Analysis cancelled') _toast('Analysis failed: $e');
    } finally {
      if (mounted) setState(() => detectProgress = null);
    }
  }

  void _resetTiming() async {
    final ok = await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(title: const Text('Reset all timing?'), content: const Text('Every lyric and the vocal start become untimed. The words stay.'), actions: [
              TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
              FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Reset')),
            ]));
    if (ok != true) return;
    final p = current!;
    for (final l in p.lines) {
      l.startMs = null;
      l.endMs = null;
    }
    p.vocalStartMs = null;
    p.vocalStartSource = null;
    commit();
  }

  // ---- export ------------------------------------------------------------------------------------------------
  Future<void> _render() async {
    final p = current;
    if (p == null) return;
    if (p.audioPath == null) return _toast('Import a song before exporting.');
    final r = p.resolve();
    if (r.cues.isEmpty) return _toast('No lyric is timed yet. Set when the singer starts or sync the lines first.');
    final hidden = hiddenLineCount(p);
    if (hidden > 0) {
      final go = await showDialog<bool>(
          context: context,
          builder: (c) => AlertDialog(title: const Text('Some lines are not timed'), content: Text('$hidden line${hidden == 1 ? '' : 's'} will not appear in the video. Export anyway?'), actions: [
                TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Go back')),
                FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Export')),
              ]));
      if (go != true) return;
    }
    await player.pause();
    setState(() {
      rendering = true;
      renderStatus = 'Preparing your video…';
    });
    try {
      final t = _theme(p);
      String hex(Color c) => '0x${(c.r * 255).round().toRadixString(16).padLeft(2, '0')}${(c.g * 255).round().toRadixString(16).padLeft(2, '0')}${(c.b * 255).round().toRadixString(16).padLeft(2, '0')}';
      final out = await svc.render(p, durationMs: p.durationMs > 0 ? p.durationMs : (player.duration?.inMilliseconds ?? 0), bgHex: hex(t.colors.first), accentHex: hex(t.colors[1]),
          onStatus: (s) => mounted ? setState(() => renderStatus = s) : null);
      if (!mounted) return;
      setState(() => renderStatus = 'Video ready.');
      final save = await showDialog<bool>(
          context: context,
          builder: (c) => AlertDialog(title: const Text('Your lyric video is ready'), content: const Text('Save a copy where you can find it (for example Downloads or Movies)?'), actions: [
                TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Later')),
                FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Save video')),
              ]));
      if (save == true) {
        final where = await svc.saveFile('${p.title}.mp4', await File(out).readAsBytes());
        if (where != null) _toast('Video saved.');
      }
    } catch (e) {
      if (mounted) setState(() => renderStatus = 'Export failed: $e');
    } finally {
      if (mounted) setState(() => rendering = false);
    }
  }

  void _toast(String s) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s), behavior: SnackBarBehavior.floating));
  }

  ThemePreset _theme(Project? p) => themes.firstWhere((e) => e.id == p?.theme, orElse: () => themes.first);

  // ---- UI ---------------------------------------------------------------------------------------------------------
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: const Row(children: [Icon(Icons.graphic_eq, color: lime), SizedBox(width: 9), Text('LYRICS', style: TextStyle(fontWeight: FontWeight.w900, letterSpacing: 2))]),
          actions: [
            if (current != null && tab != 0) ...[
              IconButton(tooltip: 'Undo', onPressed: undo.isEmpty ? null : _undo, icon: const Icon(Icons.undo)),
              IconButton(tooltip: 'Redo', onPressed: redo.isEmpty ? null : _redo, icon: const Icon(Icons.redo)),
            ],
          ],
        ),
        body: loading ? const Center(child: CircularProgressIndicator(color: lime)) : SafeArea(child: tab == 0 ? _library() : tab == 1 ? _studio() : _styleTab()),
        bottomNavigationBar: NavigationBar(selectedIndex: tab, onDestinationSelected: (v) => setState(() => tab = v), destinations: const [
          NavigationDestination(icon: Icon(Icons.library_music_outlined), label: 'Projects'),
          NavigationDestination(icon: Icon(Icons.edit_note), label: 'Studio'),
          NavigationDestination(icon: Icon(Icons.auto_awesome), label: 'Themes'),
        ]),
      );

  Widget _library() => ListView(padding: const EdgeInsets.all(18), children: [
        const Text('YOUR CREATIVE SPACE', style: TextStyle(color: lime, letterSpacing: 2, fontSize: 11, fontWeight: FontWeight.bold)),
        const SizedBox(height: 10),
        const Text('Make lyrics\ncome alive.', style: TextStyle(fontSize: 38, height: 1.05, fontWeight: FontWeight.w900, letterSpacing: -1.5)),
        const SizedBox(height: 12),
        const Text('Turn your words and music into lyric videos — right on your phone, fully offline.', style: TextStyle(color: Colors.white60, height: 1.5)),
        const SizedBox(height: 22),
        FilledButton.icon(
            onPressed: _new,
            icon: const Icon(Icons.add),
            label: const Text('Create a video project'),
            style: FilledButton.styleFrom(backgroundColor: lime, foregroundColor: Colors.black, minimumSize: const Size.fromHeight(54))),
        const SizedBox(height: 25),
        const Text('YOUR PROJECTS', style: TextStyle(letterSpacing: 2, fontSize: 11, color: Colors.white60)),
        const SizedBox(height: 12),
        if (projects.isEmpty)
          const Card(
              color: panel,
              child: Padding(
                  padding: EdgeInsets.all(25),
                  child: Column(children: [
                    Icon(Icons.movie_creation_outlined, color: lime, size: 42),
                    SizedBox(height: 10),
                    Text('Your first video starts here', style: TextStyle(fontWeight: FontWeight.bold)),
                    Text('Create a project, import a song and write your lyrics.', textAlign: TextAlign.center, style: TextStyle(color: Colors.white54)),
                  ])))
        else
          ...projects.map((p) {
            final r = p.resolve();
            return Card(
                color: panel,
                child: ListTile(
                  leading: const Icon(Icons.video_library, color: lime),
                  title: Text(p.title),
                  subtitle: Text('${r.total} lines · ${r.syncedCount} synced · ${p.audioPath == null ? 'No song' : fmtMs(p.durationMs, tenths: false)}'),
                  trailing: IconButton(tooltip: 'Delete', icon: const Icon(Icons.delete_outline), onPressed: () => _delete(p)),
                  onTap: () => _open(p),
                ));
          }),
      ]);

  Widget _heading(String n, String s) => Padding(
      padding: const EdgeInsets.only(bottom: 9, top: 16),
      child: Row(children: [Text(n, style: const TextStyle(color: lime, fontSize: 10)), const SizedBox(width: 10), Text(s, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, letterSpacing: 1.2))]));

  Widget _studio() {
    final p = current;
    if (p == null) return Center(child: FilledButton.icon(onPressed: _new, icon: const Icon(Icons.add), label: const Text('Create project')));
    if (syncIds != null) return _syncView(p);
    final r = p.resolve();
    return ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [
      TextField(
          controller: titleCtl,
          decoration: const InputDecoration(labelText: 'Project title', prefixIcon: Icon(Icons.title)),
          onChanged: (v) {
            p.title = v.trim().isEmpty ? 'Untitled project' : v.trim();
            commit();
          }),
      _heading('01', 'MUSIC & PREVIEW'),
      _musicCard(p),
      const SizedBox(height: 12),
      ClipRRect(borderRadius: BorderRadius.circular(20), child: SizedBox(height: 320, child: ValueListenableBuilder<int>(valueListenable: clock, builder: (_, t, __) => LyricPreview(project: p, theme: _theme(p), tMs: t)))),
      _heading('02', 'WHEN DOES THE SINGER START?'),
      _vocalCard(p),
      _heading('03', 'LYRICS'),
      Row(children: [
        Expanded(child: FilledButton.tonalIcon(key: const Key('editLyrics'), onPressed: _editText, icon: const Icon(Icons.edit), label: Text(p.lines.isEmpty ? 'Write lyrics' : 'Edit text'))),
        const SizedBox(width: 8),
        Expanded(child: FilledButton.tonalIcon(key: const Key('tapSync'), onPressed: p.lines.isEmpty ? null : () => _startSync(), icon: const Icon(Icons.touch_app), label: const Text('Tap to sync'))),
      ]),
      const SizedBox(height: 6),
      Wrap(spacing: 4, children: [
        TextButton.icon(onPressed: _importLyrics, icon: const Icon(Icons.file_open_outlined, size: 18), label: const Text('Import .lrc/.srt')),
        TextButton(onPressed: p.lines.isEmpty ? null : () => _exportLyrics('lrc'), child: const Text('Save .lrc')),
        TextButton(onPressed: r.cues.isEmpty ? null : () => _exportLyrics('srt'), child: const Text('Save .srt')),
      ]),
      if (r.total > 0) Text('${r.syncedCount} of ${r.total} lines synced${r.syncedCount < r.total ? ' · ≈ estimated · --:-- hidden until timed' : ''}', style: const TextStyle(color: Colors.white54, fontSize: 11)),
      ..._lineTiles(p, r),
      if (r.syncedCount > 0) Align(alignment: Alignment.centerLeft, child: TextButton(onPressed: _resetTiming, child: const Text('Reset timing and sync again', style: TextStyle(color: Colors.redAccent)))),
      _heading('04', 'EXPORT'),
      FilledButton.icon(
          key: const Key('render'),
          onPressed: rendering ? null : _render,
          icon: rendering ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black)) : const Icon(Icons.movie_creation),
          label: Text(rendering ? 'Rendering MP4…' : 'Render and export MP4'),
          style: FilledButton.styleFrom(backgroundColor: lime, foregroundColor: Colors.black, minimumSize: const Size.fromHeight(56), textStyle: const TextStyle(fontWeight: FontWeight.w900))),
      if (renderStatus.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 10), child: Text(renderStatus, style: const TextStyle(color: Colors.white60, fontSize: 11))),
    ]);
  }

  Widget _musicCard(Project p) => Card(
      color: panel,
      child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(children: [
            Row(children: [
              const Icon(Icons.music_note, color: lime),
              const SizedBox(width: 8),
              Expanded(child: Text(p.audioPath?.split('/').last ?? 'No song selected', maxLines: 1, overflow: TextOverflow.ellipsis)),
              TextButton.icon(key: const Key('importSong'), onPressed: _importSong, icon: const Icon(Icons.folder_open, color: lime), label: Text(p.audioPath == null ? 'Import' : 'Change')),
            ]),
            if (p.audioPath != null)
              ValueListenableBuilder<int>(
                  valueListenable: clock,
                  builder: (_, t, __) {
                    final total = p.durationMs > 0 ? p.durationMs : (player.duration?.inMilliseconds ?? 0);
                    return Column(children: [
                      SizedBox(
                          height: 36,
                          child: Stack(alignment: Alignment.center, children: [
                            Slider(
                                value: total == 0 ? 0 : t.clamp(0, total).toDouble(),
                                max: total == 0 ? 1 : total.toDouble(),
                                activeColor: lime,
                                onChanged: (v) {
                                  player.seek(Duration(milliseconds: v.round()));
                                  clock.value = v.round();
                                }),
                            if (p.vocalStartMs != null && total > 0)
                              Positioned.fill(
                                  child: IgnorePointer(
                                      child: LayoutBuilder(
                                          builder: (_, c) => Stack(children: [
                                                Positioned(left: 24 + (c.maxWidth - 48) * (p.vocalStartMs! / total).clamp(0, 1) - 4, top: 4, child: const Icon(Icons.mic, size: 10, color: pink)),
                                              ])))),
                          ])),
                      Row(children: [Text(fmtMs(t), style: const TextStyle(color: Colors.white54, fontSize: 11)), const Spacer(), Text(fmtMs(total), style: const TextStyle(color: Colors.white54, fontSize: 11))]),
                    ]);
                  }),
            if (p.audioPath != null)
              Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                IconButton(onPressed: () => player.seek(player.position - const Duration(seconds: 5)), icon: const Icon(Icons.replay_5)),
                StreamBuilder<bool>(
                    stream: player.playingStream,
                    builder: (context, s) => IconButton.filled(
                        key: const Key('playPause'),
                        onPressed: () => player.playing ? player.pause() : player.play(),
                        icon: Icon(player.playing ? Icons.pause : Icons.play_arrow),
                        style: IconButton.styleFrom(backgroundColor: lime, foregroundColor: Colors.black))),
                IconButton(onPressed: () => player.seek(player.position + const Duration(seconds: 5)), icon: const Icon(Icons.forward_5)),
                PopupMenuButton<double>(
                    tooltip: 'Playback speed',
                    initialValue: player.speed,
                    onSelected: (s) => setState(() => player.setSpeed(s)),
                    itemBuilder: (_) => [for (final s in [0.5, 0.75, 1.0, 1.25]) PopupMenuItem(value: s, child: Text('$s×'))],
                    child: Padding(padding: const EdgeInsets.all(8), child: Text('${player.speed}×', style: const TextStyle(color: Colors.white70)))),
              ]),
          ])));

  Widget _vocalCard(Project p) {
    final vs = p.vocalStartMs;
    final src = {'manual': 'Set by you', 'detected': 'Detected automatically — you confirmed it', 'none': 'Song starts with vocals'}[p.vocalStartSource] ?? '';
    final det = p.detection;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(gradient: const LinearGradient(colors: [Color(0x22FF6FAE), Color(0x1A8B7BFF)]), borderRadius: BorderRadius.circular(18), border: Border.all(color: Colors.white12)),
      child: detectProgress != null
          ? Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Row(children: [Icon(Icons.auto_fix_high, color: pink), SizedBox(width: 8), Text('Listening for the singer…', style: TextStyle(fontWeight: FontWeight.bold))]),
              const SizedBox(height: 6),
              const Text('Analysed on this phone. Nothing is uploaded.', style: TextStyle(color: Colors.white54, fontSize: 12)),
              const SizedBox(height: 10),
              LinearProgressIndicator(value: detectProgress, color: lime),
              const SizedBox(height: 6),
              Row(children: [Text('${((detectProgress ?? 0) * 100).round()}%', style: const TextStyle(color: Colors.white54)), const Spacer(), TextButton(onPressed: () => _cancelDetect = true, child: const Text('Cancel'))]),
            ])
          : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                const Icon(Icons.mic, color: pink, size: 20),
                const SizedBox(width: 8),
                const Expanded(child: Text('Singer starts at', overflow: TextOverflow.ellipsis, style: TextStyle(color: Colors.white70))),
                Text(vs == null ? 'Not set' : fmtMs(vs), key: const Key('vocalStart'), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
              ]),
              const SizedBox(height: 4),
              Text(vs == null ? 'Lyrics stay hidden during the intro until you set this or sync the first line.' : src, style: const TextStyle(color: Colors.white54, fontSize: 12)),
              if (vs != null) ...[
                const SizedBox(height: 8),
                Wrap(spacing: 6, runSpacing: 6, children: [
                  for (final d in [-500, -100, 100, 500]) ActionChip(label: Text('${d > 0 ? '+' : '−'}${(d.abs() / 1000).toStringAsFixed(1)}s'), onPressed: () => _nudgeVocal(d)),
                  ActionChip(avatar: const Icon(Icons.play_arrow, size: 16), label: const Text('Preview'), onPressed: () => _previewAt(vs)),
                ]),
              ],
              const SizedBox(height: 10),
              Row(children: [
                Expanded(
                    child: FilledButton.icon(
                        key: const Key('tapStart'),
                        onPressed: () => _startSync(),
                        icon: const Icon(Icons.touch_app),
                        label: Text(vs == null ? 'Tap when singer starts' : 'Re-tap start'),
                        style: FilledButton.styleFrom(backgroundColor: lime, foregroundColor: Colors.black))),
                const SizedBox(width: 8),
                FilledButton.tonalIcon(key: const Key('detect'), onPressed: _detect, icon: const Icon(Icons.auto_fix_high), label: const Text('Detect')),
              ]),
              Wrap(spacing: 8, children: [
                TextButton(onPressed: () => _setVocal(0, 'none'), child: const Text('Song starts with vocals')),
                if (vs != null) TextButton(onPressed: () => _setVocal(null, null), child: const Text('Clear')),
              ]),
              if (det != null && det.decision == 'pending') _detectionCard(p, det),
            ]),
    );
  }

  int _pick = 0;
  Widget _detectionCard(Project p, DetectionResult d) {
    if (d.vocalStartMs == null) {
      return _resultBox(Colors.white24, [
        const Text('No singing found', style: TextStyle(fontWeight: FontWeight.bold)),
        const Text('The analysis did not hear a singer. If this song has vocals, use “Tap when singer starts”.', style: TextStyle(color: Colors.white60, fontSize: 12)),
        TextButton(
            onPressed: () {
              d.decision = 'rejected';
              commit();
            },
            child: const Text('OK')),
      ]);
    }
    final int pick = _pick.clamp(0, math.max(0, d.candidates.length - 1)).toInt();
    final ms = d.candidates.isEmpty ? d.vocalStartMs! : d.candidates[pick].ms;
    final level = d.candidates.isEmpty ? d.level : d.candidates[pick].level;
    final color = level == 'high' ? lime : level == 'medium' ? const Color(0xFFFFC24B) : Colors.white38;
    final msg = {'high': 'Clear change from instrumental to singing.', 'medium': 'Probably right — listen before you use it.', 'low': 'Not sure — please listen and confirm, or tap the start yourself.'}[level] ?? '';
    return _resultBox(color, [
      Row(children: [
        Expanded(child: Text('Detected singing at ${fmtMs(ms)}', key: const Key('detected'), style: const TextStyle(fontWeight: FontWeight.bold))),
        Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2), decoration: BoxDecoration(color: color.withValues(alpha: .18), borderRadius: BorderRadius.circular(99)), child: Text('${level.toUpperCase()} CONFIDENCE', style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.bold))),
      ]),
      const SizedBox(height: 4),
      Text(msg, style: const TextStyle(color: Colors.white60, fontSize: 12)),
      const SizedBox(height: 8),
      Row(children: [
        OutlinedButton.icon(onPressed: () => _previewAt(ms), icon: const Icon(Icons.play_arrow), label: const Text('Listen')),
        const SizedBox(width: 8),
        Expanded(
            child: FilledButton(
                key: const Key('useDetected'),
                onPressed: () {
                  d.decision = 'accepted';
                  _setVocal(ms, 'detected');
                  _toast('Vocal start set — fine-tune with the ± buttons');
                },
                child: Text(level == 'high' ? 'Use this time' : 'Use anyway'))),
      ]),
      Wrap(children: [
        if (d.candidates.length > 1) TextButton(onPressed: () => setState(() => _pick = (pick + 1) % d.candidates.length), child: Text('Other guess (${fmtMs(d.candidates[(pick + 1) % d.candidates.length].ms)})')),
        TextButton(
            onPressed: () {
              d.decision = 'rejected';
              commit();
            },
            child: const Text('Dismiss')),
      ]),
    ]);
  }

  Widget _resultBox(Color border, List<Widget> children) => Container(
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: panel, borderRadius: BorderRadius.circular(14), border: Border.all(color: border)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children));

  List<Widget> _lineTiles(Project p, Resolved r) {
    final cueOf = {for (final c in r.cues) c.id: c};
    return [
      for (final l in p.lines.where((l) => l.hasText))
        ValueListenableBuilder<int>(
            valueListenable: clock,
            builder: (_, t, __) {
              final c = cueOf[l.id], active = c != null && c.activeAt(t);
              final label = l.synced ? fmtMs(l.startMs) : c != null ? '≈${fmtMs(c.startMs)}' : '--:--';
              return ListTile(
                key: Key('line-${l.id}'),
                dense: true,
                tileColor: active ? lime.withValues(alpha: .09) : null,
                leading: Container(
                    width: 64,
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    decoration: BoxDecoration(color: active ? lime : panel2, borderRadius: BorderRadius.circular(8)),
                    child: Text(label, textAlign: TextAlign.center, style: TextStyle(fontSize: 11, color: active ? Colors.black : (l.synced ? Colors.white : Colors.white38), fontStyle: l.synced ? FontStyle.normal : FontStyle.italic))),
                title: Text(l.text, maxLines: 1, overflow: TextOverflow.ellipsis),
                trailing: IconButton(tooltip: 'Replay this line', icon: const Icon(Icons.play_arrow, size: 20), onPressed: c == null ? null : () => _previewAt(c.startMs, leadMs: 1500)),
                onTap: () => _editLine(p, l),
              );
            }),
    ];
  }

  Future<void> _editLine(Project p, LyricLine l) async {
    final textCtl = TextEditingController(text: l.text);
    await showModalBottomSheet(
        context: context,
        isScrollControlled: true,
        backgroundColor: panel,
        builder: (c) => StatefulBuilder(builder: (c, set) {
              final cue = p.resolve().cues.where((q) => q.id == l.id).firstOrNull;
              void change(void Function() f) {
                f();
                commit();
                set(() {});
              }

              return Padding(
                padding: EdgeInsets.fromLTRB(18, 18, 18, 18 + MediaQuery.of(c).viewInsets.bottom),
                child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                  TextField(controller: textCtl, decoration: const InputDecoration(labelText: 'Lyric'), onChanged: (v) => change(() => l.text = v)),
                  const SizedBox(height: 14),
                  Row(children: [
                    const Text('Starts', style: TextStyle(color: Colors.white60)),
                    const Spacer(),
                    if (l.synced) IconButton(onPressed: () => change(() => l.startMs = math.max(0, l.startMs! - 100)), icon: const Icon(Icons.remove)),
                    Text(l.synced ? fmtMs(l.startMs) : (cue != null ? '≈ ${fmtMs(cue.startMs)} (estimated)' : 'Not timed'), style: const TextStyle(fontWeight: FontWeight.bold)),
                    if (l.synced) IconButton(onPressed: () => change(() => l.startMs = l.startMs! + 100), icon: const Icon(Icons.add)),
                  ]),
                  Row(children: [
                    const Text('Ends', style: TextStyle(color: Colors.white60)),
                    const Spacer(),
                    if (l.synced && cue != null) IconButton(onPressed: () => change(() => l.endMs = math.max(l.startMs! + minLineMs, cue.endMs - 250)), icon: const Icon(Icons.remove)),
                    Text(cue == null ? '—' : '${fmtMs(cue.endMs)}${l.endMs == null ? ' (next line)' : ''}', style: const TextStyle(fontWeight: FontWeight.bold)),
                    if (l.synced && cue != null) IconButton(onPressed: () => change(() => l.endMs = cue.endMs + 250), icon: const Icon(Icons.add)),
                  ]),
                  Wrap(spacing: 8, runSpacing: 8, children: [
                    FilledButton.tonalIcon(
                        onPressed: () => change(() {
                              l.startMs = player.position.inMilliseconds;
                              l.endMs = null;
                              if (p.lines.where((x) => x.hasText).firstOrNull == l) {
                                p.vocalStartMs = l.startMs;
                                p.vocalStartSource = 'manual';
                              }
                            }),
                        icon: const Icon(Icons.touch_app),
                        label: Text('Start at ${fmtMs(player.position.inMilliseconds)}')),
                    if (l.endMs != null) OutlinedButton(onPressed: () => change(() => l.endMs = null), child: const Text('End with next line')),
                    if (cue != null) OutlinedButton.icon(onPressed: () => _previewAt(cue.startMs, leadMs: 1500), icon: const Icon(Icons.play_arrow), label: const Text('Replay')),
                    OutlinedButton.icon(onPressed: () => _startSyncFrom(c, l), icon: const Icon(Icons.fast_forward), label: const Text('Sync from here')),
                    TextButton.icon(
                        onPressed: () {
                          p.lines.remove(l);
                          commit();
                          Navigator.pop(c);
                        },
                        icon: const Icon(Icons.delete_outline, color: Colors.redAccent),
                        label: const Text('Delete', style: TextStyle(color: Colors.redAccent))),
                  ]),
                ]),
              );
            }));
  }

  void _startSyncFrom(BuildContext sheet, LyricLine l) {
    Navigator.pop(sheet);
    _startSync(fromId: l.id);
  }

  Widget _syncView(Project p) {
    final ids = syncIds!;
    String at(int k) => k >= 0 && k < ids.length ? p.lines.firstWhere((l) => l.id == ids[k]).text : '';
    final first = syncIndex == 0;
    return Padding(
      padding: const EdgeInsets.all(18),
      child: Column(children: [
        Text(first ? 'Listen through the intro and tap the moment the singer starts the first words.' : 'Tap the moment each line starts.', textAlign: TextAlign.center, style: const TextStyle(color: Colors.white60)),
        const SizedBox(height: 10),
        ValueListenableBuilder<int>(valueListenable: clock, builder: (_, t, __) => Text(fmtMs(t), style: const TextStyle(fontSize: 18, color: Colors.white70))),
        const Spacer(),
        Text(at(syncIndex - 1), style: const TextStyle(color: Colors.white38)),
        const SizedBox(height: 10),
        Text(at(syncIndex), textAlign: TextAlign.center, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900)),
        const SizedBox(height: 10),
        Text(at(syncIndex + 1), style: const TextStyle(color: Colors.white38)),
        const Spacer(),
        GestureDetector(
          key: const Key('tapButton'),
          onTapDown: (_) => tapSync(),
          child: Container(
              height: 190,
              width: double.infinity,
              decoration: BoxDecoration(color: lime, borderRadius: BorderRadius.circular(28)),
              child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                Icon(first ? Icons.mic : Icons.touch_app, color: Colors.black, size: 36),
                Text(first ? 'SINGER STARTS' : 'TAP', style: const TextStyle(color: Colors.black, fontSize: 26, fontWeight: FontWeight.w900, letterSpacing: 2)),
                Text('Line ${syncIndex + 1} of ${ids.length}', style: const TextStyle(color: Colors.black54)),
              ])),
        ),
        const SizedBox(height: 12),
        SizedBox(width: double.infinity, child: OutlinedButton(key: const Key('syncDone'), onPressed: _stopSync, child: const Text('Done'))),
      ]),
    );
  }

  Widget _styleTab() {
    final p = current;
    return ListView(padding: const EdgeInsets.all(18), children: [
      const Text('MAKE IT YOURS', style: TextStyle(color: lime, letterSpacing: 2, fontSize: 11)),
      const SizedBox(height: 8),
      const Text('Choose your atmosphere', style: TextStyle(fontSize: 27, fontWeight: FontWeight.w900)),
      const SizedBox(height: 8),
      const Text('These animated looks and lyric styles are rendered into your final video.', style: TextStyle(color: Colors.white60)),
      if (p != null) ...[
        const SizedBox(height: 14),
        ClipRRect(
            borderRadius: BorderRadius.circular(18),
            child: SizedBox(
                height: 220,
                child: LyricPreview(project: p, theme: _theme(p), tMs: null, sample: p.resolve().cues.firstOrNull?.text ?? p.lines.where((l) => l.hasText).firstOrNull?.text ?? 'Your lyrics appear here'))),
        _heading('A', 'LYRIC ANIMATION'),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final e in lyricEffects.entries)
            ChoiceChip(
                label: Text(e.value),
                selected: p.style.fx == e.key,
                onSelected: (_) {
                  p.style.fx = e.key;
                  commit();
                }),
        ]),
        _heading('B', 'TEXT'),
        DropdownButtonFormField<String>(
            initialValue: p.style.font,
            decoration: const InputDecoration(labelText: 'Font'),
            items: [for (final f in fonts.keys) DropdownMenuItem(value: f, child: Text(f, style: TextStyle(fontFamily: fonts[f]!.$1)))],
            onChanged: (v) {
              p.style.font = v ?? 'Poppins';
              commit();
            }),
        const SizedBox(height: 8),
        Text('Size ${p.style.size.round()}', style: const TextStyle(color: Colors.white60)),
        Slider(value: p.style.size.clamp(40, 140), min: 40, max: 140, activeColor: lime, onChanged: (v) => setState(() => p.style.size = v), onChangeEnd: (_) => commit()),
        Text('Vertical position ${(p.style.posY * 100).round()}%', style: const TextStyle(color: Colors.white60)),
        Slider(value: p.style.posY.clamp(0.1, 0.9), min: 0.1, max: 0.9, activeColor: lime, onChanged: (v) => setState(() => p.style.posY = v), onChangeEnd: (_) => commit()),
        SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('UPPERCASE'),
            value: p.style.upper,
            onChanged: (v) {
              p.style.upper = v;
              commit();
            }),
        const Text('Text colour', style: TextStyle(color: Colors.white60)),
        _swatchRow(p.style.color, (c) => p.style.color = c),
        const SizedBox(height: 8),
        const Text('Highlight colour', style: TextStyle(color: Colors.white60)),
        _swatchRow(p.style.accent, (c) => p.style.accent = c),
        _heading('C', 'BACKGROUND'),
        Row(children: [
          Expanded(child: OutlinedButton.icon(key: const Key('pickBg'), onPressed: _pickBackground, icon: const Icon(Icons.image_outlined), label: Text(p.backgroundImage == null ? 'Use a photo' : 'Change photo'))),
          if (p.backgroundImage != null) ...[
            const SizedBox(width: 8),
            TextButton(
                onPressed: () {
                  p.backgroundImage = null;
                  commit();
                },
                child: const Text('Remove')),
          ],
        ]),
        if (p.backgroundImage != null) ...[
          Text('Darken photo ${(p.backgroundDim * 100).round()}%', style: const TextStyle(color: Colors.white60)),
          Slider(value: p.backgroundDim, min: 0, max: 0.8, activeColor: lime, onChanged: (v) => setState(() => p.backgroundDim = v), onChangeEnd: (_) => commit()),
        ],
        const SizedBox(height: 10),
        const Text('Animated themes', style: TextStyle(color: Colors.white60)),
        const SizedBox(height: 8),
      ],
      ...themes.map((t) => GestureDetector(
          onTap: () async {
            if (current == null) await _new();
            current!.theme = t.id;
            commit();
          },
          child: Container(
              margin: const EdgeInsets.only(bottom: 13),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: panel, borderRadius: BorderRadius.circular(18), border: Border.all(color: current?.theme == t.id ? t.accent : Colors.white12, width: current?.theme == t.id ? 2 : 1)),
              child: Row(children: [
                SizedBox(width: 88, height: 88, child: ThemeMotion(theme: t)),
                const SizedBox(width: 13),
                Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(t.name, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                  Text(t.description, style: const TextStyle(color: Colors.white54, fontSize: 11)),
                  const SizedBox(height: 8),
                  Text(current?.theme == t.id ? 'SELECTED' : 'TAP TO USE', style: TextStyle(color: t.accent, fontSize: 9, letterSpacing: 1.5)),
                ])),
              ])))),
      if (current != null) FilledButton(onPressed: () => setState(() => tab = 1), child: const Text('Back to studio')),
    ]);
  }

  Widget _swatchRow(int value, void Function(int) set) => Wrap(spacing: 8, children: [
        for (final c in swatches)
          GestureDetector(
              onTap: () {
                set(c);
                commit();
              },
              child: Container(
                  width: 34,
                  height: 34,
                  decoration: BoxDecoration(color: Color(c), shape: BoxShape.circle, border: Border.all(color: value == c ? lime : Colors.white24, width: value == c ? 3 : 1)))),
      ]);
}

/// Live preview: draws exactly the cue that the export will show at [tMs] (same resolver), with the chosen
/// font, colours, position and animation. When [tMs] is null a static [sample] is shown (style tab).
class LyricPreview extends StatelessWidget {
  const LyricPreview({super.key, required this.project, required this.theme, required this.tMs, this.sample});
  final Project project;
  final ThemePreset theme;
  final int? tMs;
  final String? sample;

  @override
  Widget build(BuildContext context) {
    final p = project, st = p.style;
    Cue? cue;
    if (tMs != null) cue = activeCue(p.resolve().cues, tMs!);
    final text = tMs == null ? sample : cue?.text;
    final img = p.backgroundImage;
    return LayoutBuilder(builder: (context, box) {
      final scale = box.maxWidth / 1080 * 1.6; // the preview box is wider than a phone frame; keep text readable
      Widget? lyric;
      if (text != null && text.trim().isNotEmpty) {
        final shown = st.upper ? text.toUpperCase() : text;
        final lt = cue == null ? 1000 : tMs! - cue.startMs, left = cue == null ? 1000 : cue.endMs - tMs!;
        double ramp(num v, num d) => (v / d).clamp(0.0, 1.0).toDouble();
        final base = TextStyle(fontFamily: fonts[st.font]!.$1, fontSize: st.size * scale, height: 1.15, fontWeight: FontWeight.w700, color: st.textColor, shadows: const [Shadow(color: Colors.black54, blurRadius: 12)]);
        switch (st.fx) {
          case 'karaoke':
            final words = shown.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
            final total = words.fold<int>(0, (s, w) => s + w.length + 1);
            final prog = cue == null ? 0.5 : ramp(lt, (cue.endMs - cue.startMs) * 0.92);
            var acc = 0;
            lyric = Opacity(
                opacity: ramp(lt, 150) * ramp(left, 150),
                child: Text.rich(TextSpan(children: [
                  for (final w in words)
                    () {
                      acc += w.length + 1;
                      return TextSpan(text: '$w ', style: base.copyWith(color: acc / total <= prog + 1e-9 ? st.accentColor : st.textColor.withValues(alpha: .62)));
                    }(),
                ])),
              );
          case 'pop':
            final k = ramp(lt, 260);
            final s = 0.55 + (k < 0.65 ? k / 0.65 * 0.55 : 1.1 - (k - 0.65) / 0.35 * 0.1);
            lyric = Opacity(opacity: ramp(lt, 80) * ramp(left, 150), child: Transform.scale(scale: s, child: Text(shown, textAlign: TextAlign.center, style: base)));
          case 'boxed':
            final dark = (st.accentColor.r * .299 + st.accentColor.g * .587 + st.accentColor.b * .114) > 0.59;
            lyric = Opacity(
                opacity: ramp(lt, 200) * ramp(left, 150),
                child: Container(
                    padding: EdgeInsets.symmetric(horizontal: 18 * scale, vertical: 8 * scale),
                    decoration: BoxDecoration(color: st.accentColor, borderRadius: BorderRadius.circular(10)),
                    child: Text(shown, textAlign: TextAlign.center, style: base.copyWith(color: dark ? const Color(0xFF0B0C10) : Colors.white, shadows: const []))));
          default:
            lyric = Opacity(opacity: ramp(lt, 250) * ramp(left, 200), child: Text(shown, textAlign: TextAlign.center, style: base));
        }
      }
      return Stack(fit: StackFit.expand, children: [
        if (img != null && File(img).existsSync())
          Stack(fit: StackFit.expand, children: [Image.file(File(img), fit: BoxFit.cover), ColoredBox(color: Colors.black.withValues(alpha: p.backgroundDim))])
        else
          ThemeMotion(theme: theme),
        if (lyric != null) Align(alignment: Alignment(0, st.posY * 2 - 1), child: Padding(padding: const EdgeInsets.symmetric(horizontal: 20), child: lyric)),
        Positioned(left: 12, top: 12, child: Text(tMs == null ? 'STYLE PREVIEW' : 'LIVE PREVIEW', style: const TextStyle(fontSize: 9, letterSpacing: 2))),
        if (tMs != null && cue == null && p.lines.any((l) => l.hasText))
          Positioned(
              left: 12,
              bottom: 10,
              child: Text(p.resolve().cues.isEmpty ? 'Lyrics are hidden until timed' : (tMs! < p.resolve().cues.first.startMs ? 'Intro — lyrics start at ${fmtMs(p.resolve().cues.first.startMs)}' : ''),
                  style: const TextStyle(fontSize: 10, color: Colors.white54))),
      ]);
    });
  }
}

class ThemeMotion extends StatefulWidget {
  const ThemeMotion({super.key, required this.theme});
  final ThemePreset theme;
  @override
  State<ThemeMotion> createState() => _ThemeMotionState();
}

class _ThemeMotionState extends State<ThemeMotion> with SingleTickerProviderStateMixin {
  late final controller = AnimationController(vsync: this, duration: const Duration(seconds: 12))..repeat();
  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(animation: controller, builder: (context, _) => CustomPaint(painter: _ThemePainter(widget.theme, controller.value)));
}

class _ThemePainter extends CustomPainter {
  _ThemePainter(this.theme, this.t);
  final ThemePreset theme;
  final double t;
  @override
  void paint(Canvas canvas, Size size) {
    final r = Offset.zero & size;
    canvas.drawRect(r, Paint()..shader = LinearGradient(colors: theme.colors, begin: Alignment(-1 + t * 2, -1), end: Alignment(1 - t * 2, 1)).createShader(r));
    final p = Paint()
      ..color = theme.accent.withValues(alpha: .16)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 22);
    for (var i = 0; i < 5; i++) {
      final x = size.width * ((i * .23 + t * (i.isEven ? 1 : -1)) % 1);
      final y = size.height * (.15 + i * .17) + 18 * (t - .5);
      canvas.drawCircle(Offset(x, y), 23 + i % 3 * 10, p);
    }
  }

  @override
  bool shouldRepaint(covariant _ThemePainter old) => old.t != t || old.theme.id != theme.id;
}
