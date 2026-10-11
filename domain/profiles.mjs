// Pure profile logic: discovery from Chrome's own registry file, and the
// attribution of an open tab to the profile that owns it.

// Chrome records every profile it knows about in Local State's
// profile.info_cache -- the same JSON on macOS and Windows, which is why one
// reader serves both platforms. Sorted most-recently-used first.
export function fromLocalState(raw) {
  const state = JSON.parse(raw);
  const cache = state?.profile?.info_cache || {};
  return Object.entries(cache)
    .map(([dir, p]) => ({
      dir,
      name: p.name || dir,
      gaia: p.gaia_name || '',
      user: p.user_name || '',
      activeTime: p.active_time || 0,
    }))
    .sort((a, b) => b.activeTime - a.activeTime);
}

// The browser-level debugging connection sees every profile's tabs and does
// not label them. Chrome does label them indirectly: each profile writes its
// own SNSS session files ("Last Session", "Sessions/Session_*"), and those
// binaries store the URLs of the tabs open in that profile. A tab whose URL
// appears in exactly one profile's files belongs to that profile; appearing
// in several is reported as ambiguous rather than guessed.
export function urlsFromSnss(buffer) {
  const text = buffer.toString('latin1');
  const urls = new Set();
  for (const m of text.matchAll(/https?:\/\/[\x21-\x7e]+/g)) {
    urls.add(normalizeUrl(m[0].replace(/[)\]},.'">]+$/, '')));
  }
  return urls;
}

export function normalizeUrl(url) {
  return url.split(/[?#]/, 1)[0].replace(/\/$/, '');
}

export function attribute(pages, urlSets) {
  return pages.map(p => {
    const url = normalizeUrl(p.url || '');
    const hits = url ? [...urlSets].filter(([, set]) => set.has(url)).map(([dir]) => dir) : [];
    // Exactly one profile having the URL in its session history is the
    // attribution; several is a guess we refuse to make. Note the evidence
    // is session history, so a profile that CLOSED the tab keeps matching
    // until its session files are rewritten.
    return { ...p, profile: hits.length === 1 ? hits[0] : null, ambiguous: hits.length > 1 ? hits : [] };
  });
}
