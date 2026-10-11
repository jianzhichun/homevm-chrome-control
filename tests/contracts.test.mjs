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
  const args = win.daemonArgs('C:\\Users\\PC\\workspace\\chrome-control', { chromeMajor: 155 });
  assert.equal(args[args.indexOf('--userDataDir') + 1], 'C:\\Users\\PC\\AppData\\Local\\chrome-control\\profile');
  assert.ok(args.includes('--headless') && !args.includes('--autoConnect'));
  assert.ok(!args.some(a => /remote-debugging-port|browserUrl/.test(a)));
  assert.ok(win.wants('chromeMajor') && !mac.wants('chromeMajor'));
  assert.throws(() => win.daemonArgs('C:\\x'), /chromeMajor/);
  const ua = win.daemonArgs('C:\\x', { chromeMajor: 155 }).find(a => a.startsWith('--chromeArg=--user-agent='));
  assert.match(ua, /Chrome\/155\.0\.0\.0 Safari/);
  assert.doesNotMatch(ua, /Headless/);
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

test('boot is a no-op while the daemon answers and starts it otherwise', async t => {
  let running = true, starts = 0;
  const daemon = { status: async () => ({ running }), start: async () => { starts++; return { running: true }; } };
  const control = new BrowserControl('boot', { daemon }, await fixture(t));
  assert.equal(await control.boot(), undefined);
  running = false;
  await control.boot();
  assert.equal(starts, 1);
});

test('named browser instances: stable hex sessions, own runtime, autoConnect args', () => {
  const specs = JSON.parse(readFileSync(new URL('../config/hosts.json', import.meta.url)));
  const ctx = { platform: 'win32', home: 'C:\\Users\\PC', env: { LOCALAPPDATA: 'C:\\Users\\PC\\AppData\\Local' } };
  const win = HostProfile.select(specs, ctx);
  assert.equal(win.session, 'cc001');
  const real = win.instance('real');
  assert.equal(real.session, win.instance('real').session);
  assert.match(real.session, /^cc[a-f0-9]{6}$/);
  assert.notEqual(real.session, 'cc001');
  assert.match(real.runtime, /runtime-real$/);
  const args = real.daemonArgs('C:\\x');
  assert.ok(args.includes('--autoConnect'));
  assert.ok(!args.includes('--userDataDir') && !args.includes('--headless'));
  assert.equal(real.starter.name, 'chrome-control-real');
  assert.throws(() => win.instance('nope'), /Unknown browser instance/);
  const mac = HostProfile.select(specs, { platform: 'darwin', home: '/Users/brook' });
  assert.equal(mac.instance('default'), mac);
  assert.throws(() => mac.instance('real'), /Unknown browser instance/);
  assert.deepEqual(mac.profiles.userDataDir, '/Users/brook/Library/Application Support/Google/Chrome');
  assert.deepEqual(win.profiles.userDataDir, 'C:\\Users\\PC\\AppData\\Local\\Google\\Chrome\\User Data');
});

test('profile discovery and SNSS attribution', async t => {
  const { fromLocalState, urlsFromSnss, attribute, normalizeUrl } = await import('../domain/profiles.mjs');
  const state = JSON.stringify({ profile: { info_cache: {
    'Profile 1': { name: 'Brook', gaia_name: 'Brook', user_name: 'a@gmail.com', active_time: 20 },
    Default: { name: 'BrookZeng', gaia_name: 'brook zeng', user_name: 'b@163.com', active_time: 10 },
  } } });
  assert.deepEqual(fromLocalState(state).map(p => p.dir), ['Profile 1', 'Default']);
  assert.equal(fromLocalState('{}').length, 0);
  const snss = Buffer.from('junk\x01https://example.com/a?x=1&y=2\x02more\x01https://portal.org/page\x00');
  const urls = [...urlsFromSnss(snss)];
  assert.deepEqual(urls, ['https://example.com/a', 'https://portal.org/page']);
  assert.equal(normalizeUrl('https://x.test/p/?q=1#f'), 'https://x.test/p');
  const sets = new Map([['Profile 1', new Set(urls)], ['Default', new Set(['https://portal.org/page', 'https://example.com/z'])]]);
  const out = attribute([{ pageId: 1, url: 'https://example.com/a?x=9' }, { pageId: 2, url: 'https://portal.org/page' }, { pageId: 3, url: '' }], sets);
  assert.equal(out[0].profile, 'Profile 1');
  assert.deepEqual(out[0].ambiguous, []);
  assert.deepEqual(out[1].ambiguous, ['Profile 1', 'Default']);
  assert.equal(out[1].profile, null);
  assert.equal(out[2].profile, null);
});

test('pages parse from list_pages text and route by profile', async t => {
  const { parsePageLines, DEDICATED_PROFILE } = await import('../application/control.mjs');
  const raw = { content: [{ type: 'text', text: '## Pages\n1: Title (https://a.test/x) [selected]\n2: https://b.test/\n3: no url here' }] };
  assert.deepEqual(parsePageLines(raw), [
    { pageId: 1, title: 'Title', url: 'https://a.test/x' },
    { pageId: 2, title: '', url: 'https://b.test/' },
    { pageId: 3, title: 'no url here', url: '' },
  ]);

  const seen = [];
  // hosts.json carries profile discovery at host level; `browser` names the
  // instance whose daemon serves those profiles.
  const inventory = tag => ({
    list: async () => [{ dir: 'Profile 1', name: 'Brook' }],
    urlSets: async () => new Map(tag === 'real' ? [['Profile 1', new Set(['https://a.test/x'])]] : []),
  });
  const makeHost = tag => ({
    profile: { runtime: `/tmp/rt-${tag}`, mode: tag === 'real' ? 'autoConnect' : 'dedicated',
      profiles: { userDataDir: '/ud', browser: 'real' } },
    daemon: { call: async (n, a) => { seen.push([tag, n, a]); return {}; }, status: async () => ({ running: true, pid: 7 }) },
    starter: { start: async () => ({}) },
    profiles: inventory(tag),
    files: {},
  });
  const real = makeHost('real');
  const control = new BrowserControl('t', makeHost('default'), await fixture(t), () => real);
  const routed = await control.pages('Profile 1');
  assert.equal(routed.profile, 'Profile 1');
  assert.equal(seen[0][0], 'real');
  await assert.rejects(control.pages('Ghost'), /Unknown profile directory/);
  assert.equal(DEDICATED_PROFILE, 'chrome-control');
});

test('download leg: candidate selection, filename safety, pdf magic', async t => {
  const { newFiles, selectCandidate, safeFilename, pdfMagicCheck } = await import('../domain/download.mjs');
  const before = [{ name: 'old.pdf', bytes: 10, partial: false }];
  const after = [...before,
    { name: 'paper.pdf.crdownload', bytes: 5, partial: true },
    { name: 'paper.pdf', bytes: 900, partial: false },
    { name: 'unrelated.zip', bytes: 1, partial: false }];
  assert.deepEqual(newFiles(before, after).map(f => f.name), ['paper.pdf', 'unrelated.zip']);
  assert.equal(selectCandidate(newFiles(before, [{ name: 'only.pdf', bytes: 3, partial: false }])).kind, 'single');
  const two = selectCandidate(newFiles(before, after));
  assert.equal(two.kind, 'pdf');
  assert.equal(two.file.name, 'paper.pdf');
  assert.equal(selectCandidate([{ name: 'a.zip', bytes: 1 }, { name: 'b.zip', bytes: 1 }]).kind, 'ambiguous');
  assert.equal(safeFilename('../escape.pdf'), 'escape.pdf'); // basename-only, staged by us
  assert.throws(() => safeFilename('a:b.pdf'), /Unsafe/);
  assert.equal(safeFilename('C:\\x\\ok name.PDF'), 'ok name.PDF');
  assert.ok(pdfMagicCheck(Buffer.from('%PDF-1.7 rest')));
  assert.ok(!pdfMagicCheck(Buffer.from('<html')));
});

test('download use-case: guard rails before anything touches the browser', async t => {
  const { safeFilename } = await import('../domain/download.mjs');
  assert.equal(safeFilename('../escape.pdf'), 'escape.pdf'); // basename-only, staged by us
  assert.throws(() => safeFilename('a:b.pdf'), /Unsafe/);
  const { BrowserControl } = await import('../application/control.mjs');
  const mod = await import('../application/download.mjs');
  const host = {
    profile: { runtime: '/tmp/rt', mode: 'autoConnect', platform: 'win32',
      executablePath: 'C:/chrome.exe', staging: 'C:/Users/PC/Downloads/chrome-control',
      stagingWatch: 'C:/Users/PC/Downloads', profiles: { userDataDir: '/ud', browser: 'real' } },
    daemon: { call: async () => ({ content: [] }), status: async () => ({ running: true, pid: 3 }) },
    starter: { start: async () => ({}) },
    profiles: { list: async () => [{ dir: 'Profile 1', name: 'Brook' }], urlSets: async () => new Map() },
    files: {},
  };
  const control = new BrowserControl('dl', host, await fixture(t), () => host);
  const dedicated = { ...host, profile: { ...host.profile, mode: 'dedicated' } };
  const c2 = new BrowserControl('dl', dedicated, await fixture(t), () => dedicated);
  await assert.rejects(mod.downloadArtifact(c2, { url: 'https://x.test/a.pdf', filename: 'a.pdf', profile: 'chrome-control' }), /dedicated headless/);
});