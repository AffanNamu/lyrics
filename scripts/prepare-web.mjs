import { cp, mkdir, rm } from 'node:fs/promises';

const files = ['index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'sw.js'];
await rm('www', { recursive: true, force: true });
await mkdir('www/assets', { recursive: true });
for (const file of files) await cp(file, `www/${file}`);
await cp('assets', 'www/assets', { recursive: true });
console.log('Prepared fully local web assets for the Android application.');
