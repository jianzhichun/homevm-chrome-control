#!/usr/bin/env node
import { BrowserControl } from '../application/control.mjs';
import { serve } from './mcp.mjs';

const [actor, command, tool, rawArgs] = process.argv.slice(2);
const control = new BrowserControl(actor || 'operator');
try {
  let result;
  switch (command) {
    case 'start': result = await control.daemon.start(); break;
    case 'stop': result = await control.daemon.stop(); break;
    case 'status': result = await control.daemon.status(); break;
    case 'tools': result = await control.tools(); break;
    case 'pages': result = await control.call('list_pages'); break;
    case 'call': result = await control.call(tool, JSON.parse(rawArgs || '{}')); break;
    case 'mcp': await serve(control); break;
    default: throw new Error('Expected start, stop, status, tools, pages, call or mcp');
  }
  if (result !== undefined) {
    console.log(JSON.stringify(result));
    if (result.isError) process.exitCode = 1;
  }
} catch (error) {
  console.error(JSON.stringify({ error: error.message, approved: false }));
  process.exitCode = 1;
}
