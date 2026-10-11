import { mkdir } from 'node:fs/promises';

const session = 'cc001';
let upstream;

// Thin adapter over the official chrome-devtools-mcp daemon client. The
// upstream reads XDG_RUNTIME_DIR at call time for its pid file and socket
// (named pipe on Windows), so the environment is fixed here before the first
// call and the spawned daemon inherits it.
export class OfficialDaemon {
  constructor(profile, root, facts = async () => ({})) {
    this.profile = profile;
    this.root = root;
    this.facts = facts;
    process.env.XDG_RUNTIME_DIR = profile.runtime;
    if (profile.tmp) process.env.TMPDIR = profile.tmp;
    process.env.CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS = '1';
    process.env.CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS = '1';
  }

  async upstream() {
    upstream ??= {
      ...await import('../node_modules/chrome-devtools-mcp/build/src/daemon/client.js'),
      ...await import('../node_modules/chrome-devtools-mcp/build/src/daemon/utils.js'),
    };
    return upstream;
  }

  async start() {
    const { startDaemon } = await this.upstream();
    await mkdir(this.profile.runtime, { recursive: true, mode: 0o700 });
    if (this.profile.tmp) await mkdir(this.profile.tmp, { recursive: true, mode: 0o700 });
    await startDaemon(this.profile.daemonArgs(this.root, await this.facts()), session);
    return this.status();
  }

  async status() {
    const { isDaemonRunning, sendCommand } = await this.upstream();
    if (!isDaemonRunning(session)) return { running: false, browserVerified: false };
    const response = await sendCommand({ method: 'status' }, session, 5_000);
    if (!response.success) throw new Error(response.error);
    return { running: true, browserVerified: false, ...JSON.parse(response.result) };
  }

  async call(name, args) {
    const { isDaemonRunning, sendCommand } = await this.upstream();
    if (!isDaemonRunning(session)) throw new Error('Daemon not running. Run browserctl start explicitly; no browser is launched implicitly.');
    const response = await sendCommand({ method: 'invoke_tool', tool: name, args }, session, 30_000);
    if (!response.success) throw new Error(response.error);
    return JSON.parse(response.result);
  }

  async stop() {
    const { stopDaemon } = await this.upstream();
    await stopDaemon(session);
    return { stopped: true };
  }
}
