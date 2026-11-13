// Copies the self-contained web app into www/ for the Capacitor Android build. No bundler, no network assets.
import { cp, mkdir, rm } from 'node:fs/promises';

const files = ['index.html', 'styles.css', 'manifest.webmanifest', 'sw.js'];
const dirs = ['js', 'vendor', 'fonts', 'assets', 'models'];
await rm('www', { recursive: true, force: true });
await mkdir('www', { recursive: true });
for (const f of files) await cp(f, `www/${f}`);
for (const d of dirs) await cp(d, `www/${d}`, { recursive: true });
console.log('Prepared fully local web assets for the Android application.');
