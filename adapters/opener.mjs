import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Opens a URL in one profile of the ALREADY RUNNING Chrome: the OS-level
// launch forwards to the existing browser process (no second instance, no
// restart) and returns immediately. This is how a download lands in the
// profile we chose, which CDP target creation cannot guarantee on a
// multi-profile browser.
export async function openInProfile(spec, profileDir, url) {
  if (spec.platform === 'win32') {
    await run(spec.executablePath, ['--profile-directory', profileDir, url],
      { windowsHide: true, timeout: 20_000 });
  } else if (spec.platform === 'darwin') {
    await run('open', ['-na', 'Google Chrome', '--args', '--profile-directory', profileDir, url],
      { timeout: 20_000 });
  } else {
    throw new Error(`No Chrome opener for platform ${spec.platform}`);
  }
  return { opened: true };
}
