import { safeFilename, pickDonor, b64StashExpr, b64SliceExpr, pdfMagicCheck } from '../domain/download.mjs';
import { DEDICATED_PROFILE, parsePageLines } from './control.mjs';
import { LeasedPage } from './page.mjs';
import { websiteIdentity, requireExpectedIdentity } from './identity.mjs';

const SLICE = 1_500_000;

export async function downloadArtifact(control, args) {
  const filename = safeFilename(args.filename);
  const selector = args.account ? { account: args.account } : { profile: args.profile || DEDICATED_PROFILE };
  if (selector.profile === DEDICATED_PROFILE && control.host.profile.mode !== 'dedicated') throw new Error('Personal Chrome downloads require --account or --profile; no default account was selected');
  const account = selector.profile === DEDICATED_PROFILE ? null : await control.resolve(selector);
  const target = control.controlFor(account?.dir || DEDICATED_PROFILE);
  const donor = account ? await accountDonor(control, target, account, selector, args.url)
    : await claimDonor(target, DEDICATED_PROFILE, args.url);
  let extracted;
  let identity;
  try {
    if (account) {
      identity = await websiteIdentity(target, account, donor.page.pageId);
      requireExpectedIdentity(account, identity);
    }
    extracted = await extractPdf(donor.page, args.url);
  } finally {
    await (donor.opened ? donor.page.close() : donor.page.release()).catch(() => {});
  }
  const files = control.host.files;
  const destination = await files.createDownloadPath(control.host.profile.staging, filename);
  const staged = await files.writeBuffer(destination, extracted.buffer);
  const described = await files.describe(staged);
  return { path: staged, bytes: described.bytes, sha256: described.sha256,
    finalUrl: extracted.finalUrl || args.url, httpStatus: extracted.httpStatus ?? null,
    profile: account?.dir || DEDICATED_PROFILE, account: account?.email || null,
    websiteIdentity: identity || { status: 'unverified' }, originalName: filename,
    via: donor.opened ? 'session-tab (opened)' : 'session-tab',
    identity: args.identity || `Chrome profile ${account?.dir || DEDICATED_PROFILE} session` };
}

async function accountDonor(control, target, account, selector, url) {
  const listing = await target.managed.pages(account);
  const found = pickDonor(listing.pages.filter(p => p.binding.actor === control.actor), url);
  const opened = found ? null : await control.open(new URL(url).origin + '/', selector);
  const selected = found || { pageId: opened.pageId, url: opened.url };
  // Every scripted operation keeps its account scope, including close/release.
  const scoped = { _call: (name, args) => control.call(name, args, selector) };
  const page = await LeasedPage.borrow(scoped, selected.pageId, selected.url);
  return { page, opened: !found };
}

export async function claimDonor(target, profileDir, url) {
  if (profileDir !== DEDICATED_PROFILE) throw new Error('Shared Profile donors require a verified managed binding; use account open');
  const origin = new URL(url).origin;
  const pages = parsePageLines(await target._call('list_pages'));
  const found = pickDonor(pages, url);
  if (found) return { page: await LeasedPage.borrow(target, found.pageId, found.url), opened: false };
  const page = await LeasedPage.open(target, origin + '/');
  if (new URL(page.url).origin !== origin) {
    await page.close().catch(() => {});
    throw new Error(`No session on ${origin} in ${profileDir}: it redirected to ${page.url.slice(0, 120)} - sign in first`);
  }
  return { page, opened: true };
}

export async function extractPdf(page, url) {
  try {
    const stash = await page.eval(b64StashExpr(url));
    if (stash?.ok !== true) throw new Error(`Inline fetch did not return a PDF (content-type ${stash?.ct}, ${stash?.size} bytes)`);
    const chunks = [];
    for (let off = 0; off < stash.b64len; off += SLICE) chunks.push(await page.eval(b64SliceExpr(off, SLICE)));
    const buffer = Buffer.from(chunks.join(''), 'base64');
    if (!pdfMagicCheck(buffer) || buffer.length !== stash.size) throw new Error(`Inline extraction failed integrity: ${buffer.length} bytes`);
    return { buffer, finalUrl: stash.url || url, httpStatus: 200 };
  } finally {
    await page.eval('() => { delete window.__ccPdfB64; return true; }').catch(() => {});
  }
}
