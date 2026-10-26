import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, lstat } from 'node:fs/promises';
import { windowsTool } from './windows-tools.mjs';

const run = promisify(execFile);
const quote = value => "'" + value.replaceAll("'", "''") + "'";

// POSIX permissions and Windows DACLs express the same owner-only contract.
export class PrivateFiles {
  async protect(path, directory = false) {
    if (process.platform !== 'win32') return chmod(path, directory ? 0o700 : 0o600);
    const { stdout } = await run(windowsTool('whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { windowsHide: true });
    const sid = stdout.match(/S-1-[\d-]+/)?.[0];
    if (!sid) throw new Error('Could not identify the Windows credential owner');
    await run(windowsTool('icacls.exe'), [path, '/inheritance:r', '/grant:r', `*${sid}:${directory ? '(OI)(CI)' : ''}F`], { windowsHide: true });
  }

  async require(path) {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Pairing file must be a regular private file');
    if (process.platform !== 'win32') {
      if (stat.mode & 0o077 || stat.uid !== process.getuid()) throw new Error('Pairing file must be owned by the user with mode 0600');
      return;
    }
    const script = `$acl=Get-Acl -LiteralPath ${quote(path)};$me=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;
      $bad=@($acl.Access|Where-Object{$_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @($me,'S-1-5-18','S-1-5-32-544')});
      if(-not $acl.AreAccessRulesProtected -or $bad.Count){exit 1}`;
    try { await run(windowsTool('powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true }); }
    catch { throw new Error('Pairing file must have an owner-only protected Windows ACL'); }
  }
}
