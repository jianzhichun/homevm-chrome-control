import { join } from 'node:path';
import { hostInstance, root } from '../adapters/host.mjs';
import { daemonGeneration } from '../adapters/bindings.mjs';
import { resolveAccount, resolveProfile } from '../domain/accounts.mjs';
import { PageLeases } from '../domain/leases.mjs';
import { ManagedPages } from './managed-pages.mjs';
import { websiteIdentity } from './identity.mjs';
import { toolDirectory } from './tool-directory.mjs';
export { parsePageLines } from '../domain/pages.mjs';

const text = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
export const DEDICATED_PROFILE = 'chrome-control';

export class BrowserControl {
  constructor(actor, host = hostInstance(), leaseRoot = join(host.profile.runtime, 'leases'), hostFactory = hostInstance) {
    Object.assign(this, { actor, host, hostFactory, leaseRoot });
    this.daemon = host.daemon;
    this.starter = host.starter;
    this.files = host.files;
    this.leases = new PageLeases(leaseRoot, actor);
    this.managed = new ManagedPages(this);
  }

  async start() { return this.starter.start(); }
  async boot() {
    const current = await this.daemon.status().catch(() => ({ running: false }));
    return current.running ? undefined : this.daemon.start();
  }
  async tools() { return toolDirectory(root); }

  async profiles() {
    const found = [];
    const serving = this.host.profile.profiles;
    if (serving && this.host.profiles) {
      for (const p of await this.host.profiles.list()) found.push({ ...p, instance: serving.browser, identitySource: 'chrome-local-state-registration' });
    }
    if (this.host.profile.mode === 'dedicated') found.unshift({ dir: DEDICATED_PROFILE, name: 'chrome-control (dedicated headless)', user: '', instance: 'default' });
    return { profiles: found, aliases: await this.host.aliases?.read() || {} };
  }

  hostFor(profileDir) {
    if (!profileDir || profileDir === DEDICATED_PROFILE) return this.host;
    const serving = this.host.profile.profiles;
    if (!serving || !this.host.profiles) throw new Error(`No profile discovery on this host; cannot route ${profileDir}`);
    return serving.browser === 'default' ? this.host : this.hostFactory(serving.browser);
  }

  controlFor(profileDir) {
    const host = this.hostFor(profileDir);
    return host === this.host ? this : new BrowserControl(this.actor, host, undefined, this.hostFactory);
  }

  async resolve(selector) {
    if (typeof selector === 'string') selector = { profile: selector };
    if (selector?.profile === DEDICATED_PROFILE) return null;
    const profiles = await this.host.profiles?.list();
    if (!profiles) throw new Error('No Profile account discovery on this host');
    return selector?.account
      ? resolveAccount(profiles, selector.account, await this.host.aliases?.read() || {})
      : resolveProfile(profiles, selector?.profile, await this.host.aliases?.read() || {});
  }

  async pages(selector) {
    if (!selector || selector === DEDICATED_PROFILE || selector.profile === DEDICATED_PROFILE) {
      const { parsePageLines } = await import('../domain/pages.mjs');
      return { pages: parsePageLines(await this.daemon.call('list_pages')) };
    }
    const account = await this.resolve(selector);
    return this.controlFor(account.dir).managed.pages(account);
  }

  async open(url, selector) {
    if (!selector) throw new Error('open requires --account or --profile');
    const account = await this.resolve(selector);
    if (!account) throw new Error('Use new_page for the dedicated instance');
    const c = this.controlFor(account.dir);
    const opened = await c.managed.open(account, url);
    return { ...opened, websiteIdentity: await websiteIdentity(c, account, opened.pageId) };
  }

  async call(name, args = {}, selector) {
    if (!selector || selector === DEDICATED_PROFILE || selector.profile === DEDICATED_PROFILE) return this._call(name, args);
    const account = await this.resolve(selector);
    const c = this.controlFor(account.dir);
    if (name === 'list_pages') return text(await c.managed.pages(account));
    if (name === 'browser_open' || name === 'new_page') {
      if (args.isolatedContext) throw new Error('Account tabs cannot use an isolated browser context');
      if (args.background) throw new Error('Native Profile opening cannot guarantee background mode; use open explicitly');
      return text(await this.open(args.url, selector));
    }
    if (Number.isSafeInteger(args.pageId)) await c.managed.require(account, args.pageId);
    if (name === 'browser_identity') return text(await websiteIdentity(c, account, args.pageId));
    const response = await c._call(name, args);
    if (name === 'close_page' && !response.isError) {
      await c.host.bindings.remove(daemonGeneration(await c.daemon.status()), args.pageId);
    }
    return response;
  }

  async _call(name, args = {}) {
    const tool = (await this.tools()).find(t => t.name === name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    for (const key of tool.inputSchema.required || []) {
      if (!(key in args)) throw new Error(`Missing required argument: ${key}`);
    }
    if (['browser_open', 'browser_identity'].includes(name)) throw new Error(`${name} requires an explicit account/Profile`);
    if (['browser_claim_page', 'browser_release_page'].includes(name) || 'pageId' in tool.inputSchema.properties) {
      const status = await this.daemon.status();
      if (!status.running || !Number.isSafeInteger(status.pid)) throw new Error('No live daemon generation to scope page IDs');
      this.leases.root = join(this.leaseRoot, String(status.pid));
    }
    switch (name) {
      case 'browser_status': return text(await this.daemon.status());
      case 'browser_claim_page': return text(await this.leases.claim(args.pageId));
      case 'browser_release_page': return text(await this.leases.release(args.pageId));
      case 'browser_download_inventory': return text(await this.files.inventory(args.directory));
      case 'browser_wait_file': return text(await this.files.wait(args.path, args.timeoutMs));
      default: {
        if ('pageId' in tool.inputSchema.properties) await this.leases.require(args.pageId);
        const result = await this.daemon.call(name, args);
        if (this.host.bindings && JSON.stringify(result).includes('browser was restarted or reconnected')) {
          await this.host.bindings.invalidate(daemonGeneration(await this.daemon.status()));
        }
        if (name === 'close_page' && !result.isError) await this.leases.release(args.pageId);
        return result;
      }
    }
  }
}
