import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout } from 'node:timers/promises';

const run = promisify(execFile);

// Windows starter. The daemon and its Chrome must live in the interactive
// logon session (DPAPI for the profile's cookies; SSH sessions are reaped on
// disconnect), so a remote `start` asks Task Scheduler to run the logon task
// and waits for the daemon it boots, instead of spawning it from SSH.
export class LogonTask {
  constructor(name, daemon, { exec = run, timeout = 20_000, interval = 500 } = {}) {
    this.name = name;
    this.daemon = daemon;
    this.exec = exec;
    this.timeout = timeout;
    this.interval = interval;
  }

  async start() {
    const current = await this.daemon.status();
    if (current.running) return current;
    await this.exec('schtasks.exe', ['/Run', '/TN', this.name], { windowsHide: true });
    const deadline = Date.now() + this.timeout;
    while (Date.now() < deadline) {
      await setTimeout(this.interval);
      const status = await this.daemon.status().catch(() => ({ running: false }));
      if (status.running) return status;
    }
    throw new Error(`Logon task ${this.name} ran but the daemon was not ready within ${this.timeout} ms; see logs/startup.log on the browser host`);
  }
}
