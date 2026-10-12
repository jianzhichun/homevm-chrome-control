import { join } from 'node:path';
import { safeFilename, b64StashExpr, b64SliceExpr, pdfMagicCheck } from '../domain/download.mjs';
import { parsePageLines } from './control.mjs';

const SLICE = 1_500_000;

// The download leg, run on the browser machine. Exactly one route:
//
// SESSION-TAB - the Cambridge session lives in a PROFILE of the running
// Chrome, shared by that profile's tabs through cookies. The leg drives the
// EXISTING session tab on the TARGET ORIGIN: same-origin credentialed fetch
// of the target URL, %PDF- magic checked, chunked base64 out, written into
// staging. The tab is restored to where it was.
//
// With no session tab on that origin the leg fails and names the remedy
// (open the site once in Profile 1 and retry) - it does not spawn tabs or
// machines on its own.
export async function downloadArtifact(control, args) {
  const filename = safeFilename(args.filename);
  const url = args.url;
  const donor = await sessionDonor(control, url);
  const profileDir = args.profile || control.host.profile.profiles?.browser;
  if (!donor) {
    throw new Error('No Cambridge session tab found on win01 - open any '
      + 'page of the target site in Profile 1 and retry (the session is '
      + 'cookie-based per profile; see exit-pool README)');
  }

  const extracted = await extractViaPageId(control, donor.pageId, url);
  const files = control.host.files;
  const staged = await files.writeBuffer(join(control.host.profile.staging, filename), extracted.buffer);
  const described = await files.describe(staged);
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

// The session-tab donor: any page on the SAME ORIGIN as the target URL.
// The origin matters because the same-origin fetch in extractViaPageId is
// what carries the profile's session cookies to the download.
export async function sessionDonor(control, url) {
  const origin = new URL(url).origin;
  const pages = parsePageLines(await control.daemon.call('list_pages'));
  const donors = pages.filter(p => {
    try { return new URL(p.url).origin === origin; } catch { return false; }
  });
  if (!donors.length) return null;
  return { pageId: donors[0].pageId, originalUrl: donors[0].url };
}

// Inline extraction on a GIVEN pageId: fetch the URL same-origin with
// credentials, check the %PDF- magic BEFORE anything is written (a challenge
// HTML can never pass as the artifact), stash base64 in the page, slice it
// home, and assemble.
export async function extractViaPageId(control, pageId, url) {
  const ev = async expr => {
    const r = await control.daemon.call('evaluate_script', { pageId, function: expr });
    const t = r.content?.find(c => c.type === 'text')?.text ?? '';
    const m = t.match(/```json\n([\s\S]*?)\n```/);
    if (r.isError) throw new Error((m ? m[1] : t).slice(0, 200));
    return m ? JSON.parse(m[1]) : t;
  };
  const stash = await ev(b64StashExpr(url));
  if (stash.ok !== true) {
    throw new Error(`Inline fetch did not return a PDF (content-type ${stash.ct}, ${stash.size} bytes, head: ${stash.head})`);
  }
  const chunks = [];
  for (let off = 0; off < stash.b64len; off += SLICE) {
    chunks.push(await ev(b64SliceExpr(off, SLICE)));
  }
  const buffer = Buffer.from(chunks.join(''), 'base64');
  if (!pdfMagicCheck(buffer) || buffer.length !== stash.size) {
    throw new Error(`Inline extraction failed integrity: ${buffer.length} bytes`);
  }
  return { buffer, finalUrl: stash.url || url, httpStatus: 200 };
}
