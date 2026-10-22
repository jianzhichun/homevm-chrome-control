// Runs only on the configured Moodle origin. Read the platform's login
// chrome and the current user's own profile, never names in course content.
export async function readMoodleIdentity() {
  const info = document.querySelector('#page-footer .logininfo, footer .logininfo');
  const link = info?.querySelector('a[href*="/user/profile.php"]');
  if (!link) return { status: info?.querySelector('a[href*="/login/"]') || document.querySelector('form#login') ? 'signed_out' : 'unverified' };
  const userId = new URL(link.href).searchParams.get('id');
  const currentId = globalThis.M?.cfg?.userId;
  if (!userId || String(currentId) !== userId) return { status: 'unverified', reason: 'Current Moodle user ID not confirmed' };
  const response = await fetch('/user/profile.php', { signal: AbortSignal.timeout(15_000) });
  if (new URL(response.url).origin !== location.origin || response.url.includes('/login/')) return { status: 'signed_out' };
  const profile = new DOMParser().parseFromString(await response.text(), 'text/html');
  const self = profile.querySelector('#page-footer .logininfo a[href*="/user/profile.php"], footer .logininfo a[href*="/user/profile.php"]');
  const username = self?.textContent.match(/\[([^\]]+)\]/)?.[1];
  if (!username || new URL(self.href, location.origin).searchParams.get('id') !== userId) return { status: 'unverified' };
  return { status: 'observed', username, userId, source: 'moodle-current-user-and-own-profile' };
}
