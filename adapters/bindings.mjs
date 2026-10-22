import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export function daemonGeneration(status) {
  if (!status.running || !Number.isSafeInteger(status.pid)) throw new Error('No live daemon for account bindings');
  return createHash('sha256').update(`${status.pid}:${status.startDate || ''}`).digest('hex').slice(0, 24);
}

export class PageBindings {
  constructor(root) { this.root = root; }

  path(generation, pageId) {
    if (!/^[a-f0-9]{24}$/.test(generation) || !Number.isSafeInteger(pageId) || pageId < 0) throw new Error('Invalid binding key');
    return join(this.root, generation, `${pageId}.json`);
  }

  async get(generation, pageId) {
    try { return JSON.parse(await readFile(this.path(generation, pageId), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  async save(generation, binding) {
    const path = this.path(generation, binding.pageId);
    await mkdir(join(path, '..'), { recursive: true, mode: 0o700 });
    const temp = `${path}.${randomUUID()}`;
    await writeFile(temp, JSON.stringify(binding), { mode: 0o600 });
    await rename(temp, path);
  }

  async remove(generation, pageId) { await rm(this.path(generation, pageId), { force: true }); }
  async invalidate(generation) { await rm(join(this.root, generation), { recursive: true, force: true }); }
}
