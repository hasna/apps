import { createHmac, timingSafeEqual } from "node:crypto";
import type { GeneratedTotp, TotpAlgorithm } from "./types.js";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const HASH_BY_ALGORITHM: Record<TotpAlgorithm, string> = {
  SHA1: "sha1",
  SHA256: "sha256",
  SHA512: "sha512",
};

export function normalizeBase32Secret(secret: string): string {
  const normalized = secret.toUpperCase().replace(/[\s=-]/g, "");
  if (!normalized) throw new Error("TOTP secret is required");
  if (!/^[A-Z2-7]+$/.test(normalized)) {
    throw new Error("TOTP secret must be RFC 4648 base32");
  }
  return normalized;
}

export function decodeBase32(secret: string): Buffer {
  const normalized = normalizeBase32Secret(secret);
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("TOTP secret must be RFC 4648 base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

export function normalizeAlgorithm(value?: string): TotpAlgorithm {
  const normalized = (value ?? "SHA1").toUpperCase();
  if (normalized === "SHA1" || normalized === "SHA256" || normalized === "SHA512") {
    return normalized;
  }
  throw new Error("TOTP algorithm must be SHA1, SHA256, or SHA512");
}

export function normalizeDigits(value?: number): number {
  const digits = value ?? 6;
  if (!Number.isInteger(digits) || digits < 6 || digits > 8) {
    throw new Error("TOTP digits must be an integer from 6 to 8");
  }
  return digits;
}

export function normalizePeriod(value?: number): number {
  const period = value ?? 30;
  if (!Number.isInteger(period) || period < 1 || period > 300) {
    throw new Error("TOTP period must be an integer from 1 to 300 seconds");
  }
  return period;
}

export function generateTotp(secret: string, options: {
  algorithm?: TotpAlgorithm | string;
  digits?: number;
  period?: number;
  at?: Date | number;
} = {}): GeneratedTotp {
  const algorithm = normalizeAlgorithm(options.algorithm);
  const digits = normalizeDigits(options.digits);
  const period = normalizePeriod(options.period);
  const timestamp = options.at instanceof Date
    ? options.at.getTime()
    : typeof options.at === "number"
      ? options.at
      : Date.now();
  const counter = Math.floor(Math.floor(timestamp / 1000) / period);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac(HASH_BY_ALGORITHM[algorithm], decodeBase32(secret))
    .update(counterBuffer)
    .digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  const modulo = 10 ** digits;
  const code = String(binary % modulo).padStart(digits, "0");
  const expiresAtMs = (counter + 1) * period * 1000;

  return {
    code,
    period,
    expires_at: new Date(expiresAtMs).toISOString(),
    expires_in: Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000)),
    counter,
  };
}

export function codesEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
