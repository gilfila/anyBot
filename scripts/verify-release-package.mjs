import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { releaseFiles, verifyUpdateMetadata } from './release-policy.mjs';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const version = JSON.parse(readFileSync('package.json')).version;
const archive = 'release/win-unpacked/resources/app.asar';
const packaged = JSON.parse(asar.extractFile(archive, 'package.json'));
if (packaged.version !== version) throw Error('Packaged version mismatch');
for (const dependency of ['electron-updater', 'builder-util-runtime']) {
  asar.extractFile(archive, path.join('node_modules', dependency, 'package.json'));
}
for (const name of readdirSync('dist/assets')) {
  if (!readFileSync(`dist/assets/${name}`).equals(asar.extractFile(archive, path.join('dist', 'assets', name)))) throw Error(`Packaged asset mismatch: ${name}`);
}
if (!readFileSync('dist/index.html').equals(asar.extractFile(archive, path.join('dist', 'index.html')))) throw Error('Packaged HTML mismatch');
verifyUpdateMetadata(version, readFileSync('release/latest.yml', 'utf8'), readFileSync(`release/${releaseFiles(version)[0]}`));
const files = Object.fromEntries(releaseFiles(version).map(name => [name, createHash('sha256').update(readFileSync(`release/${name}`)).digest('hex')]));
writeFileSync('release/private-release-audit.json', JSON.stringify({ version, sourceCommit: process.env.GITHUB_SHA, files }, null, 2));
console.log(`Verified packaged dependencies, UI assets, version, and updater checksum for ${version}`);
