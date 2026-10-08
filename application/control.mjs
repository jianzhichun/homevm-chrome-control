import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { OfficialDaemon, root, runtime } from '../adapters/daemon.mjs';
import { BrowserFiles } from '../adapters/files.mjs';
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

export class BrowserControl {
  constructor(actor, daemon = new OfficialDaemon(), leaseRoot = join(runtime, 'leases')) {
    this.daemon = daemon;
    this.leaseRoot = leaseRoot;
    this.leases = new PageLeases(leaseRoot, actor);
    this.files = new BrowserFiles([root, join(homedir(), 'Downloads'), join(homedir(), 'Brook/Sync/30_Resources/31_Knowledge_Base/Cam/MPhil')]);
  }

  async tools() {
    return [...JSON.parse(await readFile(join(root, 'config/tools.json'), 'utf8')), ...extraTools];
  }

  async call(name, args = {}) {
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
