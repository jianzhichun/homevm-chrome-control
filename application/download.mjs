import { join } from 'node:path';
import { openInProfile } from '../adapters/opener.mjs';
import { newFiles, selectCandidate, safeFilename, b64StashExpr, b64SliceExpr, pdfMagicCheck } from '../domain/download.mjs';
import { parsePageLines } from './control.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

const SLICE = 1_500_000;

// The download leg, run on the browser machine: open the URL in the chosen
// profile of the running Chrome (the OS forwards into the existing browser,
// so the profile's cookies ride along), wait for Chrome to finish writing
// the file, collect it under the requested name in staging, and return the
// filesystem evidence plus best-effort HTTP facts.
//
// v0 scope: identity-bearing instances only — the dedicated headless browser
// has no Cambridge session, and its downloads are not part of this leg.
export async function downloadArtifact(control, args) {
  const errors = [];
  let sessionTabError = null;
  const filename = safeFilename(args.filename);
  const timeoutMs = Math.min(Math.max(args.timeoutMs || 120_000, 15_000), 480_000);
  const serving = control.host.profile.profiles;
  const host = args.profile ? control.hostFor(args.profile)
    : serving ? control.hostFactory(serving.browser) : control.host;
  const profileDir = args.profile || serving?.browser;
  if (host.profile.mode === 'dedicated') {
    throw new Error('The dedicated headless instance carries no Cambridge session; pass --profile <Chrome profile dir>');
  }
  const files = host.files;
  const watchDir = host.profile.stagingWatch;

  // The Cambridge session lives in a PROFILE of the running Chrome, shared
  // by that profile's tabs through cookies. The primary route drives the
  // EXISTING session tab (same ezproxy host): navigate it to the URL, then
  // pull the bytes through the page itself - no new tab, no opener, and the
  // tab is restored to where it was.
  try {
    const donor = await sessionDonor(control, url);
    if (donor) {
      const extracted = await extractViaPageId(control, donor.pageId, url);
      const staged = await files.writeBuffer(join(host.profile.staging, filename), extracted.buffer);
      const described = await files.describe(staged);
      if (donor.originalUrl) {
        await control.daemon.call('navigate_page',
          { pageId: donor.pageId, type: 'url', url: donor.originalUrl }, 90_000).catch(() => {});
      }
      return {
        path: staged,
        bytes: described.bytes,
        sha256: described.sha256,
        finalUrl: extracted.finalUrl || url,
        httpStatus: extracted.httpStatus ?? null,
        profile: profileDir,
        originalName: filename,
        via: 'session-tab',
        identity: args.identity || `Chrome profile ${profileDir} session`,
      };
    }
  } catch (error) {
    sessionTabError = String(error.message || error).slice(0, 200);
  }

  if (!host.opener) throw new Error(`No opener configured for this instance (${profileDir})`);
  const before = (await files.inventory(watchDir)).files.map(f => f.name);
  await openInProfile(host.opener, profileDir, args.url);

  const deadline = Date.now() + timeoutMs;
  let chosen;
  let lastNames = [];
  while (Date.now() < deadline) {
    await sleep(1500);
    const after = (await files.inventory(watchDir)).files;
    lastNames = after.map(f => f.name);
    const fresh = newFiles(before, after);
    const pick = selectCandidate(fresh);
    if (pick.kind === 'ambiguous') {
      throw new Error(`Several new downloads at once, refusing to guess: ${pick.files.map(f => f.name).join(', ')}`);
    }
    if (!pick.file) continue;
    // Stability check (no .crdownload, stable size + hash) before touching it.
    chosen = await files.wait(join(watchDir, pick.file.name), Math.max(1, Math.min(25_000, deadline - Date.now())));
    break;
  }
  let staged;
  let originalName;
  let via = 'chrome-download';
  if (!chosen) {
    // Publishers that render the PDF inline (Chrome's viewer, no file on
    // disk) or gate it behind a bot challenge: pull the bytes through the
    // page itself. The %PDF- magic is checked before anything is written,
    // so a challenge HTML can never pass as the artifact.
    const extracted = await extractViaPage(control, host, args.url, timeoutMs);
    staged = await files.writeBuffer(join(host.profile.staging, filename), extracted.buffer);
    originalName = filename;
    via = extracted.via;
  } else {
    staged = await files.move(chosen.path, join(host.profile.staging, filename));
    originalName = chosen.path.split(/[\\/]/).pop();
  }
  const described = await files.describe(staged);
  const http = await httpFacts(control, host, args.url).catch(() => ({}));
  return {
    path: staged,
    bytes: described.bytes,
    sha256: described.sha256,
    finalUrl: http.finalUrl || args.url,
    httpStatus: http.status ?? null,
    profile: profileDir,
    originalName,
    via,
    identity: args.identity || `Chrome profile ${profileDir} session`,
  };
}


// The Cambridge-session tab: any page on an ezp.lib.cam.ac.uk host (the
// session is cookie-based per profile and shared across that profile's
// tabs). Prefers a page already on the publisher family.
export async function sessionDonor(control, url) {
  const pages = parsePageLines(await control.daemon.call('list_pages'));
  const donors = pages.filter(p => (p.url || '').includes('.ezp.lib.cam.ac.uk'));
  if (!donors.length) return null;
  return { pageId: donors[0].pageId, originalUrl: donors[0].url };
}

// Inline extraction on a GIVEN pageId: navigate is the caller's job; here we
// fetch the URL same-origin with credentials, check the %PDF- magic, stash
// base64 in the page, slice it home, and assemble. The page must be on the
// same origin as the URL (the ezproxy host) for the fetch to carry cookies.
export async function extractViaPageId(control, pageId, url) {
  const ev = async expr => {
    const r = await control.daemon.call('evaluate_script', { pageId, function: expr });
    const t = r.content?.find(c => c.type === 'text')?.text ?? '';
    const m = t.match(/```json\n([\s\S]*?)\n```/);
    if (r.isError) throw new Error((m ? m[1] : t).slice(0, 200));
    return m ? JSON.parse(m[1]) : t;
  };
  const stash = await ev(`async () => {
    const r = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
    const ct = r.headers.get('content-type') || '';
    const buf = new Uint8Array(await r.arrayBuffer());
    const magic = String.fromCharCode(...buf.slice(0, 5));
    if (magic !== '%PDF-') {
      const head = new TextDecoder().decode(buf.slice(0, 140)).replace(/\s+/g, ' ');
      return { ok: false, ct, size: buf.length, head };
    }
    let bin = ''; const CH = 0x8000;
    for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
    window.__ccPdfB64 = btoa(bin);
    return { ok: true, ct, size: buf.length, b64len: window.__ccPdfB64.length, url: r.url };
  }`);
  if (stash.ok !== true) {
    const e = new Error(`Inline fetch did not return a PDF (content-type ${stash.ct}, ${stash.size} bytes, head: ${stash.head})`);
    e.httpStatus = stash.size;
    throw e;
  }
  const chunks = [];
  for (let off = 0; off < stash.b64len; off += SLICE) {
    chunks.push(await ev(`() => window.__ccPdfB64.slice(${off}, ${off + SLICE})`));
  }
  const buffer = Buffer.from(chunks.join(''), 'base64');
  if (!pdfMagicCheck(buffer) || buffer.length !== stash.size) {
    throw new Error(`Inline extraction failed integrity: ${buffer.length} bytes`);
  }
  return { buffer, finalUrl: stash.url || url, httpStatus: 200 };
}


// The page-side half of inline extraction: stash -> slice -> assemble.
async function extractViaPage(control, host, url, timeoutMs) {
  const target = control.host === host ? control : new control.constructor(control.actor, host);
  const pages = parsePageLines(await target.daemon.call('list_pages'));
  const marker = url.replace(/[?#].*$/, '');
  const page = pages.find(p => p.url.startsWith(marker)) || pages.find(p => p.url.includes(hostPart(url)));
  if (!page) throw new Error(`No completed download and no inline tab found for ${hostPart(url)}`);
  const ev = async expr => {
    const r = await target.daemon.call('evaluate_script', { pageId: page.pageId, function: expr });
    return JSON.parse(r.content?.find(c => c.type === 'text')?.text.match(/```json\n([\s\S]*?)\n```/)[1]);
  };
  const stash = await ev(b64StashExpr(url));
  if (!stash.ok) {
    throw new Error(`Inline fetch did not return a PDF (content-type ${stash.ct}, ${stash.size} bytes, head: ${stash.head})`);
  }
  const chunks = [];
  for (let off = 0; off < stash.b64len; off += SLICE) {
    chunks.push(await ev(b64SliceExpr(off, SLICE)));
  }
  const buffer = Buffer.from(chunks.join(''), 'base64');
  if (!pdfMagicCheck(buffer) || buffer.length !== stash.size) {
    throw new Error(`Inline extraction failed integrity: ${buffer.length} bytes, magic ${buffer.subarray(0, 5).toString('latin1')}`);
  }
  return { buffer, via: 'inline-fetch' };
}

// Best-effort: find the tab that carries this URL and read the download
// request's final URL and status from the network log. Absence is fine —
// the moved file's bytes are the real evidence.
async function httpFacts(control, host, url) {
  const target = control.host === host ? control : new control.constructor(control.actor, host);
  const pages = parsePageLines(await target.daemon.call('list_pages'));
  const marker = url.replace(/[?#].*$/, '');
  const page = pages.find(p => p.url.startsWith(marker)) || pages.find(p => p.url.includes(hostPart(url)));
  if (!page) return {};
  const requests = extractText(await target.daemon.call('list_network_requests', { pageId: page.pageId }));
  const hit = requests.split('\n').find(l => l.includes(hostPart(url)) || (/\.pdf/i.test(l) && /reqid/.test(l)));
  const reqid = hit && (hit.match(/reqid[=:]\s*(\d+)/) || [])[1];
  if (!reqid) return {};
  const detail = extractText(await target.daemon.call('get_network_request', { pageId: page.pageId, reqid: Number(reqid) }));
  const status = (detail.match(/\bstatus\b[":\s]+(\d{3})/i) || [])[1];
  const finalUrl = (detail.match(/https?:\/\/[^\s"\\]+/g) || []).find(u => /\.pdf/i.test(u)) || url;
  return { status: status ? Number(status) : null, finalUrl };
}

function extractText(result) {
  return result?.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || '';
}

function hostPart(url) { return (url || '').replace(/^https?:\/\//, '').split('/')[0]; }
