import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const execute = promisify(execFile);

// Only the official CLI owns browser connections and its daemon protocol.
export class PlaywrightCli {
  constructor(root, workspace, session, run = execute) { Object.assign(this, { root, workspace, session, run }); }

  async prepare() {
    await mkdir(join(this.workspace, '.playwright'), { recursive: true, mode: 0o700 });
  }

  async invoke(command, args = [], extraEnv = {}) {
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (/^PLAYWRIGHT_MCP_|^PWTEST_|^DEBUG$|^NODE_DEBUG$/.test(key)) delete env[key];
    Object.assign(env, extraEnv);
    const entry = join(this.root, 'node_modules/@playwright/cli/playwright-cli.js');
    try {
      const { stdout } = await this.run(process.execPath, [entry, `-s=${this.session}`, '--json', command, ...args], {
        cwd: this.workspace, env, timeout: 90_000, maxBuffer: 16 * 1024 * 1024,
      });
      const result = JSON.parse(stdout);
      if (result.isError) throw new Error(result.error || JSON.stringify(result));
      return result;
    } catch (error) {
      let message = error.stdout?.trim() || error.stderr?.trim() || error.message;
      const token = extraEnv.PLAYWRIGHT_MCP_EXTENSION_TOKEN;
      if (token) message = message.replaceAll(token, '[redacted]');
      message = message.replace(/([?&]token=)[^&\s"<>]+/g, '$1[redacted]');
      throw new Error(`Playwright CLI ${command} failed: ${message.slice(0, 1200)}`);
    }
  }

  async script(source) {
    const directory = join(this.workspace, '.playwright', 'invocations');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, randomUUID() + '.js');
    await writeFile(file, source, { mode: 0o600, flag: 'wx' });
    try {
      const response = await this.invoke('run-code', ['--filename', file]);
      if (response.isError || response.error) throw new Error(response.error || 'Playwright command failed');
      let result = response.result;
      if (typeof result === 'string') {
        try { result = JSON.parse(result); } catch { /* Plain text is a valid result. */ }
      }
      return result;
    } finally { await unlink(file); }
  }

  async state() {
    return JSON.parse(await readFile(join(this.workspace, '.playwright', `${this.session}.json`), 'utf8'));
  }

  async saveState(value) {
    const path = join(this.workspace, '.playwright', `${this.session}.json`);
    const temporary = path + '.' + randomUUID();
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  }
}
