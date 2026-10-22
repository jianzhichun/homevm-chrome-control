import { setTimeout as delay } from 'node:timers/promises';
import { daemonGeneration } from '../adapters/bindings.mjs';
import { uniqueAnchor, parsePageLines } from '../domain/pages.mjs';
import { validateDestination } from '../domain/accounts.mjs';
import { payload } from './page.mjs';

export class ManagedPages {
  constructor(control) { this.control = control; }

  async list() {
    const c = this.control;
    const generation = daemonGeneration(await c.daemon.status());
    const raw = await c.daemon.call('list_pages');
    if (raw?.isError) payload(raw);
    if (JSON.stringify(raw).includes('browser was restarted or reconnected')) await c.host.bindings.invalidate(generation);
    const pages = parsePageLines(raw);
    return { generation, pages };
  }

  async require(account, pageId) {
    const { generation, pages } = await this.list();
    const binding = await this.control.host.bindings.get(generation, pageId);
    if (!pages.some(p => p.pageId === pageId) || !binding || binding.profile !== account.dir || binding.email !== account.email) {
      throw new Error(`pageId ${pageId} has no verified binding to ${account.dir}; use open with this account`);
    }
    return binding;
  }

  async pages(account) {
    const { generation, pages } = await this.list();
    const owned = [];
    for (const page of pages) {
      const binding = await this.control.host.bindings.get(generation, page.pageId);
      if (binding?.profile === account.dir && binding.email === account.email) owned.push({ ...page, binding });
    }
    return { account, pages: owned, unboundOrOther: pages.length - owned.length };
  }

  async open(account, destination) {
    const url = validateDestination(destination);
    const c = this.control;
    const generation = daemonGeneration(await c.daemon.status());
    const anchor = await c.host.launcher.open(account.dir);
    let page;
    try {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const current = await this.list();
        if (current.generation !== generation) throw new Error('Daemon generation changed while opening account tab');
        page = uniqueAnchor(current.pages, anchor.url);
        if (page) break;
        await delay(250);
      }
      if (!page) throw new Error('Target Profile tab is not visible to this Chrome connection; no other account was used');
      await c._call('browser_claim_page', { pageId: page.pageId });
      const binding = { pageId: page.pageId, actor: c.actor, profile: account.dir, email: account.email, source: 'chrome-profile-ipc-one-time-local-anchor', createdAt: new Date().toISOString() };
      await c.host.bindings.save(generation, binding);
      const response = await c._call('navigate_page', { pageId: page.pageId, type: 'url', url, timeout: 25_000 });
      payload(response);
      // Recheck after navigation; a reconnect must not bless a stale pageId.
      await this.require(account, page.pageId);
      return { account, pageId: page.pageId, url, binding };
    } catch (error) {
      if (page) {
        const stillBound = await this.require(account, page.pageId).catch(() => null);
        if (stillBound) await c._call('close_page', { pageId: page.pageId }).catch(() => {});
        await c.host.bindings.remove(generation, page.pageId);
      } else await c.host.launcher.closeAnchor(anchor.url).catch(() => {});
      throw error;
    } finally { await anchor.dispose(); }
  }
}
