import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Opens a URL in one profile of the ALREADY RUNNING Chrome -- the OS-level
// forward into the existing browser is what picks the profile, which CDP
// target creation cannot do on a multi-profile browser.
//
// Windows: a chrome.exe spawned from SSH cannot hand the URL across logon
// sessions (the profile's ProcessSingleton lock lives in the interactive
// one), so the request file + one-shot scheduled task route is used; the
// request content must stay ASCII (profile dir names and URLs are).
// macOS: `open` from ssh talks to the user's GUI session directly.
export async function openInProfile(opener, profileDir, url) {
  if (opener.kind === 'openTask') {
    const content = [opener.executablePath, profileDir, url].join('\r\n') + '\r\n';
    // eslint-disable-next-line no-control-regex
    if (/[^\x00-\x7f]/.test(content)) throw new Error('open-request must be ASCII');
    await writeFile(opener.request, content, 'utf8');
    await run('schtasks.exe', ['/Run', '/TN', opener.task], { windowsHide: true, timeout: 15_000 });
    return { opened: true, via: 'task' };
  }
  if (opener.platform === 'darwin') {
    await run('open', ['-na', 'Google Chrome', '--args', '--profile-directory', profileDir, url],
      { timeout: 20_000 });
    return { opened: true, via: 'open' };
  }
  throw new Error(`No Chrome opener configured for ${opener.platform}`);
}
