import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HostProfile } from '../domain/host-profile.mjs';
import { PlaywrightSession } from './playwright-session.mjs';
import { BrowserFiles } from './files.mjs';
import { LogonTask } from './logon-task.mjs';
import { ProfileInventory } from './profiles.mjs';
import { AccountAliases } from './accounts.mjs';
import { PageBindings } from './bindings.mjs';
import { windowsChromeMajor } from './chrome-version.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Composition root for the machine this process runs on. `name` selects a
// named browser instance from hosts.json (undefined = the default instance
// every deployment already had). CHROME_CONTROL_INSTANCE picks the instance
// the long-running daemon process manages when no name is passed.
export function hostInstance(name, platform = process.platform, env = process.env, actor = 'operator', accountProfile) {
  const specs = JSON.parse(readFileSync(join(root, 'config/hosts.json'), 'utf8'));
  // launch.vbs passes the instance as an schtasks argument; cmd's `set X= real`
  // keeps the leading space, so trim before lookup.
  const instance = (name || env.CHROME_CONTROL_INSTANCE || '').trim();
  const profile = HostProfile.select(specs, { platform, home: homedir(), env }).instance(instance);
  const facts = profile.wants('chromeMajor') ? async () => ({ chromeMajor: await windowsChromeMajor(profile.executablePath) }) : undefined;
  const files = new BrowserFiles(profile.roots(root));
  const daemon = new PlaywrightSession(profile, root, actor, accountProfile, files, facts);
  const starter = profile.starter.kind === 'logonTask' ? new LogonTask(profile.starter.name, daemon) : daemon;
  const discovered = profile.profiles;
  // Discovery is host-level data: every instance can read the registry, only
  // `discovered.browser` names the instance that actually serves those
  // profiles through its daemon.
  const profiles = discovered ? new ProfileInventory(discovered.userDataDir) : undefined;
  const aliases = new AccountAliases(join(homedir(), '.config', 'chrome-control', 'accounts.json'));
  const bindings = new PageBindings(join(profile.runtime, 'account-bindings'));
  return { profile, daemon, starter, profiles, aliases, bindings, files,
    forActor: value => hostInstance(instance, platform, env, value, accountProfile),
    forAccount: (value, owner) => hostInstance(discovered?.browser === 'default' ? undefined : discovered?.browser, platform, env, owner, value),
  };
}

export function currentHost(platform = process.platform, env = process.env) {
  return hostInstance(undefined, platform, env);
}
