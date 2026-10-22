import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { BrowserControl } from '../application/control.mjs';
import { PageBindings } from '../adapters/bindings.mjs';
import { BrowserFiles } from '../adapters/files.mjs';
import { ProfileLauncher } from '../adapters/profile-launcher.mjs';
import { resolveAccount } from '../domain/accounts.mjs';
import { parsePageLines, uniqueAnchor } from '../domain/pages.mjs';
import { downloadArtifact } from '../application/download.mjs';

const profiles = [{ dir: 'Profile 1', user: 'a@example.test' }, { dir: 'Default', user: 'b@example.test' }];
const sites = { 'https://www.vle.cam.ac.uk': { username: 'student' } };
const aliases = { school: { email: 'a@example.test', sites } };
const ok = value => ({ content: [{ type: 'text', text: `Script ran on page and returned:\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\`` }] });

async function browser(t) {
  const root = await mkdtemp(join(homedir(), 'tmp/chrome-accounts-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const events = [];
  let pid = 1, username = 'student';
  const pages = new Map([[1, 'https://www.vle.cam.ac.uk/my/']]);
  const pdf = Buffer.from('%PDF-1.7 contract');
  const host = {
    profile: { runtime: root, staging: join(root, 'staging'), profiles: { browser: 'default' } },
    profiles: { list: async () => profiles }, aliases: { read: async () => aliases },
    bindings: new PageBindings(join(root, 'bindings')), files: new BrowserFiles([root]),
    launcher: { open: async dir => {
      events.push(['launch', dir]);
      const id = Math.max(...pages.keys()) + 1;
      const url = `file://${root}/random-${id}.html`;
      pages.set(id, url);
      return { url, dispose: async () => {} };
    } },
    daemon: { status: async () => ({ running: true, pid, startDate: 'start' }), call: async (name, args) => {
      events.push([name, args]);
      if (name === 'list_pages') return { content: [{ type: 'text', text: '## Pages\n' + [...pages].map(([id, url]) => `${id}: Page (${url})`).join('\n') }] };
      if (name === 'navigate_page') pages.set(args.pageId, args.url);
      if (name === 'close_page') pages.delete(args.pageId);
      if (name === 'evaluate_script') {
        if (args.function === '() => location.href') return ok(pages.get(args.pageId));
        if (args.function.includes('readMoodleIdentity')) return ok({ status: 'observed', username });
        if (args.function.includes('fetch(')) return ok({ ok: true, size: pdf.length, b64len: pdf.toString('base64').length });
        return ok(pdf.toString('base64'));
      }
      return { content: [] };
    } },
  };
  const control = new BrowserControl('test', host, join(root, 'leases'));
  return { control, events, pages, host, restart: () => { pid++; }, mismatch: () => { username = 'someone-else'; } };
}

test('email and alias resolve afresh, share identity policy, and reject ambiguous accounts', () => {
  assert.equal(resolveAccount(profiles, 'school', aliases).dir, 'Profile 1');
  assert.deepEqual(resolveAccount(profiles, 'A@EXAMPLE.TEST', aliases).sites, sites);
  assert.throws(() => resolveAccount([...profiles, profiles[0]], 'school', aliases), /Ambiguous/);
  assert.throws(() => resolveAccount(profiles, 'ghost', aliases), /not found/);
});

test('anchor matching retains local URL identity and never picks a newest duplicate', () => {
  const url = 'file:///Users/test/anchor-unique.html';
  const parsed = parsePageLines(`## Pages\n3: Anchor (${url}) [selected]\n4: about:blank`);
  assert.equal(uniqueAnchor(parsed, url).pageId, 3);
  assert.throws(() => uniqueAnchor([...parsed, { pageId: 99, url }], url), /Multiple/);
});

test('managed open binds the actual new tab; same-URL history, wrong accounts and new generations cannot authorize actions', async t => {
  const b = await browser(t);
  const selector = { account: 'school' };
  const opened = await b.control.open('https://www.vle.cam.ac.uk/my/', selector);
  assert.equal(opened.websiteIdentity.status, 'matched');
  assert.equal(opened.pageId, 2);
  assert.deepEqual((await b.control.pages(selector)).pages.map(p => p.pageId), [2]);
  await assert.rejects(b.control.call('take_snapshot', { pageId: 1 }, selector), /no verified binding/);
  await assert.rejects(b.control.call('take_snapshot', { pageId: 2 }, { account: 'b@example.test' }), /no verified binding/);
  assert.equal(b.events.filter(([n]) => n === 'take_snapshot').length, 0);
  b.restart();
  await assert.rejects(b.control.call('take_snapshot', { pageId: 2 }, selector), /no verified binding/);
});

test('native launcher requires existing Chrome and passes an exact Profile selector without a shell', async t => {
  const root = await mkdtemp(join(homedir(), 'tmp/chrome-launch-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const binary = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const launcher = new ProfileLauncher(root, join(root, 'anchors'), 'darwin', async (...args) => {
    calls.push(args);
    return { stdout: binary };
  });
  await assert.rejects(launcher.open('Profile 1'), /already be running/);
  assert.equal(calls.length, 0);
  await symlink('host-12345', join(root, 'SingletonLock'));
  const anchor = await launcher.open('Profile 1');
  assert.deepEqual(calls[1].slice(0, 2), [binary, [`--user-data-dir=${root}`, '--profile-directory=Profile 1', anchor.url]]);
  assert.match(anchor.url, /^file:/);
  await anchor.dispose();
});

test('scoped new_page uses the same managed route, not upstream default-profile creation', async t => {
  const b = await browser(t);
  await b.control.call('new_page', { url: 'about:blank' }, { account: 'school' });
  assert.equal(b.events.filter(([n]) => n === 'launch').length, 1);
  assert.equal(b.events.filter(([n]) => n === 'new_page').length, 0);
});

test('account download checks website identity before fetch and writes each artifact to its own directory', async t => {
  const b = await browser(t);
  await b.control.open('https://www.vle.cam.ac.uk/my/', { account: 'school' });
  const other = new BrowserControl('other-task', b.host, join(b.host.profile.runtime, 'leases'));
  const theirPage = await other.open('https://www.vle.cam.ac.uk/course/', { account: 'school' });
  const args = { account: 'school', url: 'https://www.vle.cam.ac.uk/file.pdf', filename: 'file.pdf' };
  const downloaded = await downloadArtifact(b.control, args);
  assert.equal(downloaded.websiteIdentity.status, 'matched');
  assert.ok(b.pages.has(theirPage.pageId));
  assert.match(downloaded.path, /download-[^/]+\/file.pdf$/);
  assert.match(downloaded.sha256, /^[a-f0-9]{64}$/);
  await assert.rejects(b.host.files.writeBuffer(downloaded.path, Buffer.from('overwrite')), /EEXIST/);
  await assert.rejects(downloadArtifact(b.control, { ...args, account: undefined }), /require --account/);
  const cold = new BrowserControl('cold-download-task', b.host, join(b.host.profile.runtime, 'leases'));
  const coldFile = await downloadArtifact(cold, args);
  assert.equal(coldFile.via, 'session-tab (opened)');
  assert.ok(b.pages.has(theirPage.pageId));
  assert.equal(b.pages.size, 3);
  const fetches = () => b.events.filter(([n, a]) => n === 'evaluate_script' && a.function.includes('const r = await fetch(')).length;
  const before = fetches();
  b.mismatch();
  await assert.rejects(downloadArtifact(b.control, args), /identity mismatch/);
  assert.equal(fetches(), before);
});
