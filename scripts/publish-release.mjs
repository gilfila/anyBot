import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { compareVersions, releaseFiles, verifyPublicAssets, verifyUpdateMetadata, downloadReadme } from './release-policy.mjs';

const sourceRepo = 'gilfila/anyBot';
const publicRepo = 'gilfila/anyBot-updates';
const sha = process.env.GITHUB_SHA;
const version = JSON.parse(readFileSync('package.json')).version;
const tag = `v${version}`;
const marker = `<!-- source-commit: ${sha} -->`;
if (process.env.GITHUB_REPOSITORY !== sourceRepo || process.env.GITHUB_REF !== 'refs/heads/main' || !/^[a-f0-9]{40}$/.test(sha || '')) throw Error('Publish only from the source repository main branch');
if (!process.env.SOURCE_TOKEN || !process.env.RELEASE_TOKEN) throw Error('Missing scoped publishing credentials');

async function api(repo, endpoint, { method = 'GET', body, missing = false } = {}) {
  const token = repo === sourceRepo ? process.env.SOURCE_TOKEN : process.env.RELEASE_TOKEN;
  // No trailing slash: GitHub answers /repos/owner/name/ with 404.
  const response = await fetch(`https://api.github.com/repos/${repo}${endpoint ? `/${endpoint}` : ''}`, {
    method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 404 && missing) return null;
  if (!response.ok) throw Error(`GitHub ${method} ${repo}/${endpoint}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}

const source = await api(sourceRepo, '');
const target = await api(publicRepo, '');
// The source repo may be public (it is since 2026-09-23); the distribution
// repo must be public so installed copies can update without credentials.
if (!source.full_name || target.private) throw Error('Expected a public distribution repository');
const main = await api(sourceRepo, 'git/ref/heads/main');
if (main.object.sha !== sha) throw Error('A newer merge exists; refusing to publish a stale main build');
const tree = await api(publicRepo, `git/trees/${target.default_branch}?recursive=1`);
if (tree.truncated || tree.tree.some(entry => entry.path !== 'README.md')) throw Error('Public distribution repository contains unexpected files; review before publishing');
const latest = await api(publicRepo, 'releases/latest', { missing: true });
if (latest && compareVersions(version, latest.tag_name.replace(/^v/, '')) < 0) throw Error('Refusing to downgrade the update feed');
const priorTag = await api(sourceRepo, `git/ref/tags/${tag}`, { missing: true });
if (priorTag && priorTag.object.sha !== sha) throw Error('Source tag already belongs to another commit');

const files = releaseFiles(version);
const buffers = Object.fromEntries(files.map(name => [name, readFileSync(`release/${name}`)]));
verifyUpdateMetadata(version, buffers['latest.yml'].toString(), buffers[files[0]]);
const hashes = Object.fromEntries(files.map(name => [name, createHash('sha256').update(buffers[name]).digest('hex')]));
const audit = JSON.parse(readFileSync('release/private-release-audit.json'));
if (audit.version !== version || audit.sourceCommit !== sha || files.some(name => audit.files[name] !== hashes[name])) throw Error('Build provenance does not match the publishing commit and assets');
let release = await api(publicRepo, `releases/tags/${tag}`, { missing: true });
if (release && !release.body?.includes(marker)) throw Error('Existing public version belongs to a different source commit');
if (!release) release = await api(publicRepo, 'releases', { method: 'POST', body: {
  tag_name: tag, target_commitish: target.default_branch, name: `anyBot ${version}`, draft: true,
  body: `Windows installer and automatic update files.\n\n[Download the Windows installer](https://github.com/${publicRepo}/releases/download/${tag}/${files[0]})\n\n${marker}`,
} });
if (release.draft) {
  // A retry may replace only unpublished assets belonging to this exact commit.
  for (const asset of release.assets) await api(publicRepo, `releases/assets/${asset.id}`, { method: 'DELETE' });
  for (const name of files) {
    const url = new URL(release.upload_url.split('{')[0]);
    if (url.origin !== 'https://uploads.github.com') throw Error('Unexpected upload host');
    url.searchParams.set('name', name);
    const result = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${process.env.RELEASE_TOKEN}`, 'Content-Type': 'application/octet-stream' }, body: buffers[name] });
    if (!result.ok) throw Error(`Upload failed for ${name}: HTTP ${result.status}`);
  }
}
release = await api(publicRepo, `releases/${release.id}`);
verifyPublicAssets(version, release.assets, hashes);
// Never copy source files, source commits, or source git history into the public repo.
if (!priorTag) await api(sourceRepo, 'git/refs', { method: 'POST', body: { ref: `refs/tags/${tag}`, sha } });
// Recheck immediately before promoting, in case main advanced during upload.
if ((await api(sourceRepo, 'git/ref/heads/main')).object.sha !== sha) throw Error('Main advanced during upload; draft retained without changing the live feed');
if (release.draft) await api(publicRepo, `releases/${release.id}`, { method: 'PATCH', body: { draft: false, make_latest: 'true' } });
const live = await api(publicRepo, 'releases/latest');
if (live.tag_name !== tag || !live.body.includes(marker)) throw Error('Latest release/source mismatch');
verifyPublicAssets(version, live.assets, hashes);
const readme = await api(publicRepo, 'contents/README.md');
const content = Buffer.from(downloadReadme(version)).toString('base64');
if (readme.content.replace(/\s/g, '') !== content) await api(publicRepo, 'contents/README.md', { method: 'PUT', body: { message: `Update installer link for ${tag}`, sha: readme.sha, content } });
const feed = await fetch(`https://github.com/${publicRepo}/releases/latest/download/latest.yml`);
if (!feed.ok) throw Error(`Published feed unavailable: HTTP ${feed.status}`);
verifyUpdateMetadata(version, await feed.text(), buffers[files[0]]);
console.log(`Published and verified ${tag} from ${sha}. Only installer, blockmap, and latest.yml are public assets.`);
