import { writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js',
    '--autoConnect', '--no-usage-statistics', '--no-performance-crux',
    '--redactNetworkHeaders', '--experimentalVision'],
  env: { ...process.env, CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: '1' },
  stderr: 'inherit',
});
const client = new Client({ name: 'chrome-control-catalog', version: '0.1.0' });
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  await writeFile('config/tools.json', JSON.stringify(tools, null, 2) + '\n');
  console.log(`${tools.length} upstream tools exported; no browser operation requested.`);
} finally {
  await client.close();
}
