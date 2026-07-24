import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decryptSecret,
  encryptSecret,
  ensureOtpHome,
  getKeyPath,
  getMasterKey,
  getOtpHome,
  isEncryptedSecret,
} from "../src/crypto.js";
import { randomBase32Secret } from "./helpers.js";

let home: string;
const originalHasnaOtpHome = process.env.HASNA_OTP_HOME;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "open-otp-crypto-"));
  process.env.HASNA_OTP_HOME = home;
});

afterEach(() => {
  if (originalHasnaOtpHome === undefined) {
    delete process.env.HASNA_OTP_HOME;
  } else {
    process.env.HASNA_OTP_HOME = originalHasnaOtpHome;
  }
  rmSync(home, { recursive: true, force: true });
});

describe("getOtpHome", () => {
  test("uses explicit home argument over env", () => {
    const explicit = join(tmpdir(), "explicit-otp-home");
    expect(getOtpHome(explicit)).toBe(explicit);
    expect(getOtpHome()).toBe(home);
  });
});

describe("ensureOtpHome", () => {
  test("creates missing directory with mode 0o700", () => {
    const nested = join(home, "nested", "otp");
    expect(existsSync(nested)).toBe(false);

    const resolved = ensureOtpHome(nested);
    expect(resolved).toBe(nested);
    expect(existsSync(nested)).toBe(true);
    expect(statSync(nested).mode & 0o777).toBe(0o700);
  });

  test("re-applies chmod on existing directory", () => {
    const resolved = ensureOtpHome(home);
    chmodSync(resolved, 0o755);
    ensureOtpHome(home);
    expect(statSync(resolved).mode & 0o777).toBe(0o700);
  });
});

describe("getMasterKey", () => {
  test("creates vault key on first use", () => {
    const keyPath = getKeyPath(home);
    expect(existsSync(keyPath)).toBe(false);

    const key = getMasterKey(home);
    expect(key.length).toBe(32);
    expect(existsSync(keyPath)).toBe(true);
    expect(statSync(keyPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(keyPath, "utf8").trim()).toBe(key.toString("hex"));
  });

  test("reloads existing hex key from disk", () => {
    const keyPath = getKeyPath(home);
    const existing = Buffer.alloc(32, 0xab);
    writeFileSync(keyPath, `${existing.toString("hex")}\n`, { mode: 0o600 });

    const key = getMasterKey(home);
    expect(key.equals(existing)).toBe(true);
  });

  test("returns cached key for repeated calls on same path", () => {
    const first = getMasterKey(home);
    const second = getMasterKey(home);
    expect(first).toBe(second);
  });

  test("throws when vault key has invalid length", () => {
    const keyPath = getKeyPath(home);
    writeFileSync(keyPath, "deadbeef\n", { mode: 0o600 });
    expect(() => getMasterKey(home)).toThrow("invalid length");
  });
});

describe("encryptSecret / decryptSecret", () => {
  test("round-trips synthetic secrets", () => {
    const secret = randomBase32Secret();
    const encrypted = encryptSecret(secret, home);
    expect(isEncryptedSecret(encrypted)).toBe(true);
    expect(decryptSecret(encrypted, home)).toBe(secret);
  });

  test("rejects non-encrypted values", () => {
    expect(() => decryptSecret("plaintext-secret", home)).toThrow("non-encrypted");
  });

  test("rejects malformed encrypted payloads", () => {
    expect(() => decryptSecret("enc:v1:no-separator", home)).toThrow("Malformed");
    expect(() => decryptSecret("enc:v1:aa:bb", home)).toThrow("Malformed");
    expect(() => decryptSecret("enc:v1:001122334455:aa", home)).toThrow("Malformed");
  });

  test("detects tampered auth tag", () => {
    const encrypted = encryptSecret(randomBase32Secret(), home);
    const tampered = `${encrypted.slice(0, -2)}ff`;
    expect(() => decryptSecret(tampered, home)).toThrow();
  });
});

describe("isEncryptedSecret", () => {
  test("identifies encrypted and plaintext values", () => {
    expect(isEncryptedSecret("enc:v1:abc:def")).toBe(true);
    expect(isEncryptedSecret("not-encrypted")).toBe(false);
  });
});
