/**
 * Universal, dependency-free short id generator. Uses the Web Crypto API
 * (`crypto.getRandomValues`, available in Bun, Node 18+, and browsers) with a
 * Math.random fallback, so it bundles cleanly for every target.
 */

// 64-char URL-safe alphabet so a 6-bit mask maps uniformly onto it.
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";

export type IdPrefix = "bas" | "tbl" | "fld" | "rec" | "viw" | "sel";

function randomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  const webcrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (webcrypto && typeof webcrypto.getRandomValues === "function") {
    webcrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < size; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function nano(size = 14): string {
  const bytes = randomBytes(size);
  let id = "";
  for (let i = 0; i < size; i++) {
    id += ALPHABET[bytes[i]! & 63];
  }
  return id;
}

export function newId(prefix: IdPrefix): string {
  return `${prefix}${nano()}`;
}
