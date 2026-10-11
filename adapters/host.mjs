import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HostProfile } from '../domain/host-profile.mjs';
import { OfficialDaemon } from './daemon.mjs';
import { BrowserFiles } from './files.mjs';
import { LogonTask } from './logon-task.mjs';
import { ProfileInventory } from './profiles.mjs';
import { windowsChromeMajor } from './chrome-version.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Composition root for the machine this process runs on. `name` selects a
// named browser instance from hosts.json (undefined = the default instance
// every deployment already had). CHROME_CONTROL_INSTANCE picks the instance
// the long-running daemon process manages when no name is passed.
export function hostInstance(name, platform = process.platform, env = process.env) {
  const specs = JSON.parse(readFileSync(join(root, 'config/hosts.json'), 'utf8'));
  // launch.vbs passes the instance as an schtasks argument; cmd's `set X= real`
  // keeps the leading space, so trim before lookup.
  const instance = (name || env.CHROME_CONTROL_INSTANCE || '').trim();
  const profile = HostProfile.select(specs, { platform, home: homedir(), env }).instance(instance);
  const facts = profile.wants('chromeMajor') ? async () => ({ chromeMajor: await windowsChromeMajor(profile.executablePath) }) : undefined;
  const daemon = new OfficialDaemon(profile, root, facts);
  const starter = profile.starter.kind === 'logonTask' ? new LogonTask(profile.starter.name, daemon) : daemon;
  const discovered = profile.profiles;
  // Discovery is host-level data: every instance can read the registry, only
  // `discovered.browser` names the instance that actually serves those
  // profiles through its daemon.
  const profiles = discovered ? new ProfileInventory(discovered.userDataDir) : undefined;
  return { profile, daemon, starter, profiles, files: new BrowserFiles(profile.roots(root)) };
}

export function currentHost(platform = process.platform, env = process.env) {
  return hostInstance(undefined, platform, env);
}
