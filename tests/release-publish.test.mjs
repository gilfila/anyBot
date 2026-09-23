import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const publisher = new URL('../scripts/publish-release.mjs', import.meta.url).href;
const sha = 'a'.repeat(40);

function exercise(scenario) {
  const dir = mkdtempSync(path.join(tmpdir(), 'anybot-release-test-'));
  try {
    mkdirSync(path.join(dir, 'release'));
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '0.3.6' }));
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
      cwd: dir, encoding: 'utf8', env: { ...process.env, GITHUB_SHA: sha, GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'gilfila/anyBot', SOURCE_TOKEN: 'test-source', RELEASE_TOKEN: 'test-public' },
      input: `
        import {readFileSync,writeFileSync} from 'node:fs';
        import {createHash} from 'node:crypto';
        const scenario=${JSON.stringify(scenario)};
        const sha=${JSON.stringify(sha)};
        const calls=[];
        let release=null,tag=null;
        const response=(value,status=200)=>new Response(JSON.stringify(value),{status});
        globalThis.fetch=async (url,options={})=>{
          const u=new URL(url),method=options.method||'GET';
          calls.push(method+' '+u.pathname);
          const body=options.body && typeof options.body==='string'?JSON.parse(options.body):null;
          if(u.hostname==='uploads.github.com'){
            const name=u.searchParams.get('name');
            release.assets.push({id:release.assets.length+1,name,state:'uploaded',digest:'sha256:'+(scenario==='bad-digest'?'wrong':createHash('sha256').update(options.body).digest('hex'))});
            return response({});
          }
          if(u.hostname==='github.com')return new Response(readFileSync('release/latest.yml'));
          const p=u.pathname;
          if(p==='/repos/gilfila/anyBot/')return response({private:true});
          if(p==='/repos/gilfila/anyBot-updates/')return response({private:false,default_branch:'main'});
          if(p.endsWith('/git/ref/heads/main'))return response({object:{sha:scenario==='stale'?'b'.repeat(40):sha}});
          if(p.endsWith('/git/trees/main'))return response({tree:[{path:scenario==='public-source'?'src/App.jsx':'README.md'}]});
          if(p.endsWith('/releases/latest'))return release&&!release.draft?response(release):response(null,404);
          if(p.endsWith('/git/ref/tags/v0.3.6'))return tag?response(tag):response(null,404);
          if(p.endsWith('/releases/tags/v0.3.6'))return scenario==='version-collision'?response({body:'other commit'}):response(null,404);
          if(p.endsWith('/releases')&&method==='POST'){release={...body,id:1,assets:[],upload_url:'https://uploads.github.com/repos/gilfila/anyBot-updates/releases/1/assets{?name,label}'};return response(release);}
          if(p.endsWith('/releases/1')){if(method==='PATCH')Object.assign(release,body);return response(release);}
          if(p.endsWith('/git/refs')&&method==='POST'){tag={object:{sha:body.sha}};return response(tag);}
          if(p.endsWith('/contents/README.md'))return response({sha:'readme',content:Buffer.from('old').toString('base64')});
          throw Error('Unexpected mock request '+method+' '+p);
        };
        try{await import(${JSON.stringify(publisher)});}catch(error){console.error(error.message);process.exitCode=1;}
        finally{writeFileSync('calls.json',JSON.stringify({calls,release,tag}));}
      `,
    });
    return { ...result, state: JSON.parse(readFileSync(path.join(dir, 'calls.json'))) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('publisher uploads only the three assets, verifies before promotion, and tags exact private source', () => {
  const result = exercise('success');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.state.tag.object.sha, sha);
  assert.equal(result.state.release.draft, false);
  assert.deepEqual(result.state.release.assets.map(a => a.name), ['anyBot-Setup-0.3.6.exe', 'anyBot-Setup-0.3.6.exe.blockmap', 'latest.yml']);
  const promotion = result.state.calls.indexOf('PATCH /repos/gilfila/anyBot-updates/releases/1');
  assert.ok(promotion > result.state.calls.indexOf('POST /repos/gilfila/anyBot/git/refs'));
  assert.ok(result.state.calls.slice(0,promotion).includes('GET /repos/gilfila/anyBot-updates/releases/1'));
});
for (const scenario of ['wrong-audit', 'bad-digest', 'stale', 'public-source', 'version-collision']) {
  test(`publisher fails closed without changing Latest: ${scenario}`, () => {
    const result = exercise(scenario);
    assert.notEqual(result.status, 0);
    assert.ok(!result.state.calls.includes('PATCH /repos/gilfila/anyBot-updates/releases/1'));
    assert.equal(result.state.tag, null);
  });
}
