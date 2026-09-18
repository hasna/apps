import { describe, expect, test } from "bun:test";
import type { KnowledgeSourceManifestOptions } from "../types/index.js";
import {
  decodeManifestCheckpoint,
  decodeManifestPageCursor,
  encodeManifestCheckpoint,
  encodeManifestPageCursor,
  manifestQueryFingerprint,
} from "./knowledge-manifest-cursor.js";

const SECRET = "manifest-cursor-test-secret-material";
const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const opts = { tag: "handbook", status: "active" } satisfies KnowledgeSourceManifestOptions;

describe("hosted knowledge manifest cursors", () => {
  test("preserves cursors beyond Number.MAX_SAFE_INTEGER losslessly", () => {
    const query = manifestQueryFingerprint(opts, "9007199254740992");
    const token = encodeManifestPageCursor({
      after: "9007199254740993",
      high: "9007199254741999",
      since: "9007199254740992",
      query,
    }, TENANT, SECRET);
    expect(decodeManifestPageCursor(token, TENANT, SECRET, query)).toEqual({
      after: "9007199254740993",
      high: "9007199254741999",
      since: "9007199254740992",
      query,
    });
  });

  test("binds page cursors to tenant and canonical query semantics", () => {
    const query = manifestQueryFingerprint(opts, "0");
    const token = encodeManifestPageCursor({ after: "4", high: "9", since: "0", query }, TENANT, SECRET);
    expect(() => decodeManifestPageCursor(token, OTHER_TENANT, SECRET, query)).toThrow("manifest cursor");
    const changed = manifestQueryFingerprint({ ...opts, tag: "other" }, "0");
    expect(() => decodeManifestPageCursor(token, TENANT, SECRET, changed)).toThrow("manifest cursor");
  });

  test("keeps page and checkpoint cursor kinds distinct", () => {
    const checkpoint = encodeManifestCheckpoint("12", TENANT, SECRET);
    expect(decodeManifestCheckpoint(checkpoint, TENANT, SECRET)).toBe("12");
    expect(() => decodeManifestPageCursor(checkpoint, TENANT, SECRET)).toThrow("manifest cursor");
    const query = manifestQueryFingerprint({}, "0");
    const page = encodeManifestPageCursor({ after: "1", high: "2", since: "0", query }, TENANT, SECRET);
    expect(() => decodeManifestCheckpoint(page, TENANT, SECRET)).toThrow("manifest cursor");
  });

  test("rejects malformed, oversized, noncanonical, and backward values", () => {
    expect(() => decodeManifestCheckpoint("x".repeat(2049), TENANT, SECRET)).toThrow("manifest cursor");
    expect(() => encodeManifestCheckpoint("01", TENANT, SECRET)).toThrow("manifest cursor");
    expect(() => encodeManifestPageCursor({
      after: "3",
      high: "2",
      since: "0",
      query: "a".repeat(64),
    }, TENANT, SECRET)).toThrow("manifest cursor");
  });
});
