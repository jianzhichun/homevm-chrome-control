import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HostProfile } from '../domain/host-profile.mjs';
import { OfficialDaemon } from './daemon.mjs';
import { BrowserFiles } from './files.mjs';
import { LogonTask } from './logon-task.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Composition root for the machine this process runs on.
export function currentHost(platform = process.platform, env = process.env) {
  const specs = JSON.parse(readFileSync(join(root, 'config/hosts.json'), 'utf8'));
  const profile = HostProfile.select(specs, { platform, home: homedir(), env });
  const daemon = new OfficialDaemon(profile, root);
  const starter = profile.starter.kind === 'logonTask' ? new LogonTask(profile.starter.name, daemon) : daemon;
  return { profile, daemon, starter, files: new BrowserFiles(profile.roots(root)) };
}
