// Encrypted on-device storage. The map never leaves the phone: AES-GCM with a
// key derived from a user passphrase (PBKDF2). `storage` is anything with
// getItem/setItem (localStorage in the browser, a stub in tests).

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();
export const KDF_ITERATIONS = 310000;

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(pass, salt, iterations) {
  const base = await subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encrypt(obj, pass, iterations = KDF_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt, iterations);
  const data = await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { v: 1, it: iterations, salt: b64(salt), iv: b64(iv), data: b64(data) };
}

export async function decrypt(blob, pass) {
  const key = await deriveKey(pass, unb64(blob.salt), blob.it);
  try {
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.data));
    return JSON.parse(dec.decode(plain));
  } catch {
    throw new Error('wrong_passphrase_or_corrupted');
  }
}

const KEY = 'navigator.vault.v1';

export async function save(storage, obj, pass, iterations) {
  storage.setItem(KEY, JSON.stringify(await encrypt(obj, pass, iterations)));
}

export async function load(storage, pass) {
  const raw = storage.getItem(KEY);
  if (!raw) return null;
  return decrypt(JSON.parse(raw), pass);
}
