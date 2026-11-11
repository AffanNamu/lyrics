import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';
import 'package:ffmpeg_kit_flutter_new/ffmpeg_kit.dart';
import 'package:ffmpeg_kit_flutter_new/return_code.dart';

const lime = Color(0xFFC8F36B);
const panel = Color(0xFF141B27);

void main() => runApp(const LyricsApp());

class LyricsApp extends StatelessWidget {
  const LyricsApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'LYRICS Studio', debugShowCheckedModeBanner: false,
    theme: ThemeData(
      brightness: Brightness.dark, scaffoldBackgroundColor: const Color(0xFF090C13),
      colorScheme: ColorScheme.fromSeed(seedColor: lime, brightness: Brightness.dark),
      useMaterial3: true,
      inputDecorationTheme: InputDecorationTheme(
        filled: true, fillColor: panel,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: Colors.white12)),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: Colors.white12)),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: lime)),
      ),
    ),
    home: const StudioHome(),
  );
}

class LyricLine {
  LyricLine(this.text, [this.startMs = 0]);
  String text;
  int startMs;
  Map<String,dynamic> toJson() => {'text':text,'startMs':startMs};
  factory LyricLine.fromJson(Map<String,dynamic> j) => LyricLine(j['text'] ?? '', (j['startMs'] as num?)?.toInt() ?? 0);
}

class Project {
  Project(this.id, this.title, {this.audioPath, this.durationMs = 0, this.theme = 'aurora', List<LyricLine>? lines}) : lines = lines ?? [];
  String id, title, theme;
  String? audioPath;
  int durationMs;
  List<LyricLine> lines;
  Map<String,dynamic> toJson() => {'id':id,'title':title,'audioPath':audioPath,'durationMs':durationMs,'theme':theme,'lines':lines.map((e)=>e.toJson()).toList()};
  factory Project.fromJson(Map<String,dynamic> j) => Project(j['id'],j['title'] ?? 'Untitled',audioPath:j['audioPath'],durationMs:j['durationMs'] ?? 0,theme:j['theme'] ?? 'aurora',lines:(j['lines'] as List? ?? []).map((e)=>LyricLine.fromJson(Map<String,dynamic>.from(e))).toList());
}

class ThemePreset {
  const ThemePreset(this.id,this.name,this.description,this.colors,this.accent,this.motion);
  final String id,name,description,motion;
  final List<Color> colors;
  final Color accent;
}
const themes = [
  ThemePreset('aurora','Aurora Flow','Moving northern lights',[Color(0xFF071B35),Color(0xFF51316F),Color(0xFF08111E)],lime,'aurora'),
  ThemePreset('ember','Golden Ember','Warm cinematic glow',[Color(0xFF32120F),Color(0xFF91451F),Color(0xFF120B18)],Color(0xFFFFC36A),'ember'),
  ThemePreset('ocean','Deep Ocean','Blue flowing light',[Color(0xFF031B2B),Color(0xFF07506A),Color(0xFF07121E)],Color(0xFF70E4E8),'ocean'),
  ThemePreset('velvet','Velvet Night','Elegant purple atmosphere',[Color(0xFF160D2B),Color(0xFF512C69),Color(0xFF0A0A18)],Color(0xFFE6B7FF),'velvet'),
  ThemePreset('minimal','Minimal Light','Clean editorial look',[Color(0xFF101820),Color(0xFF263746),Color(0xFF101820)],Colors.white,'minimal'),
];

class StudioHome extends StatefulWidget {
  const StudioHome({super.key});
  @override State<StudioHome> createState()=>_StudioHomeState();
}
class _StudioHomeState extends State<StudioHome> {
  final player=AudioPlayer(), title=TextEditingController(), lyrics=TextEditingController();
  final uuid=const Uuid();
  List<Project> projects=[];
  Project? current;
  int tab=0, selectedLine=0;
  bool loading=true, rendering=false;
  String renderStatus='';
  Timer? saveTimer;

  @override void initState(){super.initState();_load();}
  Future<void> _load() async {
    final p=await SharedPreferences.getInstance();
    try { projects=((jsonDecode(p.getString('lyrics_projects') ?? '[]') as List).map((e)=>Project.fromJson(Map<String,dynamic>.from(e))).toList()); } catch (_) {}
    if(mounted)setState(()=>loading=false);
  }
  Future<void> _save() async {
    if(current==null)return;
    current!.title=title.text.trim().isEmpty?'Untitled project':title.text.trim();
    final old=current!.lines;
    final texts=lyrics.text.split('\n');
    current!.lines=List.generate(texts.length,(i)=>LyricLine(texts[i],i<old.length?old[i].startMs:0));
    if(!projects.any((e)=>e.id==current!.id))projects.insert(0,current!);
    final p=await SharedPreferences.getInstance();
    await p.setString('lyrics_projects',jsonEncode(projects.map((e)=>e.toJson()).toList()));
  }
  void _queueSave(){saveTimer?.cancel();saveTimer=Timer(const Duration(milliseconds:450),_save);}
  void _open(Project p){
    setState((){current=p;title.text=p.title;lyrics.text=p.lines.map((e)=>e.text).join('\n');selectedLine=0;tab=1;});
    if(p.audioPath!=null && File(p.audioPath!).existsSync())player.setFilePath(p.audioPath!);
  }
  Future<void> _new() async {final p=Project(uuid.v4(),'Untitled project');projects.insert(0,p);_open(p);await _save();}
  Future<void> _import() async {
    final f=await FilePicker.platform.pickFiles(type:FileType.audio);
    if(f==null || f.files.single.path==null || current==null)return;
    final docs=await getApplicationDocumentsDirectory();
    final dir=Directory('${docs.path}/audio');await dir.create(recursive:true);
    final ext=f.files.single.extension ?? 'audio';
    final copied=await File(f.files.single.path!).copy('${dir.path}/${current!.id}.$ext');
    await player.setFilePath(copied.path);
    setState((){current!.audioPath=copied.path;current!.durationMs=(player.duration ?? Duration.zero).inMilliseconds;});
    await _save();
  }
  void _sync(){
    if(current==null)return;
    final lines=lyrics.text.split('\n');
    final pos=player.position.inMilliseconds;
    final old=current!.lines;
    current!.lines=List.generate(lines.length,(i)=>LyricLine(lines[i],i==selectedLine?pos:(i<old.length?old[i].startMs:0)));
    _save();setState((){});
  }
  ThemePreset get activeTheme=>themes.firstWhere((e)=>e.id==current?.theme,orElse:()=>themes.first);
  Future<void> _render() async {
    await _save();
    final p=current;
    if(p==null)return;
    if(p.audioPath==null || !File(p.audioPath!).existsSync()){_toast('Import a song first.');return;}
    if(p.lines.every((e)=>e.text.trim().isEmpty)){_toast('Write your lyrics first.');return;}
    setState(()=>rendering=true);
    try{
      final docs=await getApplicationDocumentsDirectory();
      final outDir=Directory('${docs.path}/exports');await outDir.create(recursive:true);
      final tmp=Directory('${docs.path}/render');await tmp.create(recursive:true);
      final ass=File('${tmp.path}/lyrics.ass');
      final theme=activeTheme;
      final col=theme.accent;
      final rgb='${col.blue.toRadixString(16).padLeft(2,'0')}${col.green.toRadixString(16).padLeft(2,'0')}${col.red.toRadixString(16).padLeft(2,'0')}'.toUpperCase();
      final b=StringBuffer('[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 2\n');
      b.write('[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n');
      b.write('Style: Lyric,Arial,72,&H00$rgb,&H000000FF,&HAA000000,&H66000000,1,0,0,0,100,100,1,0,1,3,1,2,90,90,250,1\n');
      b.write('[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n');
      String stamp(int ms){final cs=ms~/10;return '${cs~/360000}:${((cs~/6000)%60).toString().padLeft(2,'0')}:${((cs~/100)%60).toString().padLeft(2,'0')}.${(cs%100).toString().padLeft(2,'0')}';}
      for(var i=0;i<p.lines.length;i++){
        final line=p.lines[i];if(line.text.trim().isEmpty)continue;
        final start=line.startMs.clamp(0,p.durationMs);
        var end=i+1<p.lines.length?p.lines[i+1].startMs:p.durationMs;
        if(end<=start)end=(start+3500).clamp(start+800,p.durationMs);
        if(end<=start)continue;
        final text=line.text.replaceAll('{',r'\{').replaceAll('}',r'\}').replaceAll('\n',r'\N');
        b.write('Dialogue: 0,${stamp(start)},${stamp(end)},Lyric,,0,0,0,,$text\n');
      }
      await ass.writeAsString(b.toString());
      final output='${outDir.path}/${p.id}_${DateTime.now().millisecondsSinceEpoch}.mp4';
      String esc(String s)=>s.replaceAll('\\','/').replaceAll(':',r'\:').replaceAll("'",r"\\'");
      final duration=(p.durationMs/1000).clamp(5,3600).toStringAsFixed(2);
      final base='color=c=0x${theme.colors[0].red.toRadixString(16).padLeft(2,'0')}${theme.colors[0].green.toRadixString(16).padLeft(2,'0')}${theme.colors[0].blue.toRadixString(16).padLeft(2,'0')}:s=1080x1920:r=30:d=$duration';
      final filter="$base,drawbox=x='mod(t*90,1080)-180':y='mod(t*32,1920)-160':w=430:h=430:color=0x${theme.colors[1].red.toRadixString(16).padLeft(2,'0')}${theme.colors[1].green.toRadixString(16).padLeft(2,'0')}${theme.colors[1].blue.toRadixString(16).padLeft(2,'0')}@0.35:t=fill,ass='${esc(ass.path)}',format=yuv420p";
      final cmd="-y -f lavfi -i \"$filter\" -i '${esc(p.audioPath!)}' -map 0:v -map 1:a -t $duration -r 30 -c:v libx264 -preset ultrafast -crf 23 -c:a aac -shortest -movflags +faststart '${esc(output)}'";
      if(mounted)setState(()=>renderStatus='Rendering locally. This may take several minutes…');
      final session=await FFmpegKit.execute(cmd);
      final code=await session.getReturnCode();
      if(ReturnCode.isSuccess(code)){
        if(mounted)setState(()=>renderStatus='Saved to app exports: $output');
        _toast('Your MP4 video has been created.');
      }else{
        final logs=await session.getOutput();
        throw Exception(logs ?? 'Video encoder failed. Check FFmpeg logs.');
      }
    }catch(e){if(mounted)setState(()=>renderStatus='Export failed: $e');_toast('Could not export video: $e');}
    finally{if(mounted)setState(()=>rendering=false);}
  }
  Future<void> _render() async {
    await _save();
    final p = current;
    if (p == null) return;
    if (p.audioPath == null || !File(p.audioPath!).existsSync()) { _toast('Import a song before exporting.'); return; }
    final nonEmpty = p.lines.where((e) => e.text.trim().isNotEmpty).toList();
    if (nonEmpty.isEmpty) { _toast('Write at least one lyric line.'); return; }
    setState(() { rendering = true; renderStatus = 'Preparing your video…'; });
    try {
      final docs = await getApplicationDocumentsDirectory();
      final exportDir = Directory('${docs.path}/exports');
      final tempDir = Directory('${docs.path}/render');
      await exportDir.create(recursive: true);
      await tempDir.create(recursive: true);
      final durationMs = (player.duration ?? Duration(milliseconds: p.durationMs)).inMilliseconds;
      if (durationMs <= 0) throw Exception('The song duration could not be read.');
      p.durationMs = durationMs;
      final preset = activeTheme;
      final accent = preset.accent;
      final rgb = '${accent.blue.toRadixString(16).padLeft(2, '0')}${accent.green.toRadixString(16).padLeft(2, '0')}${accent.red.toRadixString(16).padLeft(2, '0')}'.toUpperCase();
      String stamp(int ms) {
        final cs = ms ~/ 10;
        return '${cs ~/ 360000}:${((cs ~/ 6000) % 60).toString().padLeft(2, '0')}:${((cs ~/ 100) % 60).toString().padLeft(2, '0')}.${(cs % 100).toString().padLeft(2, '0')}';
      }
      final allSynced = nonEmpty.any((e) => e.startMs > 0);
      final ass = StringBuffer()
        ..writeln('[Script Info]')
        ..writeln('ScriptType: v4.00+')
        ..writeln('PlayResX: 1080')
        ..writeln('PlayResY: 1920')
        ..writeln('WrapStyle: 2')
        ..writeln('[V4+ Styles]')
        ..writeln('Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding')
        ..writeln('Style: Lyric,Arial,72,&H00$rgb,&H000000FF,&HAA000000,&H66000000,1,0,0,0,100,100,1,0,1,3,1,2,90,90,250,1')
        ..writeln('[Events]')
        ..writeln('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');
      for (var i = 0; i < nonEmpty.length; i++) {
        final line = nonEmpty[i];
        final int start = allSynced ? line.startMs.clamp(0, durationMs).toInt() : (i * durationMs / nonEmpty.length).round();
        final nextStart = i + 1 < nonEmpty.length
            ? (allSynced ? nonEmpty[i + 1].startMs : ((i + 1) * durationMs / nonEmpty.length).round())
            : durationMs;
        final int end = nextStart > start ? nextStart : (start + 3200).clamp(start + 500, durationMs).toInt();
        if (end <= start) continue;
        final caption = line.text.replaceAll('{', r'\{').replaceAll('}', r'\}').replaceAll('\n', r'\N');
        ass.writeln('Dialogue: 0,${stamp(start)},${stamp(end)},Lyric,,0,0,0,,$caption');
      }
      final assFile = File('${tempDir.path}/captions.ass');
      await assFile.writeAsString(ass.toString());
      final bg = preset.colors.first;
      final accentBg = preset.colors[1];
      final bgHex = '0x${bg.red.toRadixString(16).padLeft(2, '0')}${bg.green.toRadixString(16).padLeft(2, '0')}${bg.blue.toRadixString(16).padLeft(2, '0')}';
      final accentHex = '0x${accentBg.red.toRadixString(16).padLeft(2, '0')}${accentBg.green.toRadixString(16).padLeft(2, '0')}${accentBg.blue.toRadixString(16).padLeft(2, '0')}';
      String esc(String value) => value.replaceAll('\\', '/').replaceAll(':', r'\:').replaceAll("'", r"\'");
      final seconds = (durationMs / 1000).toStringAsFixed(2);
      final output = '${exportDir.path}/${p.id}_${DateTime.now().millisecondsSinceEpoch}.mp4';
      final videoFilter = "color=c=$bgHex:s=1080x1920:r=30:d=$seconds,"
          "drawbox=x='mod(t*78,1080)-220':y='mod(t*34,1920)-180':w=520:h=520:color=$accentHex@0.34:t=fill,"
          "drawbox=x='mod(t*39+500,1080)-160':y='mod(t*23+800,1920)-160':w=320:h=320:color=$bgHex@0.42:t=fill,"
          "ass='${esc(assFile.path)}',format=yuv420p";
      final command = "-y -f lavfi -i \\"$videoFilter\\" -i '${esc(p.audioPath!)}' "
          "-map 0:v:0 -map 1:a:0 -t $seconds -r 30 -c:v libx264 -preset ultrafast -crf 23 "
          "-c:a aac -b:a 192k -shortest -movflags +faststart '${esc(output)}'";
      if (mounted) setState(() => renderStatus = 'Rendering 1080 × 1920 MP4 on this phone…');
      final session = await FFmpegKit.execute(command);
      final code = await session.getReturnCode();
      if (!ReturnCode.isSuccess(code) || !File(output).existsSync()) throw Exception(await session.getOutput() ?? 'FFmpeg video encoding failed.');
      if (mounted) setState(() => renderStatus = 'Video ready: $output');
      _toast('Your lyric video has been rendered.');
    } catch (error) {
      if (mounted) setState(() => renderStatus = 'Export failed: $error');
      _toast('Video export failed: $error');
    } finally {
      if (mounted) setState(() => rendering = false);
    }
  }

  void _toast(String s)=>ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(s),behavior:SnackBarBehavior.floating));
  @override void dispose(){saveTimer?.cancel();player.dispose();title.dispose();lyrics.dispose();super.dispose();}

  @override Widget build(BuildContext context)=>Scaffold(
    appBar:AppBar(title:const Row(children:[Icon(Icons.graphic_eq,color:lime),SizedBox(width:9),Text('LYRICS',style:TextStyle(fontWeight:FontWeight.w900,letterSpacing:2))]),actions:[if(current!=null)IconButton(onPressed:_save,icon:const Icon(Icons.save_outlined))]),
    body:loading?const Center(child:CircularProgressIndicator(color:lime)):SafeArea(child:tab==0?_library():tab==1?_editor():_themes()),
    bottomNavigationBar:NavigationBar(selectedIndex:tab,onDestinationSelected:(v)=>setState(()=>tab=v),destinations:const[
      NavigationDestination(icon:Icon(Icons.library_music_outlined),label:'Projects'),
      NavigationDestination(icon:Icon(Icons.edit_note),label:'Studio'),
      NavigationDestination(icon:Icon(Icons.auto_awesome),label:'Themes'),
    ]),
  );
  Widget _library()=>ListView(padding:const EdgeInsets.all(18),children:[
    const Text('YOUR CREATIVE SPACE',style:TextStyle(color:lime,letterSpacing:2,fontSize:11,fontWeight:FontWeight.bold)),
    const SizedBox(height:10),const Text('Make lyrics\ncome alive.',style:TextStyle(fontSize:38,height:1.05,fontWeight:FontWeight.w900,letterSpacing:-1.5)),
    const SizedBox(height:12),const Text('Turn your words and music into beautiful animated videos — right on your phone.',style:TextStyle(color:Colors.white60,height:1.5)),
    const SizedBox(height:22),FilledButton.icon(onPressed:_new,icon:const Icon(Icons.add),label:const Text('Create a video project'),style:FilledButton.styleFrom(backgroundColor:lime,foregroundColor:Colors.black,minimumSize:const Size.fromHeight(54))),
    const SizedBox(height:25),const Text('YOUR PROJECTS',style:TextStyle(letterSpacing:2,fontSize:11,color:Colors.white60)),
    const SizedBox(height:12),
    if(projects.isEmpty)const Card(color:panel,child:Padding(padding:EdgeInsets.all(25),child:Column(children:[Icon(Icons.movie_creation_outlined,color:lime,size:42),SizedBox(height:10),Text('Your first video starts here',style:TextStyle(fontWeight:FontWeight.bold)),Text('Create a project, import a song and write your lyrics.',textAlign:TextAlign.center,style:TextStyle(color:Colors.white54))])))
    else ...projects.map((p)=>Card(color:panel,child:ListTile(leading:const Icon(Icons.video_library,color:lime),title:Text(p.title),subtitle:Text('${p.lines.length} lines • ${p.audioPath==null?'No song':'Song imported'}'),trailing:const Icon(Icons.chevron_right),onTap:()=>_open(p)))),
  ]);
  Widget _editor(){
    if(current==null)return Center(child:FilledButton.icon(onPressed:_new,icon:const Icon(Icons.add),label:const Text('Create project')));
    final lines=lyrics.text.split('\n');
    return ListView(padding:const EdgeInsets.fromLTRB(16,8,16,24),children:[
      Row(children:[IconButton(onPressed:()=>setState(()=>tab=0),icon:const Icon(Icons.arrow_back)),const Text('VIDEO WORKSPACE',style:TextStyle(color:lime,letterSpacing:2,fontSize:10)),const Spacer(),TextButton(onPressed:_save,child:const Text('Save'))]),
      TextField(controller:title,decoration:const InputDecoration(labelText:'Project title',prefixIcon:Icon(Icons.title)),onChanged:(_)=>_queueSave()),
      const SizedBox(height:16),_heading('01','YOUR MUSIC'),
      Card(color:panel,child:Padding(padding:const EdgeInsets.all(12),child:Column(children:[
        Row(children:[const Icon(Icons.music_note,color:lime),const SizedBox(width:8),Expanded(child:Text(current!.audioPath?.split('/').last??'No song selected',maxLines:1,overflow:TextOverflow.ellipsis)),IconButton(onPressed:_import,icon:const Icon(Icons.folder_open,color:lime))]),
        if(current!.audioPath!=null)StreamBuilder<Duration>(stream:player.positionStream,builder:(context,snap){
          final pos=snap.data??Duration.zero,total=player.duration??Duration.zero;
          return Column(children:[Slider(value:total.inMilliseconds==0?0:pos.inMilliseconds.clamp(0,total.inMilliseconds).toDouble(),max:total.inMilliseconds==0?1:total.inMilliseconds.toDouble(),activeColor:lime,onChanged:(v)=>player.seek(Duration(milliseconds:v.round()))),Row(children:[Text(_fmt(pos),style:const TextStyle(color:Colors.white54,fontSize:11)),const Spacer(),Text(_fmt(total),style:const TextStyle(color:Colors.white54,fontSize:11))])]);
        }),
        if(current!.audioPath!=null)Row(mainAxisAlignment:MainAxisAlignment.center,children:[
          IconButton(onPressed:()=>player.seek(player.position-const Duration(seconds:5)),icon:const Icon(Icons.replay_5)),
          StreamBuilder<PlayerState>(stream:player.playerStateStream,builder:(context,s)=>IconButton.filled(onPressed:()=>s.data?.playing==true?player.pause():player.play(),icon:Icon(s.data?.playing==true?Icons.pause:Icons.play_arrow),style:IconButton.styleFrom(backgroundColor:lime,foregroundColor:Colors.black))),
          IconButton(onPressed:()=>player.seek(player.position+const Duration(seconds:5)),icon:const Icon(Icons.forward_5)),
        ]),
      ]))),
      const SizedBox(height:16),_heading('02','WRITE YOUR LYRICS'),
      const Text('Write one lyric per line. Select a line, play the song, then tap Sync selected line.',style:TextStyle(color:Colors.white60,fontSize:12,height:1.5)),
      const SizedBox(height:10),
      TextField(controller:lyrics,minLines:8,maxLines:14,style:const TextStyle(fontSize:15,height:1.8),decoration:const InputDecoration(hintText:'Write your first line here…\n\nEach new line becomes a lyric caption.',contentPadding:EdgeInsets.all(16)),onChanged:(_){_queueSave();setState((){});}),
      const SizedBox(height:8),
      ...List.generate(lines.length,(i)=>ListTile(dense:true,selected:selectedLine==i,selectedTileColor:lime.withValues(alpha:.09),leading:Text('${i+1}'.padLeft(2,'0'),style:const TextStyle(color:lime)),title:Text(lines[i].isEmpty?'Empty lyric line':lines[i],maxLines:1,overflow:TextOverflow.ellipsis),subtitle:Text(i<current!.lines.length?_fmt(Duration(milliseconds:current!.lines[i].startMs)):'Not synced',style:const TextStyle(fontSize:10,color:Colors.white54)),onTap:()=>setState(()=>selectedLine=i))),
      Align(alignment:Alignment.centerRight,child:FilledButton.tonalIcon(onPressed:_sync,icon:const Icon(Icons.sync),label:const Text('Sync selected line'))),
      const SizedBox(height:16),_heading('03','VIDEO PREVIEW'),
      _preview(activeTheme),
      const SizedBox(height:18),
      FilledButton.icon(onPressed:rendering?null:_render,icon:rendering?const SizedBox(width:18,height:18,child:CircularProgressIndicator(strokeWidth:2,color:Colors.black)):const Icon(Icons.movie_creation),label:Text(rendering?'Rendering MP4…':'Render and export MP4'),style:FilledButton.styleFrom(backgroundColor:lime,foregroundColor:Colors.black,minimumSize:const Size.fromHeight(56),textStyle:const TextStyle(fontWeight:FontWeight.w900))),
      if(renderStatus.isNotEmpty)Padding(padding:const EdgeInsets.only(top:10),child:Text(renderStatus,style:const TextStyle(color:Colors.white60,fontSize:11))),
    ]);
  }
  Widget _themes()=>ListView(padding:const EdgeInsets.all(18),children:[
    const Text('MAKE IT YOURS',style:TextStyle(color:lime,letterSpacing:2,fontSize:11)),
    const SizedBox(height:8),const Text('Choose your atmosphere',style:TextStyle(fontSize:27,fontWeight:FontWeight.w900)),
    const SizedBox(height:8),const Text('These animated looks are rendered into your final video.',style:TextStyle(color:Colors.white60)),
    const SizedBox(height:18),
    ...themes.map((t)=>GestureDetector(onTap:(){if(current==null){_new().then((_){setState(()=>current!.theme=t.id);_save();});}else{setState(()=>current!.theme=t.id);_save();}},child:Container(margin:const EdgeInsets.only(bottom:13),padding:const EdgeInsets.all(12),decoration:BoxDecoration(color:panel,borderRadius:BorderRadius.circular(18),border:Border.all(color:current?.theme==t.id? t.accent:Colors.white12,width:current?.theme==t.id?2:1)),child:Row(children:[SizedBox(width:88,height:88,child:_ThemeMotion(theme:t)),const SizedBox(width:13),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text(t.name,style:const TextStyle(fontWeight:FontWeight.bold,fontSize:15)),Text(t.description,style:const TextStyle(color:Colors.white54,fontSize:11)),const SizedBox(height:8),Text(current?.theme==t.id?'SELECTED':'TAP TO USE',style:TextStyle(color:t.accent,fontSize:9,letterSpacing:1.5))]))])))),
    if(current!=null)FilledButton(onPressed:()=>setState(()=>tab=1),child:const Text('Back to studio')),
  ]);
  Widget _heading(String n,String s)=>Padding(padding:const EdgeInsets.only(bottom:9),child:Row(children:[Text(n,style:const TextStyle(color:lime,fontSize:10)),const SizedBox(width:10),Text(s,style:const TextStyle(fontSize:12,fontWeight:FontWeight.bold,letterSpacing:1.2))]));
  Widget _preview(ThemePreset t)=>ClipRRect(borderRadius:BorderRadius.circular(20),child:SizedBox(height:300,child:Stack(fit:StackFit.expand,children:[_ThemeMotion(theme:t),Center(child:Padding(padding:const EdgeInsets.all(24),child:Text(lyrics.text.split('\n').firstWhere((e)=>e.trim().isNotEmpty,orElse:()=>'Your lyrics appear here'),textAlign:TextAlign.center,style:TextStyle(fontSize:26,fontWeight:FontWeight.w900,color:t.accent,shadows:const[Shadow(color:Colors.black,blurRadius:14)])))),const Positioned(left:12,top:12,child:Text('LIVE PREVIEW',style:TextStyle(fontSize:9,letterSpacing:2)))])));
  String _fmt(Duration d)=>'${d.inMinutes.remainder(60).toString().padLeft(2,'0')}:${d.inSeconds.remainder(60).toString().padLeft(2,'0')}';
}

class _ThemeMotion extends StatefulWidget {
  const _ThemeMotion({required this.theme});
  final ThemePreset theme;
  @override State<_ThemeMotion> createState()=>_ThemeMotionState();
}
class _ThemeMotionState extends State<_ThemeMotion> with SingleTickerProviderStateMixin {
  late final controller=AnimationController(vsync:this,duration:const Duration(seconds:12))..repeat();
  @override void dispose(){controller.dispose();super.dispose();}
  @override Widget build(BuildContext context)=>AnimatedBuilder(animation:controller,builder:(context,_)=>CustomPaint(painter:_ThemePainter(widget.theme,controller.value)));
}
class _ThemePainter extends CustomPainter {
  _ThemePainter(this.theme,this.t);
  final ThemePreset theme;final double t;
  @override void paint(Canvas canvas,Size size){
    final r=Offset.zero&size;
    canvas.drawRect(r,Paint()..shader=LinearGradient(colors:theme.colors,begin:Alignment(-1+t*2,-1),end:Alignment(1-t*2,1)).createShader(r));
    final p=Paint()..color=theme.accent.withValues(alpha:.16)..maskFilter=const MaskFilter.blur(BlurStyle.normal,22);
    for(var i=0;i<5;i++){final x=size.width*((i*.23+t*(i.isEven?1:-1))%1);final y=size.height*(.15+i*.17)+18*(t-.5);canvas.drawCircle(Offset(x,y),23+i%3*10,p);}
  }
  @override bool shouldRepaint(covariant _ThemePainter old)=>old.t!=t||old.theme.id!=theme.id;
}
