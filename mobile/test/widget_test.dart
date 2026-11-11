import 'package:flutter_test/flutter_test.dart';
import 'package:lyrics_studio/main.dart';

void main() {
  testWidgets('native studio opens', (tester) async {
    await tester.pumpWidget(const LyricsApp());
    // The app has an intentionally repeating animated background, so advance
    // one frame instead of waiting for all animations to settle.
    await tester.pump(const Duration(milliseconds: 100));

    // Assert stable navigation and app branding, not copy that may be split
    // into separate Text spans or changed during visual design work.
    expect(find.text('LYRICS'), findsOneWidget);
    expect(find.text('Projects'), findsOneWidget);
    expect(find.text('Studio'), findsOneWidget);
    expect(find.text('Themes'), findsOneWidget);
  });
}
