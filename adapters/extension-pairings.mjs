import { lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EXTENSION_ID, EXTENSION_STORE } from '../domain/extension.mjs';
import { scopeKey } from '../domain/browser-session.mjs';
import { PrivateFiles } from './private-files.mjs';

// Profile-specific credentials stay on the browser host, never in CLI arguments.
export class ExtensionPairings {
  constructor(directory, userDataDir) {
    Object.assign(this, { directory, userDataDir });
    this.security = new PrivateFiles();
  }

  path(profile) { return join(this.directory, `${scopeKey(profile)}.json`); }

  async installed(profile) {
    const directory = join(this.userDataDir, profile, 'Extensions', EXTENSION_ID);
    for (const version of await readdir(directory).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    })) {
      const manifest = JSON.parse(await readFile(join(directory, version, 'manifest.json'), 'utf8'));
      if (manifest.manifest_version === 3 && manifest.permissions?.includes('debugger')) return manifest.version;
    }
    return null;
  }

  async read(profile) {
    try { await this.security.require(this.path(profile)); }
    catch (error) {
      if (error.code === 'ENOENT') throw new Error(`Profile ${profile} is not paired; install ${EXTENSION_STORE}, then run browserctl --profile '${profile}' pair`);
      throw error;
    }
    const value = JSON.parse(await readFile(this.path(profile), 'utf8'));
    if (value.profile !== profile || value.extensionId !== EXTENSION_ID || !validToken(value.token)) throw new Error('Invalid Profile pairing; no other account was selected');
    return value;
  }

  async require(profile) {
    if (!await this.installed(profile)) throw new Error(`Official Playwright Extension is missing from Profile ${profile}; install ${EXTENSION_STORE}`);
    return this.read(profile);
  }

  async save(profile, token) {
    if (!validToken(token)) throw new Error('Invalid extension token');
    const version = await this.installed(profile);
    if (!version) throw new Error(`Install the official extension in Profile ${profile} before pairing`);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await this.security.protect(this.directory, true);
    const destination = this.path(profile);
    const old = await lstat(destination).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (old && (!old.isFile() || old.isSymbolicLink())) throw new Error('Refusing to replace a nonregular pairing file');
    const temporary = destination + '.' + randomUUID();
    await writeFile(temporary, JSON.stringify({ profile, extensionId: EXTENSION_ID, token, pairedAt: new Date().toISOString() }), { mode: 0o600, flag: 'wx' });
    await this.security.protect(temporary);
    await rename(temporary, destination);
    return { paired: true, profile, extensionId: EXTENSION_ID, version, credentialPath: destination };
  }
}

function validToken(token) { return typeof token === 'string' && /^[A-Za-z0-9._~-]{16,512}$/.test(token); }
