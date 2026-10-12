import { DEDICATED_PROFILE } from '../application/control.mjs';
import { LeasedPage } from '../application/page.mjs';
import { CambridgeSignIn } from '../application/sign-in.mjs';
import { parseCredentials } from '../domain/entra.mjs';

// An article page, not a journal home: the public homepage on the same
// proxied host would read as "already signed in".
export const DEFAULT_ENTRY = 'https://www-sciencedirect-com.ezp.lib.cam.ac.uk/science/article/pii/S0963869522000767';

// `login [ENTRY]`: Cambridge sign-in in a page we open on the DEDICATED
// instance. Credentials arrive on stdin (the owner's credentials file), never
// in argv. An owner's Chrome profile is refused: the walk would need a tab
// there, and the leg never opens or drives one.
export async function signInCommand(control, { entry = DEFAULT_ENTRY, profile = DEDICATED_PROFILE }, stdin = process.stdin) {
  if (profile !== DEDICATED_PROFILE) throw new Error(`login runs only in the dedicated profile (${DEDICATED_PROFILE}), not ${profile}`);
  const creds = parseCredentials(await readAll(stdin));
  const target = control.controlFor(profile);
  const page = await LeasedPage.open(target, 'about:blank');
  try {
    const log = (msg, extra) => console.error('[login]', msg, extra === undefined ? '' : JSON.stringify(extra).slice(0, 200));
    return { profile, entry, ...await new CambridgeSignIn(page, creds, { entry, log }).run() };
  } finally {
    await page.close().catch(() => {});
  }
}

async function readAll(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}
