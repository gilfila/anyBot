import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compareVersions, releaseFiles, verifyUpdateMetadata, verifyPublicAssets, downloadReadme } from '../scripts/release-policy.mjs';

const installer = Buffer.from('test installer');
const hash = createHash('sha512').update(installer).digest('base64');
const metadata = `version: 0.3.6\nfiles:\n  - url: anyBot-Setup-0.3.6.exe\n    sha512: ${hash}\n    size: ${installer.length}\npath: anyBot-Setup-0.3.6.exe\nsha512: ${hash}\n`;

test('release versions compare numerically and reject malformed/path input', () => {
  assert.equal(compareVersions('0.3.10', '0.3.9'), 1);
  assert.equal(compareVersions('0.3.4', '0.3.4'), 0);
  assert.equal(compareVersions('0.3.4', '0.3.5'), -1);
  for (const bad of ['../source', 'v0.3.6', '0.3.6-beta', '01.2.3', '0.3']) assert.throws(() => releaseFiles(bad));
});
test('update feed must describe the exact installer, version, size, and checksum', () => {
  verifyUpdateMetadata('0.3.6', metadata, installer);
  for (const altered of [metadata.replace('version: 0.3.6', 'version: 0.3.5'), metadata.replace('url: anyBot-', 'url: https://other/anyBot-'), metadata.replace(`size: ${installer.length}`, 'size: 1'), metadata.replace(hash, 'wrong')]) assert.throws(() => verifyUpdateMetadata('0.3.6', altered, installer));
  assert.throws(() => verifyUpdateMetadata('0.3.6', metadata, Buffer.from('different installer')));
});
test('public assets reject source archives, private audits, duplicates, and incomplete uploads', () => {
  const names = releaseFiles('0.3.6');
  const hashes = Object.fromEntries(names.map(n => [n, 'abc']));
  const assets = names.map(name => ({name, state: 'uploaded', digest: 'sha256:abc'}));
  verifyPublicAssets('0.3.6', assets, hashes);
  for (const name of ['source.zip', 'private-release-audit.json', 'app.asar']) assert.throws(() => verifyPublicAssets('0.3.6', [...assets, {name}], hashes));
  assert.throws(() => verifyPublicAssets('0.3.6', [assets[0], assets[0], assets[2]], hashes));
  assert.throws(() => verifyPublicAssets('0.3.6', assets.map(a => ({...a, state: 'new'})), hashes));
  assert.throws(() => verifyPublicAssets('0.3.6', assets.map(a => ({...a, digest: 'sha256:wrong'})), hashes));
});
test('download page links directly to the installer, not the release asset list', () => {
  const page = downloadReadme('0.3.6');
  assert.ok(page.includes('/releases/download/v0.3.6/anyBot-Setup-0.3.6.exe'));
  assert.ok(!page.includes('/releases/tag/'));
  assert.ok(!page.includes('gilfila/anyBot/'));
});
