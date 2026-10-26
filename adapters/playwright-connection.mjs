import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Connection modes are shared on every OS; the host supplies paths/startup.
export class PlaywrightConnection {
  constructor(profile, root, cli, pairings, accountProfile, facts) {
    Object.assign(this, { profile, root, cli, pairings, accountProfile, facts });
  }

  async validate() {
    if (this.profile.mode === 'extension') {
      if (!this.accountProfile) throw new Error('Existing-browser control requires --account or --profile; no default Chrome was selected');
      return this.pairings.require(this.accountProfile);
    }
    if (!['dedicated', 'isolated'].includes(this.profile.mode)) throw new Error('Unsupported Playwright connection mode; autoConnect is not a persistent authorization channel');
    return null;
  }

  async start() {
    const pairing = await this.validate();
    if (pairing) {
      const env = { PLAYWRIGHT_MCP_PROFILE_DIR_NAME: this.accountProfile, PLAYWRIGHT_MCP_EXTENSION_TOKEN: pairing.token };
      if (this.profile.platform === 'darwin') env.CHROME_CONTROL_MAC_OPENER = join(this.root, 'interfaces/mac-extension-open.mjs');
      return this.cli.invoke('attach', ['--extension=chrome', '--idle-timeout=0'], env);
    }
    const config = this.profile.playwrightConfig(await this.facts?.() || {});
    const path = join(this.cli.workspace, '.playwright/cli.config.json');
    await writeFile(path, JSON.stringify(config), { mode: 0o600 });
    return this.cli.invoke('open', ['about:blank', '--config', path, '--idle-timeout=0']);
  }

  stop() { return this.cli.invoke(this.profile.mode === 'extension' ? 'detach' : 'close'); }
}
