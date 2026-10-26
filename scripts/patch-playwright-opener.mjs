#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Pinned upstream has no injectable URL opener. Keep its protocol untouched and
// replace only the macOS token-bearing launch with our stdin-only IPC adapter.
const path = fileURLToPath(new URL('../node_modules/playwright-core/lib/coreBundle.js', import.meta.url));
const marker = '// chrome-control: private macOS extension URL opener';
const original = `        (0, import_child_process5.spawn)(executablePath, args, {
          windowsHide: true,
          detached: true,
          shell: false,
          stdio: "ignore"
        });`;
const replacement = `        ${marker}
        if (process.platform === 'darwin' && process.env.CHROME_CONTROL_MAC_OPENER && this._token) {
          const opener = (0, import_child_process5.spawn)(process.execPath, [process.env.CHROME_CONTROL_MAC_OPENER], {
            windowsHide: true, detached: true, shell: false, stdio: ['pipe', 'ignore', 'ignore']
          });
          opener.stdin.on('error', () => {});
          opener.stdin.end(JSON.stringify({url: href, profileDirectory: this._profileDirectory, userDataDir: this._customUserDataDir}));
          return;
        }
${original}`;
const source = await readFile(path, 'utf8');
if (!source.includes(marker)) {
  if (source.split(original).length !== 2) throw new Error('Pinned Playwright opener changed; no patch was applied');
  await writeFile(path, source.replace(original, replacement));
}
console.log('Playwright extension opener preserves credentials outside process arguments');
