import { readMoodleIdentity } from '../adapters/moodle-identity.mjs';
import { payload } from './page.mjs';

export async function websiteIdentity(control, account, pageId) {
  const page = await control.managed.require(account, pageId);
  const location = payload(await control._call('evaluate_script', { pageId, function: '() => location.href', waitForStableDom: false }));
  const origin = new URL(location).origin;
  const expected = account.sites?.[origin];
  if (origin !== 'https://www.vle.cam.ac.uk') return { status: 'unverified', origin, reason: 'No website identity adapter', profileBinding: page.source };
  let observed;
  try { observed = payload(await control._call('evaluate_script', { pageId, function: readMoodleIdentity.toString(), waitForStableDom: false })); }
  catch { return { status: 'unverified', origin, reason: 'Moodle identity request did not complete' }; }
  const status = observed.status === 'observed'
    ? expected?.username ? (observed.username === expected.username ? 'matched' : 'mismatch') : 'observed'
    : observed.status;
  return { ...observed, status, origin, expectedUsername: expected?.username || null };
}

export function requireExpectedIdentity(account, identity) {
  if (account.sites?.[identity.origin]?.username && identity.status !== 'matched') {
    throw new Error(`Website identity ${identity.status}: expected ${account.sites[identity.origin].username}; no account download was performed`);
  }
}
