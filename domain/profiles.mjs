// Chrome's own registry records directory/display name/account metadata.
// It does not establish which live tab belongs to a Profile.
export function fromLocalState(raw) {
  const cache = JSON.parse(raw)?.profile?.info_cache || {};
  return Object.entries(cache)
    .map(([dir, p]) => ({ dir, name: p.name || dir, gaia: p.gaia_name || '', user: p.user_name || '', activeTime: p.active_time || 0 }))
    .sort((a, b) => b.activeTime - a.activeTime);
}
