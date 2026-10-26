import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile as exec } from 'node:child_process';
import { promisify } from 'node:util';
import { commandResult } from '../interfaces/commands.mjs';

const execFile = promisify(exec);
const cli = new URL('../bin/browserctl', import.meta.url).pathname;

test('root and command help work locally with no SSH on PATH or account required', async () => {
  const options = { env: { ...process.env, PATH: '' } };
  const root = await execFile('/usr/bin/python3', ['-I', cli, '--help'], options);
  const command = await execFile('/usr/bin/python3', ['-I', cli, 'open', '--help'], options);
  const named = await execFile('/usr/bin/python3', ['-I', cli, 'help', 'open'], options);
  assert.match(root.stdout, /--account/);
  assert.match(command.stdout, /open URL/);
  assert.equal(command.stdout, named.stdout);
});

test('local transport preserves account routing without an SSH hop', async () => {
  const targets = await execFile('/usr/bin/python3', ['-I', cli, 'targets']);
  assert.equal(JSON.parse(targets.stdout).local.transport, 'local');
  const script = `import argparse,json,runpy,sys
module=runpy.run_path(sys.argv[1])
args=argparse.Namespace(arguments='{}',command='status',account='cambridge',profile=None,tool=None,actor='local-probe')
target={'transport':'local','node':'/local/node','root':'/local/chrome-control'}
print(json.dumps(module['remote_command'](args,target)))`;
  const { stdout } = await execFile('/usr/bin/python3', ['-I', '-c', script, cli]);
  const command = JSON.parse(stdout);
  assert.deepEqual(command.slice(0, 5), ['/local/node', '/local/chrome-control/interfaces/cli.mjs', 'local-probe', 'scoped', 'status']);
  assert.deepEqual(JSON.parse(command[5]).selector, { account: 'cambridge' });
});

test('tools can return one exact schema without a skill or browser connection', async () => {
  const schema = { name: 'click', inputSchema: { required: ['pageId', 'uid'] } };
  const control = { tools: async () => [schema, { name: 'take_snapshot' }] };
  assert.deepEqual(await commandResult(control, 'tools', 'click', {}), schema);
  await assert.rejects(commandResult(control, 'tools', 'unknown', {}), /Unknown tool/);
});
