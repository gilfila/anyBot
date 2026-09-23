import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { compareVersions } from './release-policy.mjs';

const pkg = JSON.parse(readFileSync('package.json'));
const lock = JSON.parse(readFileSync('package-lock.json'));
compareVersions(pkg.version, pkg.version);
if (pkg.version !== lock.version || pkg.version !== lock.packages[''].version) throw Error('Package and lockfile versions differ');
if (!readFileSync('CHANGELOG.md', 'utf8').includes(`## [${pkg.version}]`)) throw Error('Missing versioned changelog entry');
const base = process.env.RELEASE_BASE_SHA;
if (base) {
  if (!/^[a-f0-9]{40}$/.test(base)) throw Error('Invalid base commit');
  const prior = JSON.parse(execFileSync('git', ['show', `${base}:package.json`], { encoding: 'utf8' }));
  if (compareVersions(pkg.version, prior.version) <= 0) throw Error(`Bump version beyond main (${prior.version}); never reuse a published version`);
}
console.log(`Release version ${pkg.version} is consistent`);
