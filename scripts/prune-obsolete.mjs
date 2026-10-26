import { lstat, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Explicit source removals, never a recursive delete of a shared deployment.
for (const name of ['adapters/daemon.mjs', 'adapters/extension-daemon.mjs', 'interfaces/mcp.mjs',
  'scripts/export-tools.mjs', 'scripts/probe-mcp.mjs', 'scripts/probe-account-mcp.mjs']) {
  const path = fileURLToPath(new URL('../' + name, import.meta.url));
  const stat = await lstat(path).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!stat) continue;
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Obsolete source is not a regular file: ${name}`);
  await unlink(path);
  console.log(`Removed obsolete source: ${name}`);
}
