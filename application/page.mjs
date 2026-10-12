import { parsePageLines } from './control.mjs';

// One leased page of one instance, as the scripted flows see it: evaluate a
// function and get its value back, navigate, snapshot, click. Every call goes
// through BrowserControl._call, so the lease is enforced like any tool call.
export class LeasedPage {
  constructor(control, pageId, url = '') {
    this.control = control;
    this.pageId = pageId;
    this.url = url;
  }

  // Lease an existing page.
  static async borrow(control, pageId, url) {
    await control._call('browser_claim_page', { pageId });
    return new LeasedPage(control, pageId, url);
  }

  // Open a page on the instance and lease it; url is where it landed.
  static async open(control, url) {
    const known = new Set(parsePageLines(await control._call('list_pages')).map(p => p.pageId));
    const fresh = parsePageLines(await control._call('new_page', { url, timeout: 60_000 })).find(p => !known.has(p.pageId));
    if (!fresh) throw new Error(`new_page ${url} produced no new page`);
    return LeasedPage.borrow(control, fresh.pageId, fresh.url);
  }

  async eval(fn) {
    return payload(await this.control._call('evaluate_script', { pageId: this.pageId, function: fn }));
  }

  async navigate(url) {
    return this.control._call('navigate_page', { pageId: this.pageId, type: 'url', url, timeout: 60_000 });
  }

  async snapshot() {
    return payload(await this.control._call('take_snapshot', { pageId: this.pageId }));
  }

  async click(uid) {
    return payload(await this.control._call('click', { pageId: this.pageId, uid }));
  }

  async close() {
    return this.control._call('close_page', { pageId: this.pageId });
  }

  async release() {
    return this.control._call('browser_release_page', { pageId: this.pageId });
  }
}

// MCP results wrap a value as "```json\n<value>\n```"; upstream errors
// surface as isError or an "Error:" text.
export function payload(r) {
  const text = r?.content?.find(c => c.type === 'text')?.text ?? '';
  if (r?.isError || text.startsWith('Error:')) throw new Error(text.slice(0, 200));
  const m = text.match(/```json\n([\s\S]*?)\n```/);
  const raw = m ? m[1] : text;
  try { return JSON.parse(raw); } catch { return raw; }
}
