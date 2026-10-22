// Official list_pages text, including file/about anchors, without losing
// URL fragments (a historical normalized URL is not a page identity).
export function parsePageLines(raw) {
  const body = typeof raw === 'string' ? raw : raw?.content?.find(c => c.type === 'text')?.text || '';
  return [...body.matchAll(/^(\d+): (.*)$/gm)].map(m => {
    const label = m[2].replace(/ \[selected\]$/, '');
    let url = label.match(/\(([a-z][\w+.-]*:[^\n]*)\)\s*$/i)?.[1] || '';
    let title;
    if (!url && /^[a-z][\w+.-]*:/i.test(label)) { url = label; title = ''; }
    else if (url) title = label.slice(0, label.length - url.length - 3);
    else title = label;
    return { pageId: Number(m[1]), title, url };
  });
}

export function uniqueAnchor(pages, url) {
  const matches = pages.filter(p => p.url === url);
  if (matches.length > 1) throw new Error('Multiple tabs have the one-time anchor; refusing to guess');
  return matches[0];
}
