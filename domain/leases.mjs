import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

export class PageLeases {
  constructor(root, actor, lifetime = 900_000) {
    if (!/^[A-Za-z0-9_.:-]{1,100}$/.test(actor)) throw new Error('Invalid actor');
    this.root = root;
    this.actor = actor;
    this.lifetime = lifetime;
  }

  path(pageId) {
    if (!Number.isSafeInteger(pageId) || pageId < 0) throw new Error('Invalid pageId');
    return join(this.root, String(pageId));
  }

  async locked(pageId, action) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const guard = this.path(pageId) + '.lock';
    try { await mkdir(guard, { mode: 0o700 }); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error('Lease is being updated; retry explicitly');
      throw error;
    }
    try { return await action(); }
    finally { await rm(guard, { recursive: true }); }
  }

  async read(pageId) {
    try { return JSON.parse(await readFile(this.path(pageId), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  async save(pageId) {
    const lease = { actor: this.actor, pageId, expires: Date.now() + this.lifetime };
    await writeFile(this.path(pageId), JSON.stringify(lease), { mode: 0o600 });
    return lease;
  }

  async claim(pageId) {
    return this.locked(pageId, async () => {
      const owner = await this.read(pageId);
      if (owner && owner.actor !== this.actor && owner.expires > Date.now()) {
        throw new Error(`Page ${pageId} is leased by ${owner.actor}`);
      }
      return this.save(pageId);
    });
  }

  async require(pageId) {
    return this.locked(pageId, async () => {
      const owner = await this.read(pageId);
      if (!owner || owner.actor !== this.actor || owner.expires <= Date.now()) {
        throw new Error(`Claim page ${pageId} with browser_claim_page before using it`);
      }
      return this.save(pageId);
    });
  }

  async release(pageId) {
    return this.locked(pageId, async () => {
      const owner = await this.read(pageId);
      if (!owner || owner.actor !== this.actor) throw new Error('Lease owner mismatch');
      await rm(this.path(pageId));
      return { released: pageId };
    });
  }
}
