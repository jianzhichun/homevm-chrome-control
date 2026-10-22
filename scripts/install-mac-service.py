#!/usr/bin/env python3
"""Install a login bootstrap for the official persistent Chrome control daemon."""
from pathlib import Path
import plistlib
import subprocess
import os

root = Path.home() / 'workspace/chrome-control'
path = Path.home() / 'Library/LaunchAgents/cn.imbecile.chrome-control.plist'
path.parent.mkdir(parents=True, exist_ok=True)
log = root / 'logs'
log.mkdir(mode=0o700, exist_ok=True)
expected = {
    'Label': 'cn.imbecile.chrome-control',
    'ProgramArguments': ['/opt/homebrew/bin/node', str(root / 'interfaces/cli.mjs'), 'service', 'start'],
    'WorkingDirectory': str(root),
    'RunAtLoad': True,
    'EnvironmentVariables': {
        'PATH': '/opt/homebrew/bin:/usr/bin:/bin',
        'CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS': '1',
        'CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS': '1',
    },
    'StandardOutPath': str(log / 'startup.log'),
    'StandardErrorPath': str(log / 'startup-error.log'),
}
if path.exists():
    if plistlib.loads(path.read_bytes()) != expected:
        raise SystemExit('Existing launch agent differs; no overwrite performed')
else:
    path.write_bytes(plistlib.dumps(expected))
    path.chmod(0o600)
service = f'gui/{os.getuid()}/cn.imbecile.chrome-control'
if subprocess.run(['launchctl', 'print', service], capture_output=True).returncode:
    subprocess.run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(path)], check=True)
print(service)
