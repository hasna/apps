import { describe, expect, test } from "bun:test";
import { canonicalIndexString, signIndex, verifyIndexSignature, INDEX_SIGNATURE_VERSION } from "./sign.js";

describe("estate-sync index signing", () => {
  const entry: Record<string, unknown> = {
    schemaVersion: 1,
    name: "pdf-generate",
    digest: "a".repeat(64),
    sizeBytes: 10,
    updatedAt: "2026-08-24T00:00:00.000Z",
  };

  test("a signature verifies against the same key", () => {
    const signature = signIndex(entry, "key-1");
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyIndexSignature({ ...entry, signature }, "key-1")).toBe(true);
  });

  test("a signature does not verify against a different key", () => {
    const signature = signIndex(entry, "key-1");
    expect(verifyIndexSignature({ ...entry, signature }, "key-2")).toBe(false);
  });

  test("an entry with no signature fails verification (fail-closed)", () => {
    expect(verifyIndexSignature(entry, "key-1")).toBe(false);
  });

  test("canonicalization ignores the signature fields and is deterministic", () => {
    const withSig = { ...entry, signature: "deadbeef", signingKeyId: "v1" };
    const without = { ...entry };
    expect(canonicalIndexString(withSig)).toBe(canonicalIndexString(without));
    expect(canonicalIndexString({ b: 2, a: 1 })).toBe(canonicalIndexString({ a: 1, b: 2 }));
  });

  test("INDEX_SIGNATURE_VERSION is stable", () => {
    expect(INDEX_SIGNATURE_VERSION).toBe("v1");
  });
});
