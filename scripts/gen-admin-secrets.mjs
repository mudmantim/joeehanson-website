/**
 * Generates the three environment variables the analytics system needs.
 *
 *   node scripts/gen-admin-secrets.mjs
 *
 * First-time setup only: generates all three variables, including JH_SECRET.
 * A strong password is generated for you and shown once.
 *
 * To CHANGE the password later, use scripts/set-admin-password.mjs instead --
 * it prompts without echoing and leaves JH_SECRET alone, so existing sessions
 * and owner-exclusion cookies survive. The password itself
 * is never stored anywhere — only its PBKDF2 hash goes into the environment,
 * so a leak of the Netlify env vars does not hand over admin access.
 *
 * Put the password in your password manager. It cannot be recovered.
 */

import { webcrypto as crypto } from 'node:crypto';

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomHex = (bytes) => hex(crypto.getRandomValues(new Uint8Array(bytes)));

async function pbkdf2Hex(password, saltHex, iterations = 210_000) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256));
}

const WORDS = 'amber porch lantern gravel hollow ember willow thistle harbor cinder meadow drifter'.split(' ');
function generatePassword() {
  const pick = () => WORDS[crypto.getRandomValues(new Uint32Array(1))[0] % WORDS.length];
  return [pick(), pick(), pick(), pick(), randomHex(2)].join('-');
}

if (process.argv.length > 2) {
  console.error('Refusing a password given as an argument — it would be recorded in your shell history.');
  console.error('To set a password you choose, use: node scripts/set-admin-password.mjs');
  process.exit(2);
}

const password = generatePassword();
const salt = randomHex(16);
const hash = await pbkdf2Hex(password, salt);
const secret = randomHex(32);

console.log(`
Admin password (store this in your password manager — it is not recoverable):

    ${password}

Set these three environment variables on the Netlify project:

    JH_SECRET            ${secret}
    JH_ADMIN_PW_SALT     ${salt}
    JH_ADMIN_PW_HASH     ${hash}

JH_SECRET signs both the admin session cookie and the owner-exclusion cookie.
Changing it signs everyone out and un-marks every browser you had excluded.
`);
