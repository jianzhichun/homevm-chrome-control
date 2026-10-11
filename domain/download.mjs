// Pure logic for the download leg: choosing the file a navigation just
// produced, and the artifact checks the pull side repeats after transfer.

export const PARTIAL_RE = /\.(crdownload|part|tmp)$/i;

// Names that appeared since the watch began. Chrome names the finished file
// itself (Content-Disposition); the requested name is applied later by the
// move into staging.
// `before` is a list of names snapshotted earlier; `after` the inventory now.
export function newFiles(before, after) {
  const known = new Set(before);
  return after.filter(f => !known.has(f.name) && !f.partial && !PARTIAL_RE.test(f.name) && f.bytes > 0);
}

// One new file wins outright; several need a tie-break: an exact .pdf beats
// anything else, otherwise refuse rather than guess which download was ours.
export function selectCandidate(newOnes) {
  if (newOnes.length === 0) return { kind: 'none' };
  if (newOnes.length === 1) return { kind: 'single', file: newOnes[0] };
  const pdfs = newOnes.filter(f => /\.pdf$/i.test(f.name));
  if (pdfs.length === 1) return { kind: 'pdf', file: pdfs[0] };
  return { kind: 'ambiguous', files: newOnes };
}

// Downloads are matched against new files regardless of what the publisher
// named them, but a filename the caller asked for must be a plain name.
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
