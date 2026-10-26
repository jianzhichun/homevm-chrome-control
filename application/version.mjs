import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export async function sourceManifest(root) {
  const files = ['package.json', 'package-lock.json', 'apply.sh'];
  for (const folder of ['adapters', 'application', 'domain', 'interfaces', 'config', 'bin', 'scripts']) {
    const visit = async path => {
      for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
        const name = `${path}/${entry.name}`;
        if (entry.name.startsWith('.') || entry.name === '__pycache__') continue;
        if (entry.isDirectory()) await visit(name);
        else if (entry.isFile()) files.push(name);
      }
    };
    await visit(folder);
  }
  const hashes = {};
  for (const name of files.sort()) hashes[name] = createHash('sha256').update(await readFile(join(root, name))).digest('hex');
  return hashes;
}

export async function capabilities(root) {
  const files = await sourceManifest(root);
  return { protocolVersion: 1, backend: 'playwright-cli', interface: 'cli',
    capabilities: ['account-routing-v1', 'managed-profile-tabs-v1', 'website-identity-v1', 'download-v1', 'shared-cli-session-v1', 'persistent-profile-pairing-v1'],
    sourceDigest: createHash('sha256').update(JSON.stringify(files)).digest('hex'), files };
}
