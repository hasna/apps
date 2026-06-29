import { describe, expect, test } from "bun:test";
import { generateTotp } from "../src/totp.js";
import { base32Encode } from "./helpers.js";

const RFC_BASE32_SHA1 = base32Encode(Buffer.from("12345678901234567890", "ascii"));
const RFC_BASE32_SHA256 = base32Encode(Buffer.from("12345678901234567890123456789012", "ascii"));
const RFC_BASE32_SHA512 = base32Encode(Buffer.from("1234567890123456789012345678901234567890123456789012345678901234", "ascii"));

describe("generateTotp", () => {
  test("matches RFC 6238 SHA1 vectors", () => {
    expect(generateTotp(RFC_BASE32_SHA1, { at: 59_000, digits: 8, period: 30 }).code).toBe("94287082");
    expect(generateTotp(RFC_BASE32_SHA1, { at: 1_111_111_109_000, digits: 8, period: 30 }).code).toBe("07081804");
    expect(generateTotp(RFC_BASE32_SHA1, { at: 2_000_000_000_000, digits: 8, period: 30 }).code).toBe("69279037");
  });

  test("matches RFC 6238 SHA256 and SHA512 vectors", () => {
    expect(generateTotp(RFC_BASE32_SHA256, { algorithm: "SHA256", at: 59_000, digits: 8, period: 30 }).code).toBe("46119246");
    expect(generateTotp(RFC_BASE32_SHA512, { algorithm: "SHA512", at: 59_000, digits: 8, period: 30 }).code).toBe("90693936");
  });
});
