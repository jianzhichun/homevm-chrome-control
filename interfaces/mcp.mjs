import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export async function serve(control, selector) {
  const server = new Server({ name: 'chrome-control', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await control.tools() }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try { return await control.call(request.params.name, request.params.arguments, selector); }
    catch (error) {
      return { isError: true, content: [{ type: 'text', text: error.message }] };
    }
  });
  await server.connect(new StdioServerTransport());
}
