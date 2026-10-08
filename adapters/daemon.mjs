import { homedir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const runtime = process.env.CHROME_CONTROL_RUNTIME || join(homedir(), 'Library/Caches/chrome-control/runtime');
process.env.XDG_RUNTIME_DIR = runtime;
process.env.TMPDIR = join(homedir(), 'tmp/chrome-control');
process.env.CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS = '1';
process.env.CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS = '1';
const { sendCommand, startDaemon, stopDaemon } = await import('../node_modules/chrome-devtools-mcp/build/src/daemon/client.js');
const { isDaemonRunning } = await import('../node_modules/chrome-devtools-mcp/build/src/daemon/utils.js');
const session = 'cc001';

export class OfficialDaemon {
  async start() {
    await mkdir(runtime, { recursive: true, mode: 0o700 });
    await mkdir(process.env.TMPDIR, { recursive: true, mode: 0o700 });
    const args = ['--no-usage-statistics', '--no-performance-crux', '--redactNetworkHeaders',
      '--experimentalVision', '--workspace', root, '--workspace', join(homedir(), 'Downloads'),
      '--workspace', join(homedir(), 'Brook/Sync/30_Resources/31_Knowledge_Base/Cam/MPhil')];
    if (process.env.CHROME_CONTROL_MODE === 'isolated') {
      args.push('--headless', '--isolated', '--executablePath', '/usr/bin/google-chrome');
    } else {
      args.push('--autoConnect');
    }
    await startDaemon(args, session);
    return this.status();
  }

  async status() {
    if (!isDaemonRunning(session)) return { running: false, browserVerified: false };
    const response = await sendCommand({ method: 'status' }, session, 5_000);
    if (!response.success) throw new Error(response.error);
    return { running: true, browserVerified: false, ...JSON.parse(response.result) };
  }

  async call(name, args) {
    if (!isDaemonRunning(session)) throw new Error('Daemon not running. Run browserctl start explicitly; no browser is launched implicitly.');
    const response = await sendCommand({ method: 'invoke_tool', tool: name, args }, session, 30_000);
    if (!response.success) throw new Error(response.error);
    return JSON.parse(response.result);
  }

  async stop() {
    await stopDaemon(session);
    return { stopped: true };
  }
}
