import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const page = { type: 'integer', minimum: 0 };
const file = { type: 'string', description: 'Absolute path on the browser machine, not homevm.' };
const extra = [
  { name: 'browser_status', description: 'Daemon status only; does not prove browser approval or website identity.', inputSchema: schema({}) },
  { name: 'browser_claim_page', description: 'Claim a page. Account-scoped calls also require a verified Profile binding.', inputSchema: schema({ pageId: page }, ['pageId']) },
  { name: 'browser_release_page', description: 'Release a page owned by this actor.', inputSchema: schema({ pageId: page }, ['pageId']) },
  { name: 'browser_download_inventory', description: 'List files and partial downloads in a configured directory.', inputSchema: schema({ directory: file }, ['directory']) },
  { name: 'browser_wait_file', description: 'Verify a stable nonempty file and SHA256, not a CDP completion event.', inputSchema: schema({ path: file, timeoutMs: { type: 'integer', minimum: 1, maximum: 25000 } }, ['path']) },
  { name: 'browser_open', description: 'Open a verified managed tab in the explicitly selected account/Profile; reuse existing logins.', inputSchema: schema({ url: { type: 'string' } }, ['url']) },
  { name: 'browser_identity', description: 'Read actual website identity on an account-bound tab; currently supports Cambridge Moodle.', inputSchema: schema({ pageId: page }, ['pageId']) },
];

export async function toolDirectory(root) {
  return [...JSON.parse(await readFile(join(root, 'config/tools.json'), 'utf8')), ...extra];
}
