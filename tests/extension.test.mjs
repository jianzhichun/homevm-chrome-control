import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, stat, chmod, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { EXTENSION_ID } from '../domain/extension.mjs';
import { sessionName } from '../domain/browser-session.mjs';
import { compatibleSnapshot, pageActionScript } from '../domain/playwright-actions.mjs';
import { ExtensionPairings } from '../adapters/extension-pairings.mjs';
import { PlaywrightCli } from '../adapters/playwright-cli.mjs';
import { PlaywrightSession } from '../adapters/playwright-session.mjs';

test('Profile sessions persist across actors; snapshot UIDs retain iframe identity', () => {
  assert.notEqual(sessionName('Profile 1'), sessionName('Default'));
  const snapshot = compatibleSnapshot('- tab "Focused" [ref=e3] [selected]\n  - textbox "Nested" [ref=f0e7]');
  assert.match(snapshot, /uid=0_3 tab "Focused" \[selected\]/);
  assert.match(snapshot, /uid=1_7 textbox "Nested"/);
  assert.match(pageActionScript('click', { pageId: 4, uid: '1_7' }), /aria-ref=f0e7/);
  assert.throws(() => pageActionScript('click', { pageId: 4, uid: 'invalid' }), /fresh take_snapshot/);
});

test('native input activates its page in the same invocation while reads stay unfocused', async () => {
  const calls = [];
  const context = { pages: () => [page] };
  const page = {
    context: () => context,
    isClosed: () => false,
    bringToFront: async () => calls.push('focus'),
    locator: () => ({ click: async () => calls.push('click') }),
    evaluate: async () => calls.push('read'),
  };
  const run = (name, args) => Function('return (' + pageActionScript(name, { pageId: 1, ...args }) + ')')()(page);
  await run('click', { uid: '0_3' });
  assert.deepEqual(calls, ['focus', 'click']);
  calls.length = 0;
  await run('evaluate_script', { function: '() => document.title' });
  assert.deepEqual(calls, ['read']);
});

test('pairing is Profile-specific, private and requires the installed official extension', async t => {
  const root = await mkdtemp(join(homedir(), 'tmp/chrome-pairing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pairings = new ExtensionPairings(join(root, 'private'), join(root, 'chrome'));
  await assert.rejects(pairings.save('Default', 'x'.repeat(32)), /Install the official/);
  const extension = join(root, 'chrome', 'Profile 1', 'Extensions', EXTENSION_ID, '0.4.0');
  await mkdir(extension, { recursive: true });
  await writeFile(join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, permissions: ['debugger'], version: '0.4.0' }));
  await pairings.save('Profile 1', 'x'.repeat(32));
  assert.equal((await pairings.require('Profile 1')).profile, 'Profile 1');
  assert.equal((await stat(pairings.path('Profile 1'))).mode & 0o777, 0o600);
  await assert.rejects(pairings.read('Default'), /not paired/);
  await chmod(pairings.path('Profile 1'), 0o644);
  await assert.rejects(pairings.read('Profile 1'), /0600/);
});

test('official CLI receives credentials only in environment and redacts errors', async t => {
  const root = await mkdtemp(join(homedir(), 'tmp/chrome-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const token = 'private-token-not-in-arguments';
  const seen = [];
  const cli = new PlaywrightCli(root, root, 'profile-session', async (binary, args, options) => {
    seen.push({ binary, args, options });
    if (args.includes('attach')) throw Object.assign(new Error('failed'), { stderr: token });
    const source = await readFile(args.at(-1), 'utf8');
    assert.equal(source, 'async page=>42');
    return { stdout: JSON.stringify({ result: '42' }) };
  });
  await cli.prepare();
  await assert.rejects(cli.invoke('attach', ['--extension=chrome'], { PLAYWRIGHT_MCP_EXTENSION_TOKEN: token }), /\[redacted\]/);
  assert.ok(!JSON.stringify(seen[0].args).includes(token));
  assert.equal(seen[0].options.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN, token);
  assert.equal(await cli.script('async page=>42'), 42);
  await assert.rejects(readFile(seen[1].args.at(-1)), /ENOENT/);
});

test('concurrent actors start one shared session and stop invalidates its generation', async t => {
  const root = await mkdtemp(join(homedir(), 'tmp/chrome-lifecycle-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const profile = { home: root, runtime: root, mode: 'dedicated' };
  const sessions = ['one', 'two'].map(actor => new PlaywrightSession(profile, root, actor, undefined, {}));
  let starts = 0, running = false;
  for (const session of sessions) {
    session.cli.invoke = async () => ({ browsers: running ? [{ name: session.session, status: 'open', compatible: true }] : [] });
    session.connection.start = async () => { starts++; running = true; return { pid: 1234 }; };
    session.connection.stop = async () => { running = false; return { status: 'closed' }; };
  }
  const result = await Promise.all(sessions.map(s => s.start()));
  assert.equal(starts, 1);
  assert.deepEqual(result.map(r => r.pid), [1234, 1234]);
  await sessions[0].stop();
  assert.equal((await sessions[1].status()).running, false);
});
