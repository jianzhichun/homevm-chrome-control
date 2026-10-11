import { join } from 'node:path';
import { openInProfile } from '../adapters/opener.mjs';
import { newFiles, selectCandidate, safeFilename } from '../domain/download.mjs';
import { parsePageLines } from './control.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// The download leg, run on the browser machine: open the URL in the chosen
// profile of the running Chrome (the OS forwards into the existing browser,
// so the profile's cookies ride along), wait for Chrome to finish writing
// the file, collect it under the requested name in staging, and return the
// filesystem evidence plus best-effort HTTP facts.
//
// v0 scope: identity-bearing instances only — the dedicated headless browser
// has no Cambridge session, and its downloads are not part of this leg.
export async function downloadArtifact(control, args) {
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

  const before = (await files.inventory(watchDir)).files.map(f => f.name);
  await openInProfile({ platform: host.profile.platform, executablePath: host.profile.executablePath },
    profileDir, args.url);

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
  if (!chosen) {
    throw new Error(`No completed download within ${timeoutMs} ms (watched ${watchDir}); recent: ${lastNames.slice(-6).join(', ')}`);
  }

  const staged = await files.move(chosen.path, join(host.profile.staging, filename));
  const described = await files.describe(staged);
  const http = await httpFacts(control, host, args.url).catch(() => ({}));
  return {
    path: staged,
    bytes: described.bytes,
    sha256: described.sha256,
    finalUrl: http.finalUrl || args.url,
    httpStatus: http.status ?? null,
    profile: profileDir,
    originalName: chosen.path.split(/[\\/]/).pop(),
    identity: args.identity || `Chrome profile ${profileDir} session`,
  };
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
