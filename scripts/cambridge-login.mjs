// Cambridge (Raven/Entra) sign-in for the owner's real Chrome, driven over
// the official chrome-devtools-mcp daemon in autoConnect mode.
//
// Runs ON the browser machine (zengxiaoxiwin01). One-shot: boot daemon
// session cc002, wait for the native Allow dialog to be approved, find the
// tab parked on the Entra error page, navigate it to the library-proxied
// ScienceDirect, walk the Entra pages (username -> password -> TOTP ->
// stay-signed-in), and report the landing state as JSON evidence.
//
// Safety rules inherited from research/deploy/.../institution_login:
//   - every credential is submitted AT MOST ONCE; a repeat of the same field
//     means rejection, and we stop rather than risk locking the account;
//   - a push prompt is switched to the verification-code method by name
//     (PhoneAppOTP) because this tenant defaults to push;
//   - "stay signed in" gets checked so ESTSAUTHPERSISTENT survives.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHmac } from 'node:crypto';

const ROOT = 'C:/Users/PC/workspace/chrome-control';
const RUNTIME = 'C:/Users/PC/AppData/Local/chrome-control/runtime-real';
const SESSION = 'cc002';
const ENTRY = 'https://www-sciencedirect-com.ezp.lib.cam.ac.uk/';
const TENANT = '49a50445-bdfa-4b79-ade3-547b4f3986e9';

const user = process.env.CAM_USER;
const password = process.env.CAM_PASS;
const secret = process.env.CAM_TOTP_SECRET;
if (!user || !password || !secret) {
  console.error(JSON.stringify({ error: 'CAM_USER/CAM_PASS/CAM_TOTP_SECRET must be set' }));
  process.exit(1);
}

process.env.XDG_RUNTIME_DIR = RUNTIME;
process.env.CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS = '1';
process.env.CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS = '1';
const base = pathToFileURL(join(ROOT, 'node_modules/chrome-devtools-mcp/build/src')).href;
const { startDaemon, sendCommand } = await import(base + '/daemon/client.js');
const { isDaemonRunning } = await import(base + '/daemon/utils.js');
const { PageLeases } = await import(pathToFileURL(join(ROOT, 'domain/leases.mjs')).href);

const steps = [];
const log = (msg, extra) => {
  steps.push(extra === undefined ? msg : { [msg]: extra });
  console.error('[cambridge-login]', msg, extra === undefined ? '' : JSON.stringify(extra).slice(0, 300));
};

// --- TOTP (RFC 6238, SHA1, 6 digits, 30s step; matches research totp.py) ---
const b32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function totpCode(seed, when = Date.now() / 1000) {
  const packed = seed.replace(/\s+/g, '').toUpperCase().replace(/=+$/, '');
  let bits = 0, value = 0; const bytes = [];
  for (const ch of packed) {
    value = (value << 5) | b32.indexOf(ch); bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  const counter = Math.floor(when / 30);
  const buf = Buffer.alloc(8); buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter % 2 ** 32, 4);
  const mac = createHmac('sha1', Buffer.from(bytes)).update(buf).digest();
  const off = mac[mac.length - 1] & 0x0f;
  const code = mac.readUInt32BE(off) & 0x7fffffff;
  return String(code % 1e6).padStart(6, '0');
}
function secondsLeft(now = Date.now() / 1000) { return 30 - Math.floor(now % 30); }

// --- daemon + tool helpers ---
async function call(name, args, timeout = 30_000) {
  const r = await sendCommand({ method: 'invoke_tool', tool: name, args }, SESSION, timeout);
  if (!r.success) throw new Error(`${name}: ${r.error}`);
  return JSON.parse(r.result);
}
// MCP tool results wrap the payload: "Script ran on page and returned:
// ```json\n<value>\n```". Extract the block; surface upstream errors.
function payload(r) {
  const text = r.content?.find(c => c.type === 'text')?.text ?? '';
  if (text.startsWith('Error:')) throw new Error(text.slice(0, 200));
  const m = text.match(/```json\n([\s\S]*?)\n```/);
  const raw = m ? m[1] : text;
  try { return JSON.parse(raw); } catch { return raw; }
}

const JS = {
  probe: `() => ({ url: location.href, title: document.title, ready: document.readyState })`,
  seen: sel => `() => { try { return !!document.querySelector(${JSON.stringify(sel)}); } catch { return false; } }`,
  // Entra keeps hidden inputs for every step in the DOM; only a VISIBLE
  // field is the step being offered (a submit against a hidden field is
  // what produced "请输入有效的电子邮件地址" on the first walk).
  // Entra routes a passkey-capable browser straight into WebAuthn
  // (bridge/fido), which has no cancel and no code path. The measured
  // password -> push -> code walk happens when the browser reports no
  // platform authenticator, so take PublicKeyCredential off the table
  // before submitting the username.
  noFido: `() => {
    try { window.PublicKeyCredential = undefined; } catch { return 'denied'; }
    return 'hidden';
  }`,
  visible: sel => `() => {
    try {
      const f = document.querySelector(${JSON.stringify(sel)});
      return !!f && f.offsetParent !== null;
    } catch { return false; }
  }`,
  value: sel => `() => { const f = document.querySelector(${JSON.stringify(sel)}); return f ? (f.value || '') : null; }`,
  fill: (sel, text) => `() => {
    const f = document.querySelector(${JSON.stringify(sel)});
    if (!f) return 'nofield';
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(f, ${JSON.stringify(text)});
    f.dispatchEvent(new Event('input', { bubbles: true }));
    f.dispatchEvent(new Event('change', { bubbles: true }));
    return 'filled';
  }`,
  click: sel => `() => {
    const b = document.querySelector(${JSON.stringify(sel)});
    if (!b) return 'nobutton';
    b.click(); return 'clicked';
  }`,
  // Click a visible element by its text (the method list has no stable ids).
  clickText: text => `() => {
    const want = ${JSON.stringify(text)};
    const els = [...document.querySelectorAll('div[role=button],button,li,a,[data-value],div[role=listitem],div[tabindex]')];
    const el = els.find(e => e.offsetParent !== null && (e.textContent || '').trim().split('\\n')[0].startsWith(want));
    if (!el) return 'absent';
    el.click();
    return 'clicked';
  }`,
  pickAccount: `() => {
    const upn = ${JSON.stringify(user.toLowerCase())};
    const tiles = document.querySelectorAll('#loginList li, [data-test-id], .table li, div[role=option]');
    for (const t of tiles) {
      if ((t.textContent || '').toLowerCase().includes(upn)) { t.click(); return 'picked'; }
    }
    return document.body && document.body.innerText.toLowerCase().includes(upn) ? 'visible-not-clicked' : 'absent';
  }`,
};

async function seen(pageId, sel) { return payload(await call('evaluate_script', { pageId, function: JS.seen(sel) })) === true; }
async function visible(pageId, sel) { return payload(await call('evaluate_script', { pageId, function: JS.visible(sel) })) === true; }
async function value(pageId, sel) { return payload(await call('evaluate_script', { pageId, function: JS.value(sel) })); }
async function jsFill(pageId, sel, text) { return payload(await call('evaluate_script', { pageId, function: JS.fill(sel, text) })); }
async function jsClick(pageId, sel) { return payload(await call('evaluate_script', { pageId, function: JS.click(sel) })); }
async function probe(pageId) { return payload(await call('evaluate_script', { pageId, function: JS.probe })); }
async function settle(pageId, budgetS = 60) {
  const end = Date.now() + budgetS * 1000;
  while (Date.now() < end) {
    const p = await probe(pageId).catch(() => undefined);
    if (p && p.ready === 'complete' && p.title) return p;
    await new Promise(r => setTimeout(r, 1500));
  }
  return probe(pageId).catch(() => ({ url: '?', title: '?' }));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// "选择登录方法" page: Entra's fallback list after WebAuthn was cancelled.
function documentMethodList(p) {
  return typeof p === 'string' && p.includes('选择登录方法');
}

const ENTRA = {
  user: 'input[name=loginfmt], #i0116',
  password: 'input[name=passwd], #i0118',
  code: 'input[name=otc], #idTxtBx_SAOTCC_OTC',
  submit: '#idSIButton9, #idSubmit_SAOTCC_Continue, input[type=submit]',
  kmsi: '#KmsiCheckboxField',
  push: '#idDiv_SAOTCAS_Title, #idRichContext_DisplaySign, [data-bind*=SAOTCAS]',
  anotherWay: '#signInAnotherWay',
  // The passkey (bridge/fido) page hides the other methods behind "...".
  moreOptions: '#moreOptions',
  otpMethod: '[data-value="PhoneAppOTP"]',
};

function signedIn(p) {
  const low = (p?.url || '').toLowerCase();
  if (low.includes('microsoftonline.com') || low.includes('/login?')) return false;
  return low.includes('www-sciencedirect-com.ezp.lib.cam.ac.uk');
}

// --- 1. daemon up, wait for the Allow approval ---
if (!isDaemonRunning(SESSION)) {
  await startDaemon(['--autoConnect'], SESSION);
  log('daemon started');
}
let pages;
for (let i = 1; i <= 60; i++) {
  try { pages = await call('list_pages', {}, 25_000); break; }
  catch { log(`waiting for Allow approval (attempt ${i})`); await sleep(3000); }
}
if (!pages) { console.log(JSON.stringify({ ok: false, steps, error: 'list_pages never succeeded (Allow not approved?)' })); process.exit(1); }

const list = pages.content?.find(c => c.type === 'text')?.text || '';
const pageLines = [...list.matchAll(/^(\d+): (.*)$/gm)].map(m => ({ pageId: Number(m[1]), label: m[2] }));
log('pages', pageLines);

// --- 2. target tab: the Entra error page (or any proxied/leftover auth tab) ---
const candidates = pageLines.filter(l =>
  l.label.includes('login.microsoftonline.com') ||
  l.label.includes('ezp.lib.cam.ac.uk') ||
  l.label.includes('sciencedirect.com'));
if (!candidates.length) { console.log(JSON.stringify({ ok: false, steps, error: 'no Entra/proxied tab found', pages: pageLines })); process.exit(1); }
const pageId = candidates[0].pageId;
log('target page', { pageId, label: candidates[0].label.slice(0, 120) });
// The tab is parked on a stale Entra error page; restart the flow at the
// library proxy. If the session were already live this lands straight on
// ScienceDirect and the walk below short-circuits.
await call('navigate_page', { pageId, type: 'url', url: ENTRY }, 60_000);
log('navigated to entry');
const status = JSON.parse((await sendCommand({ method: 'status' }, SESSION, 5_000)).result);
const leases = new PageLeases(join(RUNTIME, 'leases', String(status.pid)), 'cambridge-login');
await leases.claim(pageId);
log('claimed page', pageId);

// --- 3. walk ---
let landed = null;
// Across rounds: a field seen twice means what we sent was rejected.
const once = {};
for (let round = 0; round < 12; round++) {
  const p = await settle(pageId);
  p.text = typeof p === 'object' ? payload(await call('evaluate_script', { pageId, function: '() => (document.body.innerText || \'\').replace(/\\s+/g, \' \').slice(0, 400)' })) : '';
  log('round', { round, url: (p.url || '').slice(0, 100), title: (p.title || '').slice(0, 60) });
  if (signedIn(p)) { landed = p; break; }
  const submitOnce = async () => { await jsClick(pageId, ENTRA.submit); await sleep(6000); };

  if (await visible(pageId, ENTRA.code)) {
    if (once.code) { log('code=rejected'); break; }
    once.code = true;
    let code = totpCode(secret);
    if (secondsLeft() < 5) { log('waiting for a fresh TOTP window'); await sleep(5500); code = totpCode(secret); }
    log('fill code', await jsFill(pageId, ENTRA.code, code));
    await submitOnce(); continue;
  }
  if ((p.url || '').includes('/bridge/fido')) {
    // The server routes a passkey-registered account straight to WebAuthn;
    // the native dialog cannot be scripted, so cancel it (real 上一步 click,
    // then an operator dismisses the Windows Security prompt if it stays).
    if (!once.fido) {
      once.fido = true;
      log('passkey page; trying the page Back button');
      try {
        const snap = payload(await call('take_snapshot', { pageId }));
        const text = typeof snap === 'string' ? snap : JSON.stringify(snap);
        const uid = (text.match(/uid=(\S+)\s+button\s+"上一步"/) || [])[1];
        if (uid) log('back-button', await payload(await call('click', { pageId, uid })));
        else log('back-button=absent');
      } catch (e) { log('snapshot-failed', String(e.message).slice(0, 120)); }
    } else if (!once.fidoWaited) {
      once.fidoWaited = true;
      log('waiting for the WebAuthn prompt to be cancelled on the desktop');
    }
    await sleep(6000);
    const now = await probe(pageId);
    if ((now.url || '').includes('/bridge/fido')) {
      if (Date.now() > (once.fidoDeadline ||= Date.now() + 120_000)) {
        log('fido=never-cancelled');
        break;
      }
      continue;
    }
    once.fidoDeadline = 0;
    continue;
  }
  if ((documentMethodList(p.text)) && !once.method) {
    once.method = true;
    log('method list; choosing password');
    log('choose-password', await payload(await call('evaluate_script', { pageId, function: JS.clickText('使用我的密码') })));
    await sleep(4000);
    continue;
  }
  if (await visible(pageId, ENTRA.push) || await seen(pageId, ENTRA.otpMethod)) {
    if (once.switch) { log('switch=twice'); break; }
    once.switch = true;
    log('push prompt; switching to code method');
    if (!(await seen(pageId, ENTRA.otpMethod))) {
      log('another-way', await jsClick(pageId, ENTRA.anotherWay));
      await sleep(4000);
      let ok = false;
      for (let t = 0; t < 15 && !ok; t++) { ok = await visible(pageId, ENTRA.otpMethod) || await seen(pageId, ENTRA.otpMethod); if (!ok) await sleep(2000); }
      if (!ok) { log('method list never rendered'); break; }
    }
    log('method', await jsClick(pageId, ENTRA.otpMethod));
    await sleep(5000);
    continue;
  }
  const userVal = await value(pageId, ENTRA.user);
  if (await visible(pageId, ENTRA.user) && !userVal) {
    if (once.user) { log('username=rejected'); break; }
    once.user = true;
    log('fill username', await jsFill(pageId, ENTRA.user, user));
    log('noFido', await payload(await call('evaluate_script', { pageId, function: JS.noFido })));
    await submitOnce(); continue;
  }
  if (await visible(pageId, ENTRA.password)) {
    if (once.password) { log('password=rejected'); break; }
    once.password = true;
    log('fill password', await jsFill(pageId, ENTRA.password, password));
    await submitOnce(); continue;
  }
  // Account picker: no fields, but a tile naming our UPN.
  const picked = payload(await call('evaluate_script', { pageId, function: JS.pickAccount }));
  if (picked === 'picked') { log('account=picked'); await sleep(6000); continue; }
  if (await seen(pageId, ENTRA.kmsi)) {
    log('kmsi', await jsClick(pageId, ENTRA.kmsi));
    await submitOnce(); continue;
  }
  log('stuck', { url: (p.url || '').slice(0, 90), title: (p.title || '').slice(0, 50) });
  break;
}

if (!landed) {
  const p = await probe(pageId).catch(() => ({ url: '?', title: '?' }));
  if (signedIn(p)) landed = p;
}

// --- 4. evidence ---
const final = landed || await probe(pageId).catch(() => ({ url: '?', title: '?' }));
await leases.release(pageId).catch(() => {});
const evidenceDir = join(ROOT, 'evidence', 'windows', 'real-chrome');
mkdirSync(evidenceDir, { recursive: true });
const out = {
  when: new Date().toISOString(),
  tenant: TENANT,
  entry: ENTRY,
  ok: signedIn(final),
  finalUrl: final.url,
  finalTitle: final.title,
  steps,
};
writeFileSync(join(evidenceDir, 'cambridge-login.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ok: out.ok, url: final.url, title: final.title, rounds: steps.length }));
