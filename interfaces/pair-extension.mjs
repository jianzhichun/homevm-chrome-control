import { ExtensionPairings } from '../adapters/extension-pairings.mjs';
import { join } from 'node:path';

export async function pairExtension(control, selector, input = process.stdin) {
  if (!selector) throw new Error('pair requires --account or --profile');
  if (!control.host.profile.profiles) throw new Error('This host has no existing-browser Profile inventory');
  const account = await control.resolve(selector);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of input) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 2048) throw new Error('Pairing input is too large');
    chunks.push(chunk);
  }
  const token = Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8').trim();
  const profile = control.host.profile;
  const pairings = new ExtensionPairings(join(profile.home, '.config/chrome-control/pairings'), profile.profiles.userDataDir);
  return pairings.save(account.dir, token);
}
