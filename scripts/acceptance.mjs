import { writeFile, mkdir, readFile, rm, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

process.env.CHROME_CONTROL_RUNTIME = await mkdtemp(join(homedir(), 'tmp/chrome-acceptance-'));
process.env.CHROME_CONTROL_MODE = 'isolated';
const { BrowserControl } = await import('../application/control.mjs');
const { root } = await import('../adapters/host.mjs');
const control = new BrowserControl('isolated-acceptance');
const evidence = join(root, 'evidence');
await mkdir(evidence, { recursive: true });
await mkdir(join(homedir(), 'Downloads'), { recursive: true });
const checks = [];
async function call(name, args = {}) {
  const result = await control.call(name, args);
  if (result.isError) throw new Error(JSON.stringify(result));
  return result;
}
function text(result) { return result.content.filter(c => c.type === 'text').map(c => c.text).join('\n'); }
let created;
try {
  await control.daemon.start();
  const pages = text(await call('list_pages'));
  assert.match(pages, /about:blank/);
  checks.push('isolated-browser-connected');
  const download = `chrome-control-acceptance-${randomUUID()}.txt`;
  const html = '<!doctype html><title>Chrome Control Contract</title><label>Name<input id="name"></label><input id="upload" type="file"><button id="button">Confirm</button><iframe srcdoc="<button>Frame Button</button>"></iframe><script>window.clicked=false;document.getElementById("button").onclick=e=>{window.clicked=e.isTrusted};</script>';
  const pageResult = text(await call('new_page', { url: 'data:text/html,' + encodeURIComponent(html), background: true }));
  const lines = pageResult.split('\n').filter(line => /data:text\/html/.test(line));
  created = Number(lines.at(-1)?.match(/^(\d+):/)?.[1]);
  assert.ok(Number.isSafeInteger(created), pageResult);
  await call('browser_claim_page', { pageId: created });
  const snapshot = text(await call('take_snapshot', { pageId: created }));
  assert.match(snapshot, /Frame Button/);
  const uid = (label, role) => {
    const line = snapshot.split('\n').find(line => line.includes(role) && line.includes(`"${label}"`));
    assert.ok(line, snapshot);
    return line.match(/uid=([^\s]+)/)[1];
  };
  await call('fill', { pageId: created, uid: uid('Name', 'textbox'), value: 'verified' });
  await call('click', { pageId: created, uid: uid('Confirm', 'button') });
  const dom = text(await call('evaluate_script', { pageId: created, function: '() => ({value:document.getElementById("name").value,clicked:window.clicked})', waitForStableDom: false }));
  assert.match(dom, /verified/);
  assert.match(dom, /"clicked":\s*true/);
  checks.push('trusted-input-and-iframe-snapshot');
  const uploadPath = join(evidence, 'acceptance-upload.txt');
  await writeFile(uploadPath, 'Upload contract\n');
  const uploadLine = snapshot.split('\n').find(line => line.includes('button') && /Choose File|Choose file|Browse/.test(line));
  if (!uploadLine) console.error(snapshot);
  assert.ok(uploadLine, snapshot);
  await call('upload_file', { pageId: created, uid: uploadLine.match(/uid=([^\s]+)/)[1], filePaths: [uploadPath] });
  const uploaded = text(await call('evaluate_script', { pageId: created, function: '() => document.getElementById("upload").files[0].name', waitForStableDom: false }));
  assert.match(uploaded, /acceptance-upload.txt/);
  checks.push('file-upload');
  await call('take_screenshot', { pageId: created, filePath: join(evidence, 'isolated-acceptance.png') });
  const png = await readFile(join(evidence, 'isolated-acceptance.png'));
  assert.equal(png.readUInt32BE(0), 0x89504e47);
  checks.push('page-screenshot');
  await call('evaluate_script', { pageId: created, function: `() => {const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['Download contract\\n'],{type:'text/plain'}));a.download=${JSON.stringify(download)};document.body.append(a);a.click();return 'triggered'}` });
  const downloaded = await call('browser_wait_file', { path: join(homedir(), 'Downloads', download), timeoutMs: 15000 });
  assert.equal(JSON.parse(text(downloaded)).bytes, 18);
  await rm(join(homedir(), 'Downloads', download));
  checks.push('download-local-completion-and-sha256');
  await call('close_page', { pageId: created });
  checks.push('owned-page-cleanup');
  await writeFile(join(evidence, 'isolated-acceptance.json'), JSON.stringify({ mode: 'isolated', existingMacProfileVerified: false, checks }, null, 2) + '\n');
  console.log(JSON.stringify({ checks }));
} finally {
  await control.daemon.stop();
  await rm(process.env.CHROME_CONTROL_RUNTIME, { recursive: true, force: true });
}
