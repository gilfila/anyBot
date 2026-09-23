import { createHash } from 'node:crypto';

export function compareVersions(a, b) {
  const parse = value => {
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw Error(`Invalid stable version: ${value}`);
    return value.split('.').map(Number);
  };
  const left = parse(a), right = parse(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return Math.sign(left[i] - right[i]);
  return 0;
}

export function releaseFiles(version) {
  compareVersions(version, version);
  return [`anyBot-Setup-${version}.exe`, `anyBot-Setup-${version}.exe.blockmap`, 'latest.yml'];
}

export function verifyUpdateMetadata(version, metadata, installer) {
  const hash = createHash('sha512').update(installer).digest('base64');
  const value = line => line.trim().replace(/^['"]|['"]$/g, '');
  const fields = [...metadata.matchAll(/^\s*(?:-\s*)?(version|url|path|sha512|size):\s*(.+)$/gm)];
  const values = key => fields.filter(m => m[1] === key).map(m => value(m[2]));
  if (values('version').length !== 1 || values('version')[0] !== version) throw Error('Update metadata version mismatch');
  for (const key of ['url', 'path']) {
    if (values(key).length !== 1 || values(key)[0] !== releaseFiles(version)[0]) throw Error('Unexpected update artifact path');
  }
  if (values('sha512').length !== 2 || values('sha512').some(v => v !== hash)) throw Error('Installer checksum mismatch');
  if (values('size').length !== 1 || Number(values('size')[0]) !== installer.length) throw Error('Installer size mismatch');
}

export function verifyPublicAssets(version, assets, hashes) {
  const allowed = releaseFiles(version);
  if (assets.length !== allowed.length || assets.some(a => !allowed.includes(a.name))) throw Error('Public release must contain only installer, blockmap, and update metadata');
  for (const name of allowed) {
    const asset = assets.find(a => a.name === name);
    if (!asset || asset.state !== 'uploaded' || asset.digest !== `sha256:${hashes[name]}`) throw Error(`Unverified public asset: ${name}`);
  }
}

export function downloadReadme(version) {
  compareVersions(version, version);
  return `# anyBot for Windows\n\n[**Download anyBot ${version} — Windows installer**](https://github.com/gilfila/anyBot-updates/releases/download/v${version}/anyBot-Setup-${version}.exe)\n\nRun the installer. Existing installations can use **Check for updates** inside anyBot.\n\nThis repository hosts installation and update files. The application's development repository is private.\n`;
}
