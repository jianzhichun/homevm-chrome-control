import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fromLocalState, urlsFromSnss } from '../domain/profiles.mjs';

// Reads the user-facing Chrome's profile registry and per-profile session
// files straight off the disk of the machine this process runs on. Works for
// macOS and Windows because Chrome's layout is the same on both.
export class ProfileInventory {
  constructor(userDataDir) { this.userDataDir = userDataDir; }

  async list() {
    return fromLocalState(await readFile(join(this.userDataDir, 'Local State'), 'utf8'));
  }

  // dir -> Set(normalized url) from each profile's session files. SNSS files
  // are rewritten as tabs change, so this stays current enough for
  // attributing the tabs that are open right now.
  async urlSets() {
    const sets = new Map();
    for (const dir of await readdir(this.userDataDir)) {
      if (!/^(Default|Profile \d+)$/.test(dir)) continue;
      const set = new Set();
      const profileDir = join(this.userDataDir, dir);
      const candidates = ['Last Session', 'Last Tabs'];
      for (const name of await readdir(join(profileDir, 'Sessions')).catch(() => [])) {
        candidates.push(join('Sessions', name));
      }
      for (const name of candidates) {
        try {
          const path = join(profileDir, name);
          const info = await stat(path);
          if (!info.isFile() || info.size > 64 * 1024 * 1024) continue;
          for (const url of urlsFromSnss(await readFile(path))) set.add(url);
        } catch { /* a missing or unreadable file just contributes nothing */ }
      }
      if (set.size) sets.set(dir, set);
    }
    return sets;
  }
}
