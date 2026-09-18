/**
 * Signing and hashing shared by the collector and the admin gate.
 *
 * Everything here is Web Crypto so the same file runs unchanged in the Deno
 * edge runtime and in Node.
 */

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacKey(secret: string, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usage);
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await hmacKey(secret, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

/**
 * Length-independent constant-time comparison.
 *
 * Compares every character of `a` against `b` regardless of where they first
 * differ, so the time taken does not reveal how much of a guess was correct.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * A signed, expiring token: `<expiryEpochSeconds>.<hmac>`.
 *
 * `kind` is part of the signed message so an owner-exclusion token can never
 * be replayed as an admin session token, even though both use one secret.
 */
export async function issueToken(secret: string, kind: string, ttlSeconds: number): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `${exp}.${await hmacHex(secret, `${kind}|${exp}`)}`;
}

export async function verifyToken(
  secret: string,
  kind: string,
  token: string | undefined | null,
): Promise<{ valid: boolean; expiresAt?: number }> {
  if (!token) return { valid: false };

  const dot = token.indexOf('.');
  if (dot < 1) return { valid: false };

  const exp = Number(token.slice(0, dot));
  const sig = token.slice(dot + 1);
  if (!Number.isInteger(exp) || !/^[0-9a-f]{64}$/.test(sig)) return { valid: false };

  // Verify the signature before checking expiry, so both a forged token and an
  // expired one take the same work to reject.
  const expected = await hmacHex(secret, `${kind}|${exp}`);
  if (!timingSafeEqual(sig, expected)) return { valid: false };
  if (exp <= Math.floor(Date.now() / 1000)) return { valid: false };

  return { valid: true, expiresAt: exp };
}

/** PBKDF2-SHA256. Used only for the admin password. */
export async function pbkdf2Hex(password: string, saltHex: string, iterations = 210_000): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return toHex(bits);
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export function setCookie(name: string, value: string, maxAgeSeconds: number, sameSite = 'Lax'): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    `SameSite=${sameSite}`,
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
}
