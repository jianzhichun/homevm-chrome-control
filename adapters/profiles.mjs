import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fromLocalState } from '../domain/profiles.mjs';

export class ProfileInventory {
  constructor(userDataDir) { this.userDataDir = userDataDir; }

  async list() {
    return fromLocalState(await readFile(join(this.userDataDir, 'Local State'), 'utf8'));
  }
}
