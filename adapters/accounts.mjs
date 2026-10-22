import { readFile } from 'node:fs/promises';

export class AccountAliases {
  constructor(path) { this.path = path; }

  async read() {
    try { return JSON.parse(await readFile(this.path, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  }
}
