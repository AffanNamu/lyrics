import 'package:flutter_test/flutter_test.dart';
import 'package:lyrics_studio/main.dart';
void main(){
  testWidgets('native studio opens', (tester) async {
    await tester.pumpWidget(const LyricsApp());
    await tester.pumpAndSettle();
    expect(find.text('LYRICS'),findsOneWidget);
    expect(find.text('Make lyrics\ncome alive.'),findsOneWidget);
  });
}
