import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { applyBrand } = require('../desktop/brand.cjs');

for (const [label, packaged, userDir, expectedDir] of [
  ['renamed packaged default preserves existing data', true, 'Any Bot', 'anyBot'],
  ['existing installed profile stays in place', true, 'anyBot', 'anyBot'],
  ['custom test/profile override stays in place', true, 'custom-profile', 'custom-profile'],
  ['development profile stays in place', false, 'anybot-desktop', 'anybot-desktop'],
]) test(label, () => {
  const root = path.resolve('test-profiles');
  const paths = { appData: root, userData: path.join(root, userDir), sessionData: path.join(root, userDir) };
  const app = { isPackaged: packaged, getPath: key => paths[key], setPath: (key, value) => paths[key] = value, setName: name => app.name = name, setAppUserModelId: id => app.id = id };
  applyBrand(app);
  assert.equal(app.name, 'Any Bot');
  assert.equal(paths.userData, path.join(root, expectedDir));
  assert.equal(paths.sessionData, paths.userData);
  if (process.platform === 'win32') assert.equal(app.id, 'dev.anybot.desktop');
});

test('Windows branding retains install/update identity and includes every icon size', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  assert.equal(pkg.build.productName, 'Any Bot');
  assert.equal(pkg.build.appId, 'dev.anybot.desktop');
  assert.equal(pkg.build.win.executableName, 'anyBot');
  assert.equal(pkg.build.nsis.artifactName, 'anyBot-Setup-${version}.${ext}');
  assert.equal(pkg.build.nsis.shortcutName, 'Any Bot');
  assert.ok(!pkg.scripts.package.includes('signAndEditExecutable=false'));
  const ico = readFileSync(new URL('../assets/brand/app.ico', import.meta.url));
  assert.equal(ico.readUInt16LE(2), 1);
  const count = ico.readUInt16LE(4);
  assert.equal(count, 7);
  const sizes = [];
  for (let n = 0; n < count; n++) {
    const entry = 6 + n * 16, offset = ico.readUInt32LE(entry + 12), length = ico.readUInt32LE(entry + 8);
    sizes.push(ico[entry] || 256);
    assert.ok(offset + length <= ico.length);
    assert.equal(ico.subarray(offset, offset + 8).toString('hex'), '89504e470d0a1a0a');
  }
  assert.deepEqual(sizes, [16,24,32,48,64,128,256]);
});
