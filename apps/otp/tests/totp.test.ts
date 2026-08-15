import { describe, expect, test } from "bun:test";
import {
  codesEqual,
  decodeBase32,
  generateTotp,
  normalizeAlgorithm,
  normalizeBase32Secret,
  normalizeDigits,
  normalizePeriod,
} from "../src/totp.js";
import { base32Encode } from "./helpers.js";

const RFC_BASE32_SHA1 = base32Encode(Buffer.from("12345678901234567890", "ascii"));
const RFC_BASE32_SHA256 = base32Encode(Buffer.from("12345678901234567890123456789012", "ascii"));
const RFC_BASE32_SHA512 = base32Encode(Buffer.from("1234567890123456789012345678901234567890123456789012345678901234", "ascii"));

const RFC4226_HOTP_VECTORS = [
  { counter: 0, code: "755224" },
  { counter: 1, code: "287082" },
  { counter: 2, code: "359152" },
  { counter: 3, code: "969429" },
  { counter: 4, code: "338314" },
  { counter: 5, code: "254676" },
  { counter: 6, code: "287922" },
  { counter: 7, code: "162583" },
  { counter: 8, code: "399871" },
];

describe("normalizeBase32Secret", () => {
  test("strips spaces, dashes, padding, and uppercases", () => {
    expect(normalizeBase32Secret("gezd gnbv g42d mjrxvill")).toBe("GEZDGNBVG42DMJRXVILL");
    expect(normalizeBase32Secret("gezd-gnbv-g42d-mjrxvill====")).toBe("GEZDGNBVG42DMJRXVILL");
  });

  test("rejects empty and invalid alphabet secrets", () => {
    expect(() => normalizeBase32Secret("   ")).toThrow("required");
    expect(() => normalizeBase32Secret("invalid0!")).toThrow("RFC 4648 base32");
  });
});

describe("decodeBase32", () => {
  test("round-trips with base32Encode helper", () => {
    const bytes = Buffer.from("hello-totp-test", "utf8");
    const encoded = base32Encode(bytes);
    expect(decodeBase32(encoded).equals(bytes)).toBe(true);
  });

  test("rejects invalid characters during decode", () => {
    expect(() => decodeBase32("GEZDGNBV0")).toThrow("RFC 4648 base32");
  });
});

describe("normalizeAlgorithm", () => {
  test("accepts supported algorithms and defaults to SHA1", () => {
    expect(normalizeAlgorithm()).toBe("SHA1");
    expect(normalizeAlgorithm("sha256")).toBe("SHA256");
    expect(normalizeAlgorithm("SHA512")).toBe("SHA512");
  });

  test("rejects unsupported algorithms", () => {
    expect(() => normalizeAlgorithm("MD5")).toThrow("SHA1, SHA256, or SHA512");
  });
});

describe("normalizeDigits", () => {
  test("defaults to 6 and accepts 6 through 8", () => {
    expect(normalizeDigits()).toBe(6);
    expect(normalizeDigits(8)).toBe(8);
  });

  test("rejects out-of-range digit counts", () => {
    expect(() => normalizeDigits(5)).toThrow("6 to 8");
    expect(() => normalizeDigits(9)).toThrow("6 to 8");
    expect(() => normalizeDigits(6.5)).toThrow("6 to 8");
  });
});

describe("normalizePeriod", () => {
  test("defaults to 30 and accepts valid periods", () => {
    expect(normalizePeriod()).toBe(30);
    expect(normalizePeriod(45)).toBe(45);
  });

  test("rejects invalid periods", () => {
    expect(() => normalizePeriod(0)).toThrow("1 to 300");
    expect(() => normalizePeriod(301)).toThrow("1 to 300");
    expect(() => normalizePeriod(30.5)).toThrow("1 to 300");
  });
});

describe("codesEqual", () => {
  test("compares equal codes and rejects length mismatches", () => {
    expect(codesEqual("123456", "123456")).toBe(true);
    expect(codesEqual("123456", "123457")).toBe(false);
    expect(codesEqual("123456", "12345")).toBe(false);
  });
});

describe("generateTotp", () => {
  test("matches RFC 6238 SHA1 vectors", () => {
    expect(generateTotp(RFC_BASE32_SHA1, { at: 59_000, digits: 8, period: 30 }).code).toBe("94287082");
    expect(generateTotp(RFC_BASE32_SHA1, { at: 1_111_111_109_000, digits: 8, period: 30 }).code).toBe("07081804");
    expect(generateTotp(RFC_BASE32_SHA1, { at: 1_111_111_110_000, digits: 8, period: 30 }).code).toBe("14050471");
    expect(generateTotp(RFC_BASE32_SHA1, { at: 1_234_567_890_000, digits: 8, period: 30 }).code).toBe("89005924");
    expect(generateTotp(RFC_BASE32_SHA1, { at: 2_000_000_000_000, digits: 8, period: 30 }).code).toBe("69279037");
    expect(generateTotp(RFC_BASE32_SHA1, { at: 20_000_000_000_000, digits: 8, period: 30 }).code).toBe("65353130");
  });

  test("matches RFC 6238 SHA256 and SHA512 vectors", () => {
    expect(generateTotp(RFC_BASE32_SHA256, { algorithm: "SHA256", at: 59_000, digits: 8, period: 30 }).code).toBe("46119246");
    expect(generateTotp(RFC_BASE32_SHA256, { algorithm: "SHA256", at: 1_111_111_109_000, digits: 8, period: 30 }).code).toBe("68084774");
    expect(generateTotp(RFC_BASE32_SHA256, { algorithm: "SHA256", at: 20_000_000_000_000, digits: 8, period: 30 }).code).toBe("77737706");
    expect(generateTotp(RFC_BASE32_SHA512, { algorithm: "SHA512", at: 59_000, digits: 8, period: 30 }).code).toBe("90693936");
    expect(generateTotp(RFC_BASE32_SHA512, { algorithm: "SHA512", at: 1_111_111_109_000, digits: 8, period: 30 }).code).toBe("25091201");
  });

  test("matches RFC 4226 HOTP vectors via counter-derived timestamps", () => {
    const period = 30;
    for (const { counter, code } of RFC4226_HOTP_VECTORS) {
      const generated = generateTotp(RFC_BASE32_SHA1, {
        at: counter * period * 1000,
        digits: 6,
        period,
      });
      expect(generated.code).toBe(code);
      expect(generated.counter).toBe(counter);
    }
  });
});
