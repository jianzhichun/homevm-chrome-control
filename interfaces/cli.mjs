#!/usr/bin/env node
import { BrowserControl, DEDICATED_PROFILE } from '../application/control.mjs';
import { downloadArtifact } from '../application/download.mjs';
import { signInCommand } from './login.mjs';
import { serve } from './mcp.mjs';

const [actor, command, tool, rawArgs] = process.argv.slice(2);
// CHROME_CONTROL_PROFILE targets a specific Chrome profile directory for
// pages/call; the process that boots a daemon names its instance through
// CHROME_CONTROL_INSTANCE instead.
const profile = process.env.CHROME_CONTROL_PROFILE;
const control = new BrowserControl(actor || 'operator');
try {
  let result;
  switch (command) {
    case 'start': result = await control.start(); break;
    case 'boot': result = await control.boot(); break;
    case 'stop': result = await control.daemon.stop(); break;
    case 'status': result = await control.daemon.status(); break;
    case 'tools': result = await control.tools(); break;
    case 'profiles': result = await control.profiles(); break;
    case 'download':
      if (!tool) throw new Error('download requires URL and JSON arguments (filename)');
      result = await downloadArtifact(control, { ...JSON.parse(rawArgs || '{}'), url: tool, profile: profile });
      break;
    case 'login': result = await signInCommand(control, { entry: tool, profile }); break;
    case 'pages': result = await control.pages(profile); break;
    case 'call':
      if (!tool) throw new Error('call requires TOOL and optional JSON arguments');
      result = await control.call(tool, JSON.parse(rawArgs || '{}'), profile);
      break;
    case 'mcp': await serve(control); break;
    default: throw new Error('Expected start, boot, stop, status, tools, profiles, download, login, pages, call or mcp');
  }
  if (result !== undefined) {
    console.log(JSON.stringify(result));
    if (result.isError) process.exitCode = 1;
  }
} catch (error) {
  console.error(JSON.stringify({ error: error.message, approved: false }));
  process.exitCode = 1;
}
