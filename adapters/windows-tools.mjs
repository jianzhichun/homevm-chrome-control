import { win32 } from 'node:path';

// Git-Bash ships namesakes such as whoami.exe; never use those for Windows APIs.
export function windowsTool(name) {
  if (process.platform !== 'win32') return name;
  const root = process.env.SystemRoot || process.env.SYSTEMROOT;
  if (!root) throw new Error('Windows SystemRoot is unavailable');
  return name === 'powershell.exe'
    ? win32.join(root, 'System32/WindowsPowerShell/v1.0', name)
    : win32.join(root, 'System32', name);
}
