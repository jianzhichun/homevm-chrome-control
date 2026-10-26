#!/usr/bin/env node
import { MacExtensionOpener } from '../adapters/mac-extension-opener.mjs';

try {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 8192) throw new Error('Extension connection input is too large');
    chunks.push(chunk);
  }
  await new MacExtensionOpener().open(JSON.parse(Buffer.concat(chunks).toString('utf8')));
} catch {
  console.error('Extension profile connection opener failed; no credentials were logged');
  process.exitCode = 1;
}
