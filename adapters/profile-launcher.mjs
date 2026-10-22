import { execFile as run } from 'node:child_process';
import { promisify } from 'node:util';
import { readlink, mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const execFile = promisify(run);

// Ask the already-running Chrome to route a local, network-free anchor via
// its own profile IPC. No profile copies, debugging ports or browser restart.
export class ProfileLauncher {
  constructor(userDataDir, directory, platform = process.platform, exec = execFile) {
    Object.assign(this, { userDataDir, directory, platform, exec });
  }

  async runningChrome() {
    if (this.platform !== 'darwin') throw new Error('Verified profile opening is currently available on macOS only');
    const lock = await readlink(join(this.userDataDir, 'SingletonLock')).catch(() => '');
    const pid = Number(lock.match(/-(\d+)$/)?.[1]);
    if (!pid) throw new Error('Chrome must already be running; no browser was launched');
    const { stdout } = await this.exec('/bin/ps', ['-p', String(pid), '-o', 'comm=']);
    const binary = stdout.trim();
    if (!binary.endsWith('/Google Chrome.app/Contents/MacOS/Google Chrome')) throw new Error('Chrome process identity could not be confirmed');
    return binary;
  }

  async open(profile) {
    const binary = await this.runningChrome();
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, `anchor-${randomUUID()}.html`);
    await writeFile(path, '<!doctype html><meta charset="utf-8"><title>Chrome control anchor</title>', { mode: 0o600, flag: 'wx' });
    const url = pathToFileURL(path).href;
    try {
      await this.exec(binary, [`--user-data-dir=${this.userDataDir}`, `--profile-directory=${profile}`, url], { timeout: 15_000 });
      return { url, path, dispose: () => unlink(path) };
    } catch (error) {
      await this.closeAnchor(url).catch(() => {});
      await unlink(path);
      throw error;
    }
  }

  async closeAnchor(url) {
    // Only our exact, unguessable local URL; never close a guessed user tab.
    const script = 'const u=String(argv[0]); const app=Application("Google Chrome"); for(const w of app.windows())for(const t of w.tabs())if(t.url()===u)t.close();';
    await this.exec('/usr/bin/osascript', ['-l', 'JavaScript', '-e', `function run(argv){${script}}`, url], { timeout: 5000 });
  }
}
