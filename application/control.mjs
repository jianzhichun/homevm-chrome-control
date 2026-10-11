import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hostInstance, root } from '../adapters/host.mjs';
import { attribute } from '../domain/profiles.mjs';
import { PageLeases } from '../domain/leases.mjs';

const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const page = { type: 'integer', minimum: 0 };
const file = { type: 'string', description: 'Absolute path on the browser machine, not homevm.' };
const extraTools = [
  { name: 'browser_status', description: 'Daemon status only; does not prove the browser connection is approved.', inputSchema: schema({}) },
  { name: 'browser_claim_page', description: 'Claim a page before every page-scoped tool. Lease lasts 15 minutes and renews on use.', inputSchema: schema({ pageId: page }, ['pageId']) },
  { name: 'browser_release_page', description: 'Release a page owned by this actor.', inputSchema: schema({ pageId: page }, ['pageId']) },
  { name: 'browser_download_inventory', description: 'List files and partial downloads in a configured directory on the browser machine.', inputSchema: schema({ directory: file }, ['directory']) },
  { name: 'browser_wait_file', description: 'Verify a nonempty completed local file by absence of .crdownload, stable size and SHA256. This is filesystem evidence, not a CDP completion event.', inputSchema: schema({ path: file, timeoutMs: { type: 'integer', minimum: 1, maximum: 25000 } }, ['path']) },
];
const text = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

// The dedicated headless browser is not a profile of the user's Chrome; it
// is addressed with this pseudo profile directory name.
export const DEDICATED_PROFILE = 'chrome-control';

// "## Pages\n1: title (url) [selected]" from the official list_pages.
export function parsePageLines(raw) {
  const body = typeof raw === 'string' ? raw : raw?.content?.find(c => c.type === 'text')?.text || '';
  return [...body.matchAll(/^(\d+): (.*)$/gm)].map(m => {
    const label = m[2].replace(/ \[selected\]$/, '');
    let url = (label.match(/\((https?:\/\/[^)]*)\)\s*$/) || [])[1] || '';
    // "2: https://b.test/" is a page with no title: the whole label IS the url.
    let title;
    if (!url && /^https?:\/\//.test(label)) { url = label; title = ''; }
    else if (url) title = label === url ? '' : label.slice(0, label.length - url.length - 3);
    else title = label;
    return { pageId: Number(m[1]), title, url };
  });
}

export class BrowserControl {
  // hostFactory builds sibling instances (the same composition the process
  // would use); tests substitute their own fakes.
  constructor(actor, host = hostInstance(), leaseRoot = join(host.profile.runtime, 'leases'), hostFactory = hostInstance) {
    this.actor = actor;
    this.host = host;
    this.hostFactory = hostFactory;
    this.daemon = host.daemon;
    this.starter = host.starter;
    this.files = host.files;
    this.leaseRoot = leaseRoot;
    this.leases = new PageLeases(leaseRoot, actor);
  }

  // Remote start: the host's starter (the daemon itself on macOS, the logon
  // task on Windows). boot() is the in-session start run by login bootstraps
  // and by the Windows task every 5 minutes: it does nothing (and prints
  // nothing) while the daemon answers, so repeated ticks are no-ops.
  async start() { return this.starter.start(); }
  async boot() {
    const current = await this.daemon.status().catch(() => ({ running: false }));
    return current.running ? undefined : this.daemon.start();
  }

  async tools() {
    return [...JSON.parse(await readFile(join(root, 'config/tools.json'), 'utf8')), ...extraTools];
  }

  // Discover the Chrome profiles of this host: the user-facing browser's
  // info_cache (directory name, display name, signed-in account) plus the
  // dedicated pseudo profile when this host has one.
  async profiles() {
    const found = [];
    const serving = this.host.profile.profiles;
    if (serving && this.host.profiles) {
      for (const p of await this.host.profiles.list()) found.push({ ...p, instance: serving.browser });
    }
    if (this.host.profile.mode === 'dedicated') {
      found.unshift({ dir: DEDICATED_PROFILE, name: 'chrome-control (dedicated headless)', gaia: '', user: '', instance: 'default' });
    }
    return { profiles: found };
  }

  // A profile directory routes to the browser instance that owns it: the
  // dedicated pseudo profile to the default instance, a discovered Chrome
  // profile to the instance hosts.json names as its server.
  hostFor(profileDir) {
    if (!profileDir || profileDir === DEDICATED_PROFILE) return this.host;
    const serving = this.host.profile.profiles;
    if (!serving || !this.host.profiles) throw new Error(`No profile discovery on this host; cannot route ${profileDir}`);
    return this.hostFactory(serving.browser);
  }

  // Pages of one instance, each attributed to its Chrome profile where the
  // profile's own session files identify them. With a profileDir only that
  // profile's tabs are returned; the rest are counted, not hidden.
  async pages(profileDir) {
    const host = this.hostFor(profileDir);
    const control = host === this.host ? this : new BrowserControl(this.actor, host);
    const pages = parsePageLines(await control.daemon.call('list_pages'));
    if (!profileDir || profileDir === DEDICATED_PROFILE) {
      return profileDir === DEDICATED_PROFILE
        ? { profile: profileDir, pages, unattributed: 0 }
        : { pages };
    }
    const inventory = host.profiles;
    if (!inventory) throw new Error(`No profile discovery on this host; cannot filter ${profileDir}`);
    const known = (await inventory.list()).map(p => p.dir);
    if (!known.includes(profileDir)) throw new Error(`Unknown profile directory ${profileDir}; known: ${known.join(', ')}`);
    const attributed = attribute(pages, await inventory.urlSets());
    const owned = attributed.filter(p => p.profile === profileDir);
    return { profile: profileDir, pages: owned, unattributed: attributed.length - owned.length };
  }

  async call(name, args = {}, profileDir) {
    const host = this.hostFor(profileDir);
    const control = host === this.host ? this : new BrowserControl(this.actor, host);
    // Page IDs are daemon-scoped: with a profile target, reject only a pageId
    // that provably belongs to a DIFFERENT profile of the same browser;
    // unattributed pages pass (attribution is best-effort history).
    if (profileDir && profileDir !== DEDICATED_PROFILE && args && Number.isSafeInteger(args.pageId)) {
      const pages = parsePageLines(await control.daemon.call('list_pages'));
      const attributed = host.profiles ? attribute(pages, await host.profiles.urlSets()) : pages;
      const entry = attributed.find(p => p.pageId === args.pageId);
      if (!entry) throw new Error(`pageId ${args.pageId} not found on the instance serving ${profileDir}`);
      if (entry.profile && entry.profile !== profileDir) {
        throw new Error(`pageId ${args.pageId} belongs to profile ${entry.profile}, not ${profileDir}`);
      }
    }
    return control._call(name, args);
  }

  async _call(name, args = {}) {
    const tool = (await this.tools()).find(t => t.name === name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    for (const key of tool.inputSchema.required || []) {
      if (!(key in args)) throw new Error(`Missing required argument: ${key}`);
    }
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
        if (name === 'close_page' && !result.isError) await this.leases.release(args.pageId);
        return result;
      }
    }
  }
}
