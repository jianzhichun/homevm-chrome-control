import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Major version of the installed chrome.exe, read from the binary's version
// resource so a Chrome update is followed at the next daemon start. The path
// travels inside -EncodedCommand, so no command-line quoting is involved.
export async function windowsChromeMajor(executablePath, exec = run) {
  const script = `(Get-Item -LiteralPath '${executablePath.replace(/'/g, "''")}').VersionInfo.ProductMajorPart`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, timeout: 30_000 });
  const major = stdout.trim();
  if (!/^\d{2,4}$/.test(major)) throw new Error(`Could not read the Chrome version from ${executablePath}: ${JSON.stringify(stdout)}`);
  return Number(major);
}
