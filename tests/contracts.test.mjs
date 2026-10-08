import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PageLeases } from '../domain/leases.mjs';
import { BrowserFiles } from '../adapters/files.mjs';
import { BrowserControl } from '../application/control.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(homedir(), 'tmp/chrome-contract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('page ownership excludes another actor, expires and releases', async t => {
  const root = await fixture(t);
  const a = new PageLeases(root, 'a');
  const b = new PageLeases(root, 'b');
  await a.claim(1);
  await assert.rejects(b.claim(1), /leased/);
  await assert.rejects(b.release(1), /owner/);
  await writeFile(join(root, '1'), JSON.stringify({ actor: 'a', expires: 0 }));
  await b.claim(1);
  await b.require(1);
  await b.release(1);
  await assert.rejects(b.require(1), /Claim/);
  assert.throws(() => b.path('../x'), /Invalid/);
});

test('file verification rejects escapes and partial files, hashes a stable file', async t => {
  const root = await fixture(t);
  const allowed = join(root, 'allowed');
  await mkdir(allowed);
  const files = new BrowserFiles([allowed]);
  await writeFile(join(root, 'outside'), 'secret');
  await symlink(join(root, 'outside'), join(allowed, 'escape'));
  await assert.rejects(files.path(join(allowed, 'escape')), /outside/);
  const path = join(allowed, 'result.txt');
  await writeFile(path, 'verified');
  await writeFile(path + '.crdownload', 'partial');
  await assert.rejects(files.wait(path, 1), /not verified/);
  await rm(path + '.crdownload');
  const result = await files.wait(path, 2000);
  assert.equal(result.bytes, 8);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
});

test('unknown tools and missing page claims fail before touching the browser', async t => {
  let calls = 0;
  let pid = 1;
  const control = new BrowserControl('test', {
    call: async () => { calls++; return {}; },
    status: async () => ({ running: true, pid }),
  }, await fixture(t));
  await assert.rejects(control.call('not_a_tool'), /Unknown/);
  await assert.rejects(control.call('take_snapshot', {}), /Missing/);
  await assert.rejects(control.call('take_snapshot', { pageId: 1 }), /Claim/);
  assert.equal(calls, 0);
  await control.call('browser_claim_page', { pageId: 1 });
  await control.call('take_snapshot', { pageId: 1 });
  assert.equal(calls, 1);
  pid = 2;
  await assert.rejects(control.call('take_snapshot', { pageId: 1 }), /Claim/);
  assert.equal(calls, 1);
});
