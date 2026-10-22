import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFile } from 'node:fs/promises';
import { payload } from '../application/page.mjs';

const [machine, account, url, expectedUsername, evidenceFile] = process.argv.slice(2);
if (!evidenceFile) throw new Error('Usage: probe-account-mcp.mjs MACHINE ACCOUNT URL EXPECTED_USERNAME EVIDENCE_FILE');
const transport = new StdioClientTransport({
  command: new URL('../bin/browserctl', import.meta.url).pathname,
  args: ['--machine', machine, '--actor', 'account-mcp-acceptance', '--account', account, 'mcp'],
  stderr: 'inherit',
});
const client = new Client({ name: 'chrome-account-acceptance', version: '1.0.0' });
let pageId;
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.ok(tools.some(t => t.name === 'browser_open') && tools.some(t => t.name === 'browser_identity'));
  const opened = payload(await client.callTool({ name: 'browser_open', arguments: { url } }));
  pageId = opened.pageId;
  assert.ok(Number.isSafeInteger(pageId));
  const identity = payload(await client.callTool({ name: 'browser_identity', arguments: { pageId } }));
  assert.equal(identity.status, 'matched');
  assert.equal(identity.username, expectedUsername);
  const missing = await client.callTool({ name: 'take_snapshot', arguments: { pageId: 987654321 } });
  assert.ok(missing.isError);
  const pages = payload(await client.callTool({ name: 'list_pages', arguments: {} }));
  assert.ok(pages.pages.some(p => p.pageId === pageId));
  await writeFile(evidenceFile, JSON.stringify({ machine, account, sshMcpVerified: true, tools: tools.length,
    pageId, profile: opened.account.dir, identity, unknownPageBlocked: true, scopedListingVerified: true }, null, 2) + '\n');
  console.log('Scoped SSH MCP open/identity/listing and unknown-page rejection passed.');
} finally {
  if (pageId !== undefined) await client.callTool({ name: 'close_page', arguments: { pageId } }).catch(() => {});
  await client.close();
}
