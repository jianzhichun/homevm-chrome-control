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

test('host profiles configure the same CLI with paired or dedicated connections', () => {
  const specs = JSON.parse(readFileSync(new URL('../config/hosts.json', import.meta.url)));
  const mac = HostProfile.select(specs, { platform: 'darwin', home: '/Users/brook' });
  assert.equal(mac.mode, 'extension');
  assert.equal(mac.runtime, '/Users/brook/Library/Caches/chrome-control/runtime');
  const win = HostProfile.select(specs, { platform: 'win32', home: 'C:\\Users\\PC', env: { LOCALAPPDATA: 'C:\\Users\\PC\\AppData\\Local' } });
  const config = win.playwrightConfig({ chromeMajor: 155 });
  assert.equal(config.browser.userDataDir, 'C:\\Users\\PC\\AppData\\Local\\chrome-control\\profile');
  assert.equal(config.browser.launchOptions.headless, true);
  assert.ok(config.browser.launchOptions.ignoreDefaultArgs.includes('--use-mock-keychain'));
  assert.ok(win.wants('chromeMajor') && !mac.wants('chromeMajor'));
  assert.throws(() => win.playwrightConfig(), /chromeMajor/);
  assert.match(config.browser.launchOptions.args[0], /Chrome\/155\.0\.0\.0 Safari/);
  assert.doesNotMatch(JSON.stringify(config), /remote-debugging-port|autoConnect|HeadlessChrome/);
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

test('named browser instances keep independent runtime and startup policy', () => {
  const specs = JSON.parse(readFileSync(new URL('../config/hosts.json', import.meta.url)));
  const ctx = { platform: 'win32', home: 'C:\\Users\\PC', env: { LOCALAPPDATA: 'C:\\Users\\PC\\AppData\\Local' } };
  const win = HostProfile.select(specs, ctx);
  const real = win.instance('real');
  assert.equal(real.mode, 'extension');
  assert.match(real.runtime, /runtime-real$/);
  assert.equal(real.starter.name, 'chrome-control-real');
  assert.throws(() => win.instance('nope'), /Unknown browser instance/);
  const mac = HostProfile.select(specs, { platform: 'darwin', home: '/Users/brook' });
  assert.equal(mac.instance('default'), mac);
  assert.throws(() => mac.instance('real'), /Unknown browser instance/);
  assert.equal(mac.profiles.userDataDir, '/Users/brook/Library/Application Support/Google/Chrome');
  assert.equal(win.profiles.userDataDir, 'C:\\Users\\PC\\AppData\\Local\\Google\\Chrome\\User Data');
});

test('profile discovery reads registration metadata without browsing history', async () => {
  const { fromLocalState } = await import('../domain/profiles.mjs');
  const state = JSON.stringify({ profile: { info_cache: {
    'Profile 1': { name: 'Brook', gaia_name: 'Brook', user_name: 'a@gmail.com', active_time: 20 },
    Default: { name: 'BrookZeng', gaia_name: 'brook zeng', user_name: 'b@163.com', active_time: 10 },
  } } });
  assert.deepEqual(fromLocalState(state).map(p => p.dir), ['Profile 1', 'Default']);
  assert.equal(fromLocalState('{}').length, 0);
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
  const inventory = () => ({ list: async () => [{ dir: 'Profile 1', name: 'Brook' }] });
  const makeHost = tag => ({
    profile: { runtime: `/tmp/rt-${tag}`, mode: tag === 'real' ? 'extension' : 'dedicated',
      profiles: { userDataDir: '/ud', browser: 'real' } },
    daemon: { call: async (n, a) => { seen.push([tag, n, a]); return {}; }, status: async () => ({ running: true, pid: 7 }) },
    starter: { start: async () => ({}) },
    profiles: inventory(),
    bindings: { get: async () => null },
    files: {},
  });
  const real = makeHost('real');
  const control = new BrowserControl('t', makeHost('default'), await fixture(t), () => real);
  const routed = await control.pages('Profile 1');
  assert.equal(routed.account.dir, 'Profile 1');
  assert.equal(seen[0][0], 'real');
  await assert.rejects(control.pages('Ghost'), /Unknown profile directory/);
  assert.equal(DEDICATED_PROFILE, 'chrome-control');
});

const ok = v => ({ content: [{ type: 'text', text: 'Script ran on page and returned:\n```json\n' + JSON.stringify(v) + '\n```' }] });
const listing = lines => ({ content: [{ type: 'text', text: ['## Pages', ...lines].join('\n') }] });

// A browser instance whose daemon answers from `answer(name, args)`.
function fakeInstance(mode, answer) {
  const calls = [];
  const staged = {};
  return {
    calls, staged,
    host: {
      profile: { runtime: '/tmp/rt', mode, staging: '/stage', profiles: { userDataDir: '/ud', browser: 'real' } },
      daemon: { status: async () => ({ running: true, pid: 9 }), call: async (n, a) => { calls.push([n, a]); return answer(n, a); } },
      starter: {},
      profiles: { list: async () => [{ dir: 'Profile 1' }, { dir: 'cc-test' }] },
      files: {
        createDownloadPath: async (parent, name) => `${parent}/isolated/${name}`,
        writeBuffer: async (path, buf) => { staged[path] = buf; return path; },
        describe: async path => ({ bytes: staged[path].length, sha256: 'h' }),
      },
    },
  };
}

test('download leg: donor stays inside its profile; dedicated opens and closes its own tab', async t => {
  const { downloadArtifact } = await import('../application/download.mjs');
  const { pickDonor, safeFilename, pdfMagicCheck } = await import('../domain/download.mjs');
  const pdf = Buffer.from('%PDF-1.7 x');
  const b64 = pdf.toString('base64');
  const browserAnswers = landed => (n, a) => {
    if (n === 'list_pages') return listing(['1: about:blank']);
    if (n === 'new_page') return listing(['1: about:blank', `2: ${landed}`]);
    if (n === 'evaluate_script') return ok(a.function.includes('fetch(') ? { ok: true, size: pdf.length, b64len: b64.length } : b64);
    return { content: [] };
  };

  // Dedicated: no tab on the origin -> open one there, fetch, close it.
  const ded = fakeInstance('dedicated', browserAnswers('https://x.test/'));
  const control = new BrowserControl('dl', ded.host, await fixture(t), () => { throw new Error('no other instance'); });
  const out = await downloadArtifact(control, { url: 'https://x.test/a.pdf', filename: 'a.pdf' });
  assert.equal(out.bytes, pdf.length);
  assert.equal(out.via, 'session-tab (opened)');
  assert.deepEqual(ded.calls.filter(c => c[0] === 'close_page').map(c => c[1].pageId), [2]);

  // Dedicated, session gone: the origin redirects to login -> named failure, tab closed.
  const gone = fakeInstance('dedicated', browserAnswers('https://login.microsoftonline.com/x'));
  const c2 = new BrowserControl('dl', gone.host, await fixture(t), () => { throw new Error('no other instance'); });
  await assert.rejects(downloadArtifact(c2, { url: 'https://x.test/a.pdf', filename: 'a.pdf' }), /No session on https:\/\/x.test/);
  assert.ok(gone.calls.some(c => c[0] === 'close_page'));

  assert.equal(pickDonor([{ pageId: 5, url: 'https://x.test/p', profile: null }], 'https://x.test/a.pdf', 'cc-test'), null);
  assert.equal(pickDonor([{ pageId: 6, url: 'https://x.test/q', profile: 'cc-test' }], 'https://x.test/a.pdf', 'cc-test').pageId, 6);
  assert.equal(safeFilename('../escape.pdf'), 'escape.pdf');
  assert.throws(() => safeFilename('a:b.pdf'), /Unsafe/);
  assert.ok(pdfMagicCheck(pdf) && !pdfMagicCheck(Buffer.from('<html')));
});

test('sign-in: TOTP per RFC 6238, credentials parsed, a rejected credential is never resubmitted', async () => {
  const { totpCode, parseCredentials } = await import('../domain/entra.mjs');
  const { CambridgeSignIn } = await import('../application/sign-in.mjs');
  assert.equal(totpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59), '287082');
  assert.deepEqual(parseCredentials('# c\nCAM_USER=u\nCAM_PASS="p w"\nCAM_TOTP_SECRET=S\n'), { user: 'u', password: 'p w', totpSecret: 'S' });
  assert.throws(() => parseCredentials('CAM_USER=u'), /CAM_PASS, CAM_TOTP_SECRET/);

  // Entra keeps showing an empty username field: the second sighting stops the walk.
  const fills = [];
  const page = {
    navigate: async () => {},
    snapshot: async () => '',
    eval: async fn => {
      if (fn.includes('readyState')) return { url: 'https://login.microsoftonline.com/t/saml2', title: 'Sign in', ready: 'complete' };
      if (fn.includes("'filled'")) { fills.push(fn); return 'filled'; }
      if (fn.includes('offsetParent !== null; }')) return fn.includes('loginfmt');
      if (fn.includes('f.value')) return '';
      return fn.includes('innerText') ? '' : false;
    },
  };
  const out = await new CambridgeSignIn(page, { user: 'u', password: 'p', totpSecret: 'S' },
    { entry: 'https://www-x.ezp.test/a', sleep: async () => {} }).run();
  assert.equal(out.ok, false);
  assert.equal(out.stopped, 'username rejected');
  assert.equal(fills.length, 1);
});
