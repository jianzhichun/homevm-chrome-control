import { daemonGeneration } from '../adapters/bindings.mjs';
import { parsePageLines } from '../domain/pages.mjs';
import { validateDestination } from '../domain/accounts.mjs';
import { payload } from './page.mjs';

export class ManagedPages {
  constructor(control) { this.control = control; }

  async list() {
    const c = this.control;
    const generation = daemonGeneration(await c.daemon.status());
    const raw = await c.daemon.call('list_pages');
    if (raw?.isError) payload(raw);
    return { generation, pages: parsePageLines(raw) };
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
    if (c.host.profile.mode !== 'extension') throw new Error('Named accounts require a paired existing-browser Profile');
    await c.starter.start();
    const generation = daemonGeneration(await c.daemon.status());
    const opened = await c.daemon.openPage(url);
    try {
      await c._call('browser_claim_page', { pageId: opened.pageId });
      const binding = { pageId: opened.pageId, actor: c.actor, profile: account.dir, email: account.email,
        source: 'official-playwright-extension-profile-pairing', createdAt: new Date().toISOString() };
      await c.host.bindings.save(generation, binding);
      await this.require(account, opened.pageId);
      return { account, ...opened, binding };
    } catch (error) {
      await c.daemon.call('close_page', { pageId: opened.pageId }).catch(() => {});
      await c.host.bindings.remove(generation, opened.pageId);
      throw error;
    }
  }
}
