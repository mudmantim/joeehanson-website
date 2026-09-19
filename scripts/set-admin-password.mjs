/**
 * Rotate the /admin password.
 *
 *   node scripts/set-admin-password.mjs
 *
 * Prompts twice with echo off and prints ONLY the two values you paste into
 * Netlify. Your password is never echoed, never written to a file, never
 * accepted as a command-line argument (which would put it in shell history),
 * and never printed — not even back to you for confirmation.
 *
 * This rotates the password ONLY. It does not touch JH_SECRET, which signs the
 * admin session cookie and every owner-exclusion cookie. Leaving JH_SECRET
 * alone is what keeps existing sessions signed in and every browser you have
 * marked as owner still excluded.
 */

import { webcrypto as crypto } from 'node:crypto';

const MIN_LENGTH = 12;
const ITERATIONS = 210_000; // must match pbkdf2Hex in netlify/lib/crypto.ts

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function pbkdf2Hex(password, saltHex, iterations = ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256));
}

/** Read a line from the terminal without echoing it. */
function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const output = process.stderr; // prompts to stderr so stdout stays pipeable

    if (!input.isTTY) {
      reject(new Error(
        'This needs a real interactive terminal so your password is never echoed.\n' +
        '\n' +
        'Open a terminal window and run:\n' +
        '\n' +
        '  cd ~/joeehanson-website && node scripts/set-admin-password.mjs\n' +
        '\n' +
        'It will not work through a wrapper that does not attach a TTY -- that\n' +
        "includes Claude Code's ! prefix, editor consoles, and piped input.",
      ));
      return;
    }

    output.write(question);
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');

    let buf = '';
    const finish = (fn, arg) => {
      input.setRawMode(false);
      input.pause();
      input.removeListener('data', onData);
      output.write('\n');
      fn(arg);
    };

    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') return finish(resolve, buf);
        if (ch === '\u0003') return finish(() => process.exit(130));   // Ctrl-C
        if (ch === '\u007f' || ch === '\b') { buf = buf.slice(0, -1); continue; }
        if (ch < ' ') continue;                                        // ignore other control chars
        buf += ch;
      }
    };

    input.on('data', onData);
  });
}

// Refuse a password passed as an argument: it would be in shell history and in
// the process list, which is exactly what this script exists to avoid.
if (process.argv.length > 2) {
  console.error('Refusing a password given as an argument — it would be recorded in your shell history.');
  console.error('Run it with no arguments and type the password at the prompt instead.');
  process.exit(2);
}

async function ask(question) {
  try {
    return await promptHidden(question);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}

const first = await ask('New admin password (not shown): ');
if (first.length < MIN_LENGTH) {
  console.error(`Too short — use at least ${MIN_LENGTH} characters. Nothing was changed.`);
  process.exit(1);
}

const second = await ask('Type it again to confirm:      ');
if (first !== second) {
  console.error('The two entries did not match. Nothing was changed.');
  process.exit(1);
}

const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
const hash = await pbkdf2Hex(first, salt);

console.log(`
Set these two variables on the Netlify project, then redeploy.
Your password is not shown anywhere and is not recoverable from these.

  JH_ADMIN_PW_SALT   ${salt}
  JH_ADMIN_PW_HASH   ${hash}

Leave JH_SECRET exactly as it is. It signs the admin session cookie and every
owner-exclusion cookie; changing it would sign you out everywhere and un-mark
every browser you have excluded.

Store the password in your password manager now. It cannot be recovered.
`);
