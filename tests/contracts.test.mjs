import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { PageLeases } from '../domain/leases.mjs';
import { BrowserFiles } from '../adapters/files.mjs';
import { BrowserControl } from '../application/control.mjs';
import { HostProfile } from '../domain/host-profile.mjs';
import { LogonTask } from '../adapters/logon-task.mjs';

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
  const daemon = {
    call: async () => { calls++; return {}; },
    status: async () => ({ running: true, pid }),
  };
  const control = new BrowserControl('test', { daemon }, await fixture(t));
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

test('host profiles: macOS args unchanged, Windows drives a dedicated profile over a pipe', () => {
  const specs = JSON.parse(readFileSync(new URL('../config/hosts.json', import.meta.url)));
  const mac = HostProfile.select(specs, { platform: 'darwin', home: '/Users/brook' });
  assert.deepEqual(mac.daemonArgs('/Users/brook/workspace/chrome-control'), ['--no-usage-statistics', '--no-performance-crux',
    '--redactNetworkHeaders', '--experimentalVision', '--workspace', '/Users/brook/workspace/chrome-control',
    '--workspace', '/Users/brook/Downloads', '--workspace', '/Users/brook/Brook/Sync/30_Resources/31_Knowledge_Base/Cam/MPhil', '--autoConnect']);
  assert.equal(mac.runtime, '/Users/brook/Library/Caches/chrome-control/runtime');
  const win = HostProfile.select(specs, { platform: 'win32', home: 'C:\\Users\\PC', env: { LOCALAPPDATA: 'C:\\Users\\PC\\AppData\\Local' } });
  const args = win.daemonArgs('C:\\Users\\PC\\workspace\\chrome-control');
  assert.equal(args[args.indexOf('--userDataDir') + 1], 'C:\\Users\\PC\\AppData\\Local\\chrome-control\\profile');
  assert.ok(args.includes('--headless') && !args.includes('--autoConnect'));
  assert.ok(!args.some(a => /remote-debugging-port|browserUrl/.test(a)));
  assert.throws(() => HostProfile.select(specs, { platform: 'win32', home: 'C:\\Users\\PC', env: {} }).runtime, /LOCALAPPDATA/);
  assert.throws(() => HostProfile.select(specs, { platform: 'aix', home: '/' }), /Unsupported/);
});

test('logon task start runs the task once and fails clearly if no daemon appears', async () => {
  const runs = [];
  const daemon = { status: async () => ({ running: false }) };
  const task = new LogonTask('chrome-control', daemon, { exec: async (...a) => runs.push(a), timeout: 30, interval: 10 });
  await assert.rejects(task.start(), /not ready/);
  assert.deepEqual(runs.map(r => r[1]), [['/Run', '/TN', 'chrome-control']]);
});
