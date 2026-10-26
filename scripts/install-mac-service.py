#!/usr/bin/env python3
"""Remove the retired login bootstrap; paired browsers connect on demand via CLI."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import plistlib
import subprocess
import uuid

root = Path(__file__).resolve().parent.parent
path = Path.home() / 'Library/LaunchAgents/cn.imbecile.chrome-control.plist'
service = f'gui/{os.getuid()}/cn.imbecile.chrome-control'
backup = None
if path.exists():
    previous = path.read_bytes()
    definition = plistlib.loads(previous)
    if definition.get('Label') != 'cn.imbecile.chrome-control' or str(root / 'interfaces/cli.mjs') not in definition.get('ProgramArguments', []):
        raise SystemExit('Existing launch agent is not this deployment; no change performed')
    directory = root / 'evidence/retired-bootstrap' / (datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-') + uuid.uuid4().hex[:8])
    directory.mkdir(parents=True, mode=0o700)
    backup = directory / path.name
    backup.write_bytes(previous)
    backup.chmod(0o600)
    if not subprocess.run(['launchctl', 'print', service], capture_output=True).returncode:
        subprocess.run(['launchctl', 'bootout', service], check=True)
    path.unlink()
print(json.dumps({'startup': 'on-demand-paired-cli', 'retiredBootstrapBackup': str(backup) if backup else None}))
