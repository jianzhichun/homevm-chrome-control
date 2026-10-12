import { join } from 'node:path';
import { safeFilename, pickDonor, b64StashExpr, b64SliceExpr, pdfMagicCheck } from '../domain/download.mjs';
import { attribute } from '../domain/profiles.mjs';
import { DEDICATED_PROFILE, parsePageLines } from './control.mjs';
import { LeasedPage } from './page.mjs';

const SLICE = 1_500_000;

// The download leg, run on the browser machine. Exactly one route:
//
// SESSION-TAB - the institutional session lives in a PROFILE's cookies. The
// leg picks a tab of THAT profile on the TARGET ORIGIN, does a same-origin
// credentialed fetch of the URL in it, checks %PDF-, slices base64 home and
// writes it into staging.
//
// The profile decides the instance (control.controlFor). The dedicated
// instance (default) is ours: with no tab on the origin the leg opens one and
// closes it afterwards. A profile of the owner's own Chrome is never given a
// new tab - the leg uses an existing tab provably of that profile or fails.
export async function downloadArtifact(control, args) {
  const filename = safeFilename(args.filename);
  const profileDir = args.profile || DEDICATED_PROFILE;
  const donor = await claimDonor(control.controlFor(profileDir), profileDir, args.url);
  let extracted;
  try {
    extracted = await extractPdf(donor.page, args.url);
  } finally {
    await (donor.opened ? donor.page.close() : donor.page.release()).catch(() => {});
  }
  const files = control.host.files;
  const staged = await files.writeBuffer(join(control.host.profile.staging, filename), extracted.buffer);
  const described = await files.describe(staged);
  return {
    path: staged,
    bytes: described.bytes,
    sha256: described.sha256,
    finalUrl: extracted.finalUrl || args.url,
    httpStatus: extracted.httpStatus ?? null,
    profile: profileDir,
    originalName: filename,
    via: donor.opened ? 'session-tab (opened)' : 'session-tab',
    identity: args.identity || `Chrome profile ${profileDir} session`,
  };
}

// A leased donor page on the target origin, and whether we opened it.
export async function claimDonor(target, profileDir, url) {
  const origin = new URL(url).origin;
  const shared = profileDir !== DEDICATED_PROFILE;
  let pages = parsePageLines(await target._call('list_pages'));
  if (shared) pages = attribute(pages, await target.host.profiles.urlSets());
  const found = pickDonor(pages, url, shared ? profileDir : undefined);
  if (found) return { page: await LeasedPage.borrow(target, found.pageId, found.url), opened: false };
  if (shared) {
    throw new Error(`No ${origin} tab of profile ${profileDir}; tabs are never opened in an owner's `
      + `profile - open the site there once, or use the dedicated profile (${DEDICATED_PROFILE})`);
  }
  const page = await LeasedPage.open(target, origin + '/');
  if (new URL(page.url).origin !== origin) {
    await page.close().catch(() => {});
    throw new Error(`No session on ${origin} in ${profileDir}: it redirected to ${page.url.slice(0, 120)} `
      + '- sign in first (browserctl login), then retry');
  }
  return { page, opened: true };
}

// Same-origin credentialed fetch inside the donor, %PDF- checked BEFORE
// anything is written (a challenge HTML can never pass as the artifact),
// base64 stashed in the page and sliced home.
export async function extractPdf(page, url) {
  const stash = await page.eval(b64StashExpr(url));
  if (stash?.ok !== true) {
    throw new Error(`Inline fetch did not return a PDF (content-type ${stash?.ct}, ${stash?.size} bytes, head: ${stash?.head})`);
  }
  const chunks = [];
  for (let off = 0; off < stash.b64len; off += SLICE) chunks.push(await page.eval(b64SliceExpr(off, SLICE)));
  const buffer = Buffer.from(chunks.join(''), 'base64');
  if (!pdfMagicCheck(buffer) || buffer.length !== stash.size) {
    throw new Error(`Inline extraction failed integrity: ${buffer.length} bytes`);
  }
  return { buffer, finalUrl: stash.url || url, httpStatus: 200 };
}
