import { describe, expect, test } from "bun:test";
import { tamperApiKeySignature } from "./helpers/tamper-api-key-signature";

// Synthetic signature bytes, not credentials. The helper must preserve this
// signing input verbatim; verification of real tokens stays in the auth suites.
const SIGNING_INPUT = "hasna_todos_fixture";

function expectSingleByteTamper(token: string): void {
  const [input, encoded] = token.split(".");
  const before = Buffer.from(encoded!, "base64url");
  const tampered = tamperApiKeySignature(token);
  const [afterInput, afterEncoded] = tampered.split(".");
  const after = Buffer.from(afterEncoded!, "base64url");
  const expected = Buffer.from(before);
  expected[0] = expected[0]! ^ 1;

  expect(afterInput).toBe(input);
  expect(after.length).toBe(32);
  expect(after.equals(before)).toBe(false);
  expect(after.equals(expected)).toBe(true);
  expect(afterEncoded).toBe(after.toString("base64url"));
}

describe("API-key signature tamper test control", () => {
  test("changes signature bytes even when aY -> aa changes only unused pad bits", () => {
    const canonical = `${"A".repeat(41)}aY`;
    const alias = `${canonical.slice(0, -2)}aa`;
    expect(alias === canonical).toBe(false);
    expect(Buffer.from(alias, "base64url").equals(Buffer.from(canonical, "base64url"))).toBe(true);
    expect(Buffer.from(alias, "base64url").toString("base64url")).toBe(canonical);

    expectSingleByteTamper(`${SIGNING_INPUT}.${canonical}`);
    expectSingleByteTamper(`${SIGNING_INPUT}.${alias}`);
  });

  test("changes bytes when replacing a signature suffix with AAAA would do nothing", () => {
    const token = `${SIGNING_INPUT}.${Buffer.alloc(32).toString("base64url")}`;
    expect(`${token.slice(0, -4)}AAAA` === token).toBe(true);
    expectSingleByteTamper(token);
  });

  test("flips exactly one bit for every possible final signature byte", () => {
    // Exhaustive and deterministic, not a retry-until-the-random-test-passes loop.
    for (let finalByte = 0; finalByte < 256; finalByte++) {
      const signature = Buffer.alloc(32, 0x5a);
      signature[31] = finalByte;
      expectSingleByteTamper(`${SIGNING_INPUT}.${signature.toString("base64url")}`);
    }
  });

  test("refuses fixtures without a 32-byte signature", () => {
    for (const token of ["no-separator", `${SIGNING_INPUT}.`, `${SIGNING_INPUT}.YQ`]) {
      expect(() => tamperApiKeySignature(token)).toThrow("Expected a 32-byte API-key signature fixture.");
    }
  });
});
