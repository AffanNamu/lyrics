// Offline-integrity check: every file the service worker caches must exist, every app module must parse,
// and the app's own source must not reference any remote URL.
import { readFile, readdir, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

let failed = false;
const fail = m => { console.error('FAIL ' + m); failed = true; };
const sw = await readFile('sw.js', 'utf8');
const shell = [...sw.matchAll(/'\.\/([^']+)'/g)].map(m => m[1]);
for (const f of shell) await access(f).catch(() => fail('service worker lists a missing file: ' + f));
const mods = (await readdir('js')).filter(f => f.endsWith('.js'));
for (const f of mods) {
  if (!shell.includes('js/' + f)) fail('js/' + f + ' is not cached by the service worker');
  try { execFileSync(process.execPath, ['--experimental-default-type=module', '--check', 'js/' + f], { stdio: 'pipe' }); }
  catch (e) { fail('syntax error in js/' + f + '\n' + e.stderr); }
}
for (const f of ['index.html', 'styles.css', 'sw.js', ...mods.map(m => 'js/' + m)]) {
  const text = (await readFile(f, 'utf8')).replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '');
  if (/https?:\/\//.test(text)) fail(f + ' references a remote URL — the app must be fully offline');
}
for (const m of (await readFile('styles.css', 'utf8')).matchAll(/url\((fonts\/[^)]+)\)/g)) await access(m[1]).catch(() => fail('missing font ' + m[1]));
await access('models/vocal-yamnet-int8.bin').catch(() => fail('missing models/vocal-yamnet-int8.bin'));
if (!shell.includes('models/vocal-yamnet-int8.bin')) fail('the vocal model is not cached for offline use');
if (failed) process.exit(1);
console.log(`OK: ${shell.length} cached files present, ${mods.length} modules parse, no remote URLs.`);
