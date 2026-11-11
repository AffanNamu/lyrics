import 'package:flutter_test/flutter_test.dart';
import 'package:lyrics_studio/main.dart';
void main(){
  testWidgets('native studio opens', (tester) async {
    await tester.pumpWidget(const LyricsApp());
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('LYRICS'),findsOneWidget);
    expect(find.text('Make lyrics\ncome alive.'),findsOneWidget);
  });
}
