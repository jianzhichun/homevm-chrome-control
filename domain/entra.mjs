import { createHmac } from 'node:crypto';

// Pure pieces of the Cambridge (Raven/Entra) sign-in: credentials, TOTP,
// the Entra page vocabulary and the in-page expressions. No browser here.

// The owner's credentials file: shell-style KEY=VALUE, '#' comments.
export function parseCredentials(text) {
  const kv = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m) kv[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  const creds = { user: kv.CAM_USER, password: kv.CAM_PASS, totpSecret: kv.CAM_TOTP_SECRET };
  const missing = Object.entries({ CAM_USER: creds.user, CAM_PASS: creds.password, CAM_TOTP_SECRET: creds.totpSecret })
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`Credentials missing ${missing.join(', ')}`);
  return creds;
}

// RFC 6238: SHA1, 6 digits, 30 s step.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function totpCode(seed, when = Date.now() / 1000) {
  const packed = seed.replace(/\s+/g, '').toUpperCase().replace(/=+$/, '');
  let bits = 0, value = 0; const bytes = [];
  for (const ch of packed) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  const counter = Math.floor(when / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter % 2 ** 32, 4);
  const mac = createHmac('sha1', Buffer.from(bytes)).update(buf).digest();
  const off = mac[mac.length - 1] & 0x0f;
  return String((mac.readUInt32BE(off) & 0x7fffffff) % 1e6).padStart(6, '0');
}
export const secondsLeft = (now = Date.now() / 1000) => 30 - Math.floor(now % 30);

export const ENTRA = {
  user: 'input[name=loginfmt], #i0116',
  password: 'input[name=passwd], #i0118',
  code: 'input[name=otc], #idTxtBx_SAOTCC_OTC',
  submit: '#idSIButton9, #idSubmit_SAOTCC_Continue, input[type=submit]',
  kmsi: '#KmsiCheckboxField',
  push: '#idDiv_SAOTCAS_Title, #idRichContext_DisplaySign, [data-bind*=SAOTCAS]',
  anotherWay: '#signInAnotherWay',
  otpMethod: '[data-value="PhoneAppOTP"]',
};

// Landed: back on the proxied entry host, off every login page.
export function signedIn(url, entry) {
  const low = String(url || '').toLowerCase();
  if (low.includes('microsoftonline.com') || low.includes('/login?')) return false;
  return low.startsWith(new URL(entry).origin.toLowerCase());
}

// "选择登录方法" / "Choose a way to sign in": Entra's method list.
export const isMethodList = text => /选择登录方法|choose a way to sign in/i.test(String(text || ''));

const q = JSON.stringify;
export const JS = {
  probe: `() => ({ url: location.href, title: document.title, ready: document.readyState })`,
  text: `() => (document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 400)`,
  seen: sel => `() => { try { return !!document.querySelector(${q(sel)}); } catch { return false; } }`,
  // Entra keeps hidden inputs for every step; only a VISIBLE field is the
  // step on offer.
  visible: sel => `() => { try { const f = document.querySelector(${q(sel)}); return !!f && f.offsetParent !== null; } catch { return false; } }`,
  value: sel => `() => { const f = document.querySelector(${q(sel)}); return f ? (f.value || '') : null; }`,
  // A passkey-registered account is routed to WebAuthn (bridge/fido) when
  // the browser offers a platform authenticator; without one Entra walks
  // password -> push -> code.
  noFido: `() => { try { window.PublicKeyCredential = undefined; } catch { return 'denied'; } return 'hidden'; }`,
  fill: (sel, text) => `() => {
    const f = document.querySelector(${q(sel)});
    if (!f) return 'nofield';
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(f, ${q(text)});
    f.dispatchEvent(new Event('input', { bubbles: true }));
    f.dispatchEvent(new Event('change', { bubbles: true }));
    return 'filled';
  }`,
  click: sel => `() => { const b = document.querySelector(${q(sel)}); if (!b) return 'nobutton'; b.click(); return 'clicked'; }`,
  clickText: text => `() => {
    const els = [...document.querySelectorAll('div[role=button],button,li,a,[data-value],div[role=listitem],div[tabindex]')];
    const el = els.find(e => e.offsetParent !== null && (e.textContent || '').trim().split('\\n')[0].startsWith(${q(text)}));
    if (!el) return 'absent';
    el.click(); return 'clicked';
  }`,
  pickAccount: upn => `() => {
    const want = ${q(String(upn).toLowerCase())};
    for (const t of document.querySelectorAll('#loginList li, [data-test-id], .table li, div[role=option]')) {
      if ((t.textContent || '').toLowerCase().includes(want)) { t.click(); return 'picked'; }
    }
    return 'absent';
  }`,
};
