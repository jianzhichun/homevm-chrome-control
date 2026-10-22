// Profile metadata is a selector, not proof of a website's signed-in identity.
export function resolveAccount(profiles, selector, aliases = {}) {
  const alias = aliases[selector];
  const email = (alias?.email || selector).trim().toLowerCase();
  const policies = Object.values(aliases).filter(a => a.email?.trim().toLowerCase() === email);
  if (new Set(policies.map(p => JSON.stringify(p.sites || {}))).size > 1) throw new Error(`Conflicting website identity policies for ${email}`);
  const config = alias || policies[0];
  const matches = profiles.filter(p => p.user?.trim().toLowerCase() === email);
  if (matches.length !== 1) {
    throw new Error(matches.length ? `Ambiguous Chrome account ${selector}` : `Chrome account ${selector} not found; run profiles`);
  }
  const profile = matches[0];
  return { ...profile, email: profile.user, alias: alias ? selector : null, sites: config?.sites || {} };
}

export function resolveProfile(profiles, dir, aliases = {}) {
  const profile = profiles.find(p => p.dir === dir);
  if (!profile) throw new Error(`Unknown profile directory ${dir}`);
  return profile.user ? resolveAccount([profile], profile.user, aliases)
    : { ...profile, email: '', alias: null, sites: {} };
}

export function validateDestination(url) {
  const parsed = new URL(url);
  if (!['http:', 'https:', 'about:'].includes(parsed.protocol) || (parsed.protocol === 'about:' && parsed.href !== 'about:blank')) {
    throw new Error('Account open accepts http(s) URLs or about:blank only');
  }
  if (parsed.username || parsed.password) throw new Error('URL credentials are not accepted');
  return parsed.href;
}
