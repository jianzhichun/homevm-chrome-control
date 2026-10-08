import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFile } from 'node:fs/promises';

const transport = new StdioClientTransport({
  command: '/home/dev/bin/browserctl',
  args: ['--machine', 'zengxiaoximac01', '--actor', 'mcp-acceptance', 'mcp'],
  stderr: 'inherit',
});
const client = new Client({ name: 'chrome-control-acceptance', version: '0.1.0' });
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 36);
  const status = await client.callTool({ name: 'browser_status', arguments: {} });
  const missingLease = await client.callTool({ name: 'take_snapshot', arguments: { pageId: 987654321 } });
  assert.ok(missingLease.isError);
  const inventory = await client.callTool({ name: 'browser_download_inventory', arguments: { directory: '/Users/brook/workspace/chrome-control' } });
  assert.ok(!inventory.isError);
  await writeFile('evidence/mac-mcp.json', JSON.stringify({ tools: tools.length, sshMcpVerified: true, daemon: JSON.parse(status.content[0].text), missingLeaseBlocked: true, fileInventoryVerified: true, existingBrowserVerified: false }, null, 2) + '\n');
  console.log('SSH MCP initialize/listTools/status/fileInventory/lease gate passed; browser approval not claimed.');
} finally {
  await client.close();
}
