import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { NtExecutable, NtExecutableResource, Resource } from 'resedit';
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const pkg = JSON.parse(readFileSync('package.json'));

function verifyIcons(filename) {
  const resources = NtExecutableResource.from(NtExecutable.from(readFileSync(filename)));
  const groups = Resource.IconGroupEntry.fromEntries(resources.entries);
  if (!groups.length) throw Error(`Missing Windows icon: ${filename}`);
  for (const size of [16,24,32,48,64,128,256]) {
    const expected = readFileSync(`assets/brand/scout-${size}.png`);
    const match = groups.some(group => group.icons.some(icon => {
      const entry = resources.entries.find(e => e.type === 3 && e.id === icon.iconID && e.lang === group.lang);
      return (icon.width || 256) === size && entry && expected.equals(Buffer.from(entry.bin));
    }));
    if (!match) throw Error(`Incorrect ${size}px Scout icon in ${filename}`);
  }
  return resources;
}
const resources = verifyIcons('release/win-unpacked/anyBot.exe');
const versions = Resource.VersionInfo.fromEntries(resources.entries);
if (!versions.some(v => v.getAllLanguagesForStringValues().some(lang => v.getStringValues(lang).ProductName === 'Any Bot'))) throw Error('Windows product name is not Any Bot');
verifyIcons(`release/anyBot-Setup-${pkg.version}.exe`);
const archive = 'release/win-unpacked/resources/app.asar';
for (const name of ['scout-16.png','scout-32.png','scout-256.png']) {
  if (!readFileSync(`assets/brand/${name}`).equals(asar.extractFile(archive,path.join('assets','brand',name)))) throw Error(`Missing or stale packaged ${name}`);
}
for (const name of ['brand.cjs','main.cjs']) {
  if (!readFileSync(`desktop/${name}`).equals(asar.extractFile(archive,path.join('desktop',name)))) throw Error(`Packaged ${name} differs`);
}
for (const name of ['electron-updater','builder-util-runtime']) asar.extractFile(archive,path.join('node_modules',name,'package.json'));
console.log('PASS: app and installer embed the approved Scout at every Windows icon size; product name, tray/window assets, and updater dependencies verified.');
