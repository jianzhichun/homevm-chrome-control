import { stat, realpath, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, sep, dirname, basename } from 'node:path';
import { setTimeout } from 'node:timers/promises';

export class BrowserFiles {
  constructor(roots) { this.roots = roots.map(p => resolve(p)); }

  async path(value) {
    const path = await realpath(value);
    if (!this.roots.some(root => path === root || path.startsWith(root + sep))) {
      throw new Error('File path is outside configured browser workspace roots');
    }
    return path;
  }

  async describe(path) {
    const before = await stat(path);
    if (!before.isFile() || !before.size || /\.(crdownload|part|tmp)$/.test(path)) throw new Error('File is empty, partial or not regular');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    const after = await stat(path);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('File changed during verification');
    return { path, bytes: after.size, modified: after.mtime.toISOString(), sha256: hash.digest('hex') };
  }

  async inventory(directory) {
    const dir = await this.path(directory);
    const files = [];
    for (const name of await readdir(dir)) {
      const path = await this.path(resolve(dir, name));
      const details = await stat(path);
      if (details.isFile()) files.push({ name, bytes: details.size, partial: /\.(crdownload|part|tmp)$/.test(name) });
    }
    return { directory: dir, files };
  }

  async wait(path, timeout = 15_000) {
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 25_000) throw new Error('timeoutMs must be 1..25000');
    const parent = await this.path(dirname(resolve(path)));
    path = resolve(parent, basename(path));
    const deadline = Date.now() + timeout;
    let previous;
    while (Date.now() < deadline) {
      try {
        const verified = await this.path(path);
        const current = await stat(verified);
        let partial = false;
        try { await stat(verified + '.crdownload'); partial = true; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (!partial && current.isFile() && current.size > 0 && previous?.size === current.size && previous?.mtimeMs === current.mtimeMs) {
          return { evidence: 'filesystem-stability-not-browser-event', ...await this.describe(verified) };
        }
        previous = current;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await setTimeout(500);
    }
    throw new Error('File completion not verified before timeout');
  }
}
