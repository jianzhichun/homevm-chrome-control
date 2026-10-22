#!/usr/bin/env python3
"""Deploy source, preserve a rollback archive, and verify remote capabilities."""
import hashlib
import json
from pathlib import Path
import shlex
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
SSH = ['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8']


def remote(target, argv, stdin=None):
    return subprocess.run(SSH + [target['ssh'], shlex.join(argv)], input=stdin,
                          text=True, capture_output=True, check=True, timeout=120).stdout


def snapshot(target):
    script = '''import datetime,hashlib,json,pathlib,tarfile
root=pathlib.Path(__import__('sys').argv[1])
backup=root/'evidence/rollback'/datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
backup.mkdir(parents=True,mode=0o700)
with tarfile.open(backup/'source.tar.gz','w:gz') as archive:
 for name in ['adapters','application','domain','interfaces','config','bin','scripts','package.json','package-lock.json','apply.sh','README.md']:
  if (root/name).exists():archive.add(root/name,arcname=name,filter=lambda info:None if '__pycache__' in info.name else info)
lock=root/'package-lock.json'
print(json.dumps({'backup':str(backup/'source.tar.gz'),'lockHash':hashlib.sha256(lock.read_bytes()).hexdigest(),'installed':(root/'node_modules/chrome-devtools-mcp/package.json').exists()}))
'''
    return json.loads(remote(target, ['python3', '-I', '-', target['root']], script))


def install(target, before):
    lock_hash = hashlib.sha256((ROOT / 'package-lock.json').read_bytes()).hexdigest()
    if before['lockHash'] != lock_hash or not before['installed']:
        remote(target, ['env', 'PATH=/opt/homebrew/bin:/usr/bin:/bin', '/opt/homebrew/bin/npm', '--prefix', target['root'], 'ci', '--ignore-scripts', '--no-audit', '--no-fund'])
    remote(target, ['python3', '-I', target['root'] + '/scripts/install-mac-service.py'])


def verify(target):
    argv = [target['node'], target['root'] + '/interfaces/cli.mjs', 'deploy', 'capabilities']
    deployed = json.loads(remote(target, argv))
    local = json.loads(subprocess.run(['node', str(ROOT / 'interfaces/cli.mjs'), 'deploy', 'capabilities'],
                                     text=True, capture_output=True, check=True).stdout)
    if deployed != local:
        changed = sorted(name for name in set(local['files']) | set(deployed['files'])
                         if local['files'].get(name) != deployed['files'].get(name))
        raise RuntimeError('Deployment source mismatch: ' + ', '.join(changed))
    if 'account-routing-v1' not in deployed['capabilities']:
        raise RuntimeError('Remote does not expose account-routing-v1')
    return deployed


def main():
    target = json.loads((ROOT / 'config/targets.json').read_text())[sys.argv[1]]
    before = snapshot(target)
    excludes = ['node_modules', '.git', 'tests', 'evidence', 'logs', '__pycache__', '.pytest_cache']
    subprocess.run(['rsync', '-az', *['--exclude=' + name for name in excludes],
                    '-e', 'ssh -o BatchMode=yes -o ConnectTimeout=8',
                    str(ROOT) + '/', target['ssh'] + ':' + target['root'] + '/'], check=True)
    install(target, before)
    deployed = verify(target)
    print(json.dumps({'target': sys.argv[1], 'rollback': before['backup'],
                      'sourceDigest': deployed['sourceDigest'], 'verifiedFiles': len(deployed['files']),
                      'dependenciesReinstalled': before['lockHash'] != hashlib.sha256((ROOT / 'package-lock.json').read_bytes()).hexdigest() or not before['installed']}, indent=2))


if __name__ == '__main__':
    main()
