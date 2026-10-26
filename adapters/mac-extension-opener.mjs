import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ProfileLauncher } from './profile-launcher.mjs';
import { EXTENSION_ID } from '../domain/extension.mjs';

// The upstream opens token-bearing URLs as Chrome argv. Route a private stdin
// URL through an exact, profile-scoped anchor instead; no credential in argv.
export class MacExtensionOpener {
  async open({ url, profileDirectory, userDataDir }) {
    const target = new URL(url);
    if (target.protocol !== 'chrome-extension:' || target.hostname !== EXTENSION_ID || target.pathname !== '/connect.html') throw new Error('Unexpected extension connection URL');
    if (!profileDirectory || !target.searchParams.get('token')) throw new Error('Profile and pairing token are required');
    const data = userDataDir || join(homedir(), 'Library/Application Support/Google/Chrome');
    const launcher = new ProfileLauncher(data, join(homedir(), 'tmp/chrome-control/anchors'));
    const anchor = await launcher.open(profileDirectory);
    try {
      const script = `const app=Application('Google Chrome');const u=${JSON.stringify(anchor.url)};const found=[];
        for(const w of app.windows())for(const t of w.tabs())if(t.url()===u)found.push(t);
        if(found.length!==1)throw Error('Profile anchor not found');found[0].url=${JSON.stringify(url)};`;
      await new Promise((resolve, reject) => {
        const child = spawn('/usr/bin/osascript', ['-l', 'JavaScript'], { stdio: ['pipe', 'ignore', 'ignore'], timeout: 15_000 });
        child.on('error', () => reject(new Error('Could not open extension connection through macOS Automation')));
        child.on('exit', code => code === 0 ? resolve() : reject(new Error('macOS Automation did not open the paired Profile')));
        child.stdin.on('error', () => {});
        child.stdin.end(script);
      });
    } catch (error) {
      await launcher.closeAnchor(anchor.url).catch(() => {});
      throw error;
    } finally { await anchor.dispose(); }
  }
}
