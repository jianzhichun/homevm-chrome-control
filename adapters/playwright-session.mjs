import { join, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';
import { ExtensionPairings } from './extension-pairings.mjs';
import { PlaywrightCli } from './playwright-cli.mjs';
import { PlaywrightConnection } from './playwright-connection.mjs';
import { BROWSER_TOOLS, scopeKey, sessionName } from '../domain/browser-session.mjs';
import { compatibleSnapshot, listPagesScript, pageActionScript, pageRegistry } from '../domain/playwright-actions.mjs';

const result = value => ({ content: [{ type: 'text', text: '```json\n' + JSON.stringify(value) + '\n```' }] });
const listing = pages => ({ content: [{ type: 'text', text: '## Pages\n' + pages.map(p => `${p.pageId}: ${p.title} (${p.url})`).join('\n') }] });

export class PlaywrightSession {
  constructor(profile, root, actor, accountProfile, files, facts) {
    Object.assign(this, { profile, root, actor, accountProfile, files });
    this.pairings = new ExtensionPairings(join(profile.home, '.config/chrome-control/pairings'), profile.profiles?.userDataDir);
    const scope = accountProfile || (profile.mode === 'extension' ? '' : profile.instanceName || 'dedicated');
    this.workspace = join(profile.runtime, 'playwright', scope ? scopeKey(scope) : 'unscoped');
    this.session = sessionName(scope);
    this.cli = new PlaywrightCli(root, this.workspace, this.session);
    this.connection = new PlaywrightConnection(profile, root, this.cli, this.pairings, accountProfile, facts);
    this.supportedTools = BROWSER_TOOLS;
  }

  async status() {
    const info = { backend: 'playwright-cli', mode: this.profile.mode, profile: this.accountProfile || null };
    if (this.profile.mode === 'extension' && !this.accountProfile) {
      await this.cli.prepare();
      const current = await this.cli.invoke('list', ['--all']);
      const sessions = current.browsers.filter(b => {
        const path = b.workspace && relative(join(this.profile.runtime, 'playwright'), b.workspace);
        return path && !path.startsWith('..') && !isAbsolute(path) && b.name.startsWith('cc-');
      }).map(b => ({ session: b.name, running: b.status === 'open', compatible: b.compatible }));
      return { ...info, running: sessions.some(s => s.running && s.compatible), requiresAccount: true, sessions };
    }
    let state;
    try { state = await this.cli.state(); }
    catch (error) {
      if (error.code === 'ENOENT') return { ...info, running: false };
      throw error;
    }
    if (!Number.isSafeInteger(state.pid)) return { ...info, running: false };
    const current = await this.cli.invoke('list');
    const running = current.browsers.some(b => b.name === this.session && b.status === 'open' && b.compatible);
    return { ...info, running, pid: state.pid, startDate: state.startDate, session: this.session, browserVerified: false };
  }

  prepareStart() { return this.connection.validate(); }

  async lifecycle(action) {
    await this.cli.prepare();
    const release = await lockfile.lock(this.workspace, { stale: 30_000, update: 5_000,
      retries: { retries: 60, minTimeout: 200, maxTimeout: 1_000 } });
    try { return await action(); } finally { await release(); }
  }

  async start() {
    await this.prepareStart();
    return this.lifecycle(async () => {
      const current = await this.status();
      if (current.running) return current;
      await this.cli.saveState({ pid: null, startDate: new Date().toISOString() });
      const started = await this.connection.start();
      if (!Number.isSafeInteger(started.pid)) throw new Error('Official CLI did not return a daemon PID');
      await this.cli.saveState({ pid: started.pid, startDate: new Date().toISOString(), generation: randomUUID() });
      return this.status();
    });
  }

  async stop() {
    await this.prepareStart();
    return this.lifecycle(async () => {
      const stopped = await this.connection.stop();
      await this.cli.saveState({ pid: null, startDate: new Date().toISOString() });
      return stopped;
    });
  }

  async openPage(url) {
    const opened = await this.cli.script(`async page=>{${pageRegistry()}const p=await c.newPage();const id=r.next++;r.pages.set(id,p);
      try{await p.goto(${JSON.stringify(url)},{timeout:25000});return {pageId:id,url:p.url()};}
      catch(e){await p.close();r.pages.delete(id);throw e;}}`);
    if (!Number.isSafeInteger(opened?.pageId)) throw new Error('Official CLI did not return a managed page ID');
    return opened;
  }

  async call(name, args = {}) {
    if (this.profile.mode === 'extension' && !this.accountProfile) throw new Error('Existing-browser control requires --account or --profile');
    if (!BROWSER_TOOLS.has(name)) throw new Error(`${name} is not supported by the Playwright CLI backend`);
    if (!(await this.status()).running) throw new Error('Browser session is not running; run start/open explicitly');
    if (name === 'list_pages') return listing(await this.cli.script(listPagesScript()));
    if (name === 'new_page') { await this.openPage(args.url); return this.call('list_pages'); }
    if (name === 'take_screenshot') {
      if (!args.filePath) throw new Error('Playwright screenshots require an explicit filePath');
      if (args.format === 'webp') throw new Error('Playwright screenshots support png/jpeg only');
      const encoded = await this.cli.script(pageActionScript(name, args));
      const path = await this.files.writeBuffer(args.filePath, Buffer.from(encoded, 'base64'));
      return result(await this.files.describe(path));
    }
    if (name === 'upload_file') args = { ...args, filePaths: await Promise.all(args.filePaths.map(p => this.files.path(p))) };
    const value = await this.cli.script(pageActionScript(name, args));
    return result(name === 'take_snapshot' ? compatibleSnapshot(value) : value);
  }
}
