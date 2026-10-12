// Pure logic for the download leg: which tab donates the session, the
// expressions run inside it, and the artifact checks repeated after transfer.

// The donor tab for the same-origin fetch: the first page on the target
// URL's origin. With profileDir set (a browser shared by several profiles)
// the page must be PROVABLY that profile's - attributed, not unattributed or
// ambiguous - so a tab of another profile is never driven.
export function pickDonor(pages, url, profileDir) {
  const origin = new URL(url).origin;
  return pages.find(p => {
    if (profileDir !== undefined && p.profile !== profileDir) return false;
    try { return new URL(p.url).origin === origin; } catch { return false; }
  }) || null;
}

// The staged name the caller asked for must be a plain name.
export function safeFilename(name) {
  const base = String(name || '').split(/[\\/]/).pop().trim();
  if (!base || base === '.' || base === '..' || /[<>:"|?*\u0000]/.test(base)) {
    throw new Error(`Unsafe download filename: ${name}`);
  }
  return base;
}

// The pull side re-checks what the browser side claimed, byte-for-byte.
export function pdfMagicCheck(header) {
  return header.subarray(0, 5).toString('latin1') === '%PDF-';
}

// Inline-viewer extraction: the page stashes the PDF as base64, the leg
// pulls it in slices. One slice request.
export function b64SliceExpr(offset, length) {
  return `() => window.__ccPdfB64.slice(${offset}, ${offset + length})`;
}

// The stashing half: fetch the URL same-origin with credentials, check the
// %PDF- magic BEFORE anything else, then stash. Returns what the puller needs.
export const b64StashExpr = url => `async () => {
  const r = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
  const ct = r.headers.get('content-type') || '';
  const buf = new Uint8Array(await r.arrayBuffer());
  const magic = String.fromCharCode(...buf.slice(0, 5));
  if (magic !== '%PDF-') {
    const head = new TextDecoder().decode(buf.slice(0, 160)).replace(/\s+/g, ' ');
    return { ok: false, ct, size: buf.length, head };
  }
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
  window.__ccPdfB64 = btoa(bin);
  return { ok: true, ct, size: buf.length, b64len: window.__ccPdfB64.length };
}`;
