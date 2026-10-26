#!/usr/bin/env python3
"""One real, platform-independent browser CLI contract smoke against an owned fixture."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import uuid


class BrowserClient:
    def __init__(self, machine, actor, account=None):
        self.argv = [str(Path(__file__).resolve().parent.parent / 'bin/browserctl'), '--machine', machine, '--actor', actor]
        if account:
            self.argv += ['--account', account]
        self.account = account

    def invoke(self, command, *args, filename=None):
        argv = self.argv + (['--out', filename] if filename else []) + [command, *args]
        proc = subprocess.run(argv, capture_output=True, text=True, timeout=100)
        if proc.returncode:
            raise RuntimeError(proc.stderr.strip() or proc.stdout[:1000])
        value = json.loads(proc.stdout)
        if value.get('content'):
            text = value['content'][0].get('text', '')
            if '```json\n' in text:
                return json.loads(text.split('```json\n', 1)[1].rsplit('```', 1)[0])
            try:
                return json.loads(text)
            except ValueError:
                return text
        return value

    def call(self, name, **args):
        return self.invoke('call', name, json.dumps(args))

    def open(self, url):
        if self.account:
            return self.invoke('open', url)['pageId']
        known = {p['pageId'] for p in self.invoke('pages')['pages']}
        self.call('new_page', url=url)
        fresh = [p for p in self.invoke('pages')['pages'] if p['pageId'] not in known and p['url'] == url]
        if len(fresh) != 1:
            raise RuntimeError('Fixture page was not uniquely created')
        return fresh[0]['pageId']


def smoke(client, url, evidence_dir, label):
    page_id = client.open(url)
    def call(name, **args):
        return client.call(name, pageId=page_id, **args)
    try:
        call('browser_claim_page')
        snapshot = call('take_snapshot')
        fields = {}
        for name in ['Name', 'Confirmed', 'Choice', 'Apply']:
            match = re.search(r'uid=(\d+_\d+)[^\n]*"' + name + '"', snapshot)
            if not match:
                raise RuntimeError('Fixture element missing: ' + name)
            fields[name] = match[1]
        call('fill_form', elements=[{'uid': fields['Name'], 'value': label}, {'uid': fields['Confirmed'], 'value': 'true'}, {'uid': fields['Choice'], 'value': 'Two'}])
        call('click', uid=fields['Apply'])
        observed = call('evaluate_script', function='() => ({result:document.querySelector("output").textContent,checked:document.querySelector("input[type=checkbox]").checked,choice:document.querySelector("select").value})')
        if observed != {'result': 'done:' + label, 'checked': True, 'choice': 'Two'}:
            raise RuntimeError('Fixture interaction mismatch: ' + json.dumps(observed))
        screenshot = call('take_screenshot', filePath=evidence_dir.rstrip('/') + '/smoke-' + uuid.uuid4().hex[:10] + '.png', format='png')
        download = client.invoke('download', url + 'fixture.pdf', filename='browser-cli-smoke.pdf')
        if download['bytes'] != 329:
            raise RuntimeError('Fixture PDF length mismatch')
        return {'interaction': observed, 'screenshot': screenshot, 'download': {k: download[k] for k in ['path', 'bytes', 'sha256', 'via']}}
    finally:
        call('browser_claim_page')
        call('close_page')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--machine', required=True)
    parser.add_argument('--account')
    parser.add_argument('--url', required=True, help='Owned smoke fixture URL, never a business site')
    parser.add_argument('--evidence-dir', required=True, help='Existing allowed directory on the browser host')
    args = parser.parse_args()
    client = BrowserClient(args.machine, 'smoke-' + uuid.uuid4().hex[:12], args.account)
    print(json.dumps(smoke(client, args.url, args.evidence_dir, args.machine), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
