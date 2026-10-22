#!/usr/bin/env node
import { BrowserControl } from '../application/control.mjs';
import { commandResult } from './commands.mjs';

let [actor, command, tool, rawArgs] = process.argv.slice(2);
const control = new BrowserControl(actor || 'operator');
try {
  let selector = process.env.CHROME_CONTROL_PROFILE ? { profile: process.env.CHROME_CONTROL_PROFILE } : undefined;
  let args = JSON.parse(rawArgs || '{}');
  if (command === 'scoped') {
    if (args.protocolVersion !== 1 || !args.selector || Object.keys(args.selector).length !== 1 || !['account', 'profile'].includes(Object.keys(args.selector)[0])) {
      throw new Error('Unsupported account-routing protocol or selector');
    }
    selector = args.selector;
    command = tool;
    tool = args.tool;
    args = args.arguments || {};
  }
  const result = await commandResult(control, command, tool, args, selector);
  if (result !== undefined) {
    console.log(JSON.stringify(result));
    if (result.isError) process.exitCode = 1;
  }
} catch (error) {
  console.error(JSON.stringify({ error: error.message, approved: false }));
  process.exitCode = 1;
}
