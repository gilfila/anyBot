import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const publisher = new URL('../scripts/publish-release.mjs', import.meta.url).href;
const sha = 'a'.repeat(40);
const SOURCE = 'gilfila/anyBot';
const MIRROR = 'gilfila/anyBot-updates';

// Runs the publisher against an in-memory GitHub with both repos: the source
// repo (the update feed) and the anyBot-updates mirror for older installs.
function exercise(scenario) {
  const dir = mkdtempSync(path.join(tmpdir(), 'anybot-release-test-'));
  try {
    mkdirSync(path.join(dir, 'release'));
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '0.3.6' }));
    writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [0.3.6] - 2026-09-01\n\n### Fixed\n- The thing\n\n## [0.3.5] - 2026-08-30\n\n- Older\n');
    const installer = Buffer.from('fake installer');
    const hash = createHash('sha512').update(installer).digest('base64');
    const files = {
      'anyBot-Setup-0.3.6.exe': installer,
      'anyBot-Setup-0.3.6.exe.blockmap': Buffer.from('blockmap'),
      'latest.yml': Buffer.from(`version: 0.3.6\nfiles:\n  - url: anyBot-Setup-0.3.6.exe\n    sha512: ${hash}\n    size: ${installer.length}\npath: anyBot-Setup-0.3.6.exe\nsha512: ${hash}\n`),
    };
    for (const [name, bytes] of Object.entries(files)) writeFileSync(path.join(dir, 'release', name), bytes);
    const hashes = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')]));
    writeFileSync(path.join(dir, 'release/private-release-audit.json'), JSON.stringify({ version: '0.3.6', sourceCommit: scenario === 'wrong-audit' ? 'b'.repeat(40) : sha, files: hashes }));
    const result = spawnSync(process.execPath, ['--input-type=module', '-'], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, GITHUB_SHA: sha, GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: SOURCE, SOURCE_TOKEN: 'test-source', RELEASE_TOKEN: 'test-public' },
      input: `
        import {readFileSync,writeFileSync} from 'node:fs';
        import {createHash} from 'node:crypto';
        const scenario=${JSON.stringify(scenario)};
        const sha=${JSON.stringify(sha)};
        const calls=[];
        const releases={};
        let nextId=1,tag=null,readmePut=null;
        const response=(value,status=200)=>new Response(JSON.stringify(value),{status});
        const repoOf=(p)=>p.startsWith('/repos/${MIRROR}')?'${MIRROR}':'${SOURCE}';
        globalThis.fetch=async (url,options={})=>{
          const u=new URL(url),method=options.method||'GET';
          calls.push(method+' '+u.pathname+' '+(options.headers?.Authorization||''));
          const body=options.body && typeof options.body==='string'?JSON.parse(options.body):null;
          if(u.hostname==='uploads.github.com'){
            const release=Object.values(releases).find(r=>u.pathname.endsWith('/releases/'+r.id+'/assets'));
            release.assets.push({id:release.assets.length+1,name:u.searchParams.get('name'),state:'uploaded',digest:'sha256:'+(scenario==='bad-digest'?'wrong':createHash('sha256').update(options.body).digest('hex'))});
            return response({});
          }
          if(u.hostname==='github.com')return new Response(readFileSync('release/latest.yml'));
          const p=u.pathname,repo=repoOf(p),own=releases[repo];
          // Like GitHub: a trailing slash is a 404.
          if(p.endsWith('/'))return response({message:'Not Found'},404);
          if(p==='/repos/${SOURCE}')return response({full_name:'${SOURCE}',private:scenario==='private-source',default_branch:'main'});
          if(p==='/repos/${MIRROR}')return response({full_name:'${MIRROR}',private:scenario==='private-updates',default_branch:'main'});
          if(p.endsWith('/git/ref/heads/main'))return response({object:{sha:scenario==='stale'?'b'.repeat(40):sha}});
          if(p.endsWith('/git/trees/main'))return response({tree:[{path:scenario==='public-source'?'src/App.jsx':'README.md'}]});
          if(p.endsWith('/releases/latest')){
            if(scenario==='downgrade'&&repo==='${SOURCE}')return response({tag_name:'v0.9.0',body:'',assets:[]});
            return own&&!own.draft?response(own):response(null,404);
          }
          if(p.endsWith('/git/ref/tags/v0.3.6'))return tag?response(tag):response(null,404);
          if(p.endsWith('/releases/tags/v0.3.6'))return scenario==='version-collision'?response({body:'other commit'}):response(null,404);
          if(p.endsWith('/releases')&&method==='POST'){
            const id=nextId++;
            releases[repo]={...body,id,repo,assets:[],upload_url:'https://uploads.github.com/repos/'+repo+'/releases/'+id+'/assets{?name,label}'};
            return response(releases[repo]);
          }
          if(own&&p.endsWith('/releases/'+own.id)){if(method==='PATCH')Object.assign(own,body);return response(own);}
          if(p.endsWith('/git/refs')&&method==='POST'){tag={object:{sha:body.sha}};return response(tag);}
          if(p.endsWith('/contents/README.md')){if(method==='PUT')readmePut=repo;return response({sha:'readme',content:Buffer.from('old').toString('base64')});}
          throw Error('Unexpected mock request '+method+' '+p);
        };
        try{await import(${JSON.stringify(publisher)});}catch(error){console.error(error.message);process.exitCode=1;}
        finally{writeFileSync('calls.json',JSON.stringify({calls,releases,tag,readmePut}));}
      `,
    });
    return { ...result, state: JSON.parse(readFileSync(path.join(dir, 'calls.json'))) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const promotions = (state) => state.calls.filter((c) => /^PATCH \/repos\/.*\/releases\/\d+ /.test(c));

test('publisher releases on the source repo and its mirror: three assets each, verified before promotion, exact commit tagged', () => {
  const result = exercise('success');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.state.tag.object.sha, sha);
  for (const repo of [SOURCE, MIRROR]) {
    const release = result.state.releases[repo];
    assert.ok(release, `a release on ${repo}`);
    assert.equal(release.draft, false);
    // The release notes are the version's CHANGELOG entry, then the download link.
    assert.match(release.body, /^### Fixed\n- The thing\n\n\[Download the Windows installer\]/);
    assert.ok(release.body.includes(`https://github.com/${repo}/releases/download/v0.3.6/`));
    assert.ok(!release.body.includes('Older'));
    assert.deepEqual(release.assets.map(a => a.name), ['anyBot-Setup-0.3.6.exe', 'anyBot-Setup-0.3.6.exe.blockmap', 'latest.yml']);
  }
  // The source release points at the exact commit; the mirror never gets source history.
  assert.equal(result.state.releases[SOURCE].target_commitish, sha);
  assert.equal(result.state.releases[MIRROR].target_commitish, 'main');
  // Each repo is written with its own token: the workflow token for the source repo,
  // the scoped release app's token for the mirror.
  assert.ok(result.state.calls.filter(c => c.includes(`/repos/${MIRROR}`) && c.startsWith('POST')).every(c => c.endsWith('Bearer test-public')));
  assert.ok(result.state.calls.filter(c => c.includes(`/repos/${SOURCE}/`) && c.startsWith('POST')).every(c => c.endsWith('Bearer test-source')));
  // Both drafts are verified and the tag exists before anything goes live.
  const firstPromotion = result.state.calls.indexOf(promotions(result.state)[0]);
  assert.equal(promotions(result.state).length, 2);
  assert.ok(firstPromotion > result.state.calls.findIndex(c => c.startsWith(`POST /repos/${SOURCE}/git/refs`)));
  for (const repo of [SOURCE, MIRROR]) {
    const id = result.state.releases[repo].id;
    assert.ok(result.state.calls.slice(0, firstPromotion).some(c => c.startsWith(`GET /repos/${repo}/releases/${id} `)));
  }
  assert.equal(result.state.readmePut, MIRROR, 'only the mirror has a generated download README');
});
for (const scenario of ['wrong-audit', 'bad-digest', 'stale', 'public-source', 'version-collision', 'private-updates', 'private-source', 'downgrade']) {
  test(`publisher fails closed without changing Latest anywhere: ${scenario}`, () => {
    const result = exercise(scenario);
    assert.notEqual(result.status, 0);
    assert.deepEqual(promotions(result.state), []);
    assert.equal(result.state.tag, null);
  });
}
