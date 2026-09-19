import { describe, expect, it } from "bun:test";
import {
  ARTIFACT_MANIFEST_SCHEMA,
  ATTACHMENTS_KIND,
  ATTACHMENTS_OWNER,
  buildArtifactManifest,
  canonicalBlobKey,
  isCanonicalKey,
  isLegacyObjectKey,
  isSha256Hex,
  isStagingKey,
  manifestKey,
  sha256File,
  sha256Hex,
  stagingKey,
} from "./artifact-keys";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("artifact-keys — canonical content-addressed layout", () => {
  it("builds <kind>/<owner>/<sha256>[.<ext>] keys", () => {
    const sha = "a".repeat(64);
    expect(canonicalBlobKey(sha, "report.pdf")).toBe(`attachments/global/${sha}.pdf`);
    expect(canonicalBlobKey(sha, "NOEXT")).toBe(`attachments/global/${sha}`);
  });

  it("keeps only a bounded, lowercased extension", () => {
    const sha = "b".repeat(64);
    expect(canonicalBlobKey(sha, "DOC.PDF")).toBe(`attachments/global/${sha}.pdf`);
    const long = canonicalBlobKey(sha, `x.${"e".repeat(60)}`);
    // The cap is 24 chars including the leading dot.
    expect(long.endsWith(`.${"e".repeat(23)}`)).toBe(true);
  });

  it("derives the same key for the same digest regardless of filename", () => {
    const sha = "c".repeat(64);
    expect(canonicalBlobKey(sha, "a.txt")).toBe(canonicalBlobKey(sha, "b.txt"));
  });

  it("refuses non-sha256 digests instead of minting a key from them", () => {
    for (const bad of ["", "abc", "A".repeat(64), "zz".repeat(32), "sha256:" + "a".repeat(64)]) {
      expect(() => canonicalBlobKey(bad, "x.bin")).toThrow(/sha-256/);
    }
  });

  it("isSha256Hex validates lowercase hex digests", () => {
    expect(isSha256Hex("a".repeat(64))).toBe(true);
    expect(isSha256Hex("A".repeat(64))).toBe(false);
    expect(isSha256Hex("a".repeat(63))).toBe(false);
  });

  it("classifies legacy, staging and canonical keys", () => {
    expect(isLegacyObjectKey("attachments/2026-07-14/att_abc123/deadbeef.pdf")).toBe(true);
    expect(isLegacyObjectKey(`attachments/global/${"a".repeat(64)}.pdf`)).toBe(false);
    expect(isLegacyObjectKey("attachments/999-1-1/att_x/f")).toBe(false); // no zero-padded date

    const staging = stagingKey("att_x");
    expect(staging).toBe("attachments/global/uploads/att_x");
    expect(isStagingKey(staging)).toBe(true);
    expect(isCanonicalKey(staging)).toBe(false);

    const canonical = `attachments/global/${"b".repeat(64)}.txt`;
    expect(isCanonicalKey(canonical)).toBe(true);
    expect(isStagingKey(canonical)).toBe(false);
  });

  it("mints immutable manifest keys under kind/owner/manifests", () => {
    expect(manifestKey("att_1")).toBe("attachments/global/manifests/att_1.json");
  });

  it("builds a manifest carrying the content address and provenance summary", () => {
    const sha = "d".repeat(64);
    const manifest = buildArtifactManifest({
      id: "att_1",
      sha256: sha,
      byteSize: 42,
      contentType: "text/plain",
      filename: "note.txt",
      createdAt: 1234,
      storageKey: canonicalBlobKey(sha, "note.txt"),
    });
    expect(manifest.schema).toBe(ARTIFACT_MANIFEST_SCHEMA);
    expect(manifest.app).toBe("attachments");
    expect(manifest.kind).toBe(ATTACHMENTS_KIND);
    expect(manifest.owner).toBe(ATTACHMENTS_OWNER);
    expect(manifest.storageKey).toBe(`attachments/global/${sha}.txt`);
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
  });

  it("hashes bytes and files to the same digest", async () => {
    const dir = mkdtempSync(join(tmpdir(), "artifact-keys-"));
    try {
      const path = join(dir, "data.bin");
      writeFileSync(path, Buffer.from("content-addressed bytes"));
      expect(await sha256File(path)).toBe(sha256Hex(Buffer.from("content-addressed bytes")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});