// Agent-authored test-gap analysis (no SOL spec): the SOL consult (gpt-5.6-sol,
// max reasoning) was admitted but produced no answer within its bounds, so this
// file was authored by the writing agent and must not be attributed to SOL.
//
// Target: src/packed-artifact.ts — the archive plumbing shared by the no-cloud
// runtime guard and the published-artifact guard. The security claim is that a
// hand-rolled archive cannot have its paths rewritten and that members outside
// the single `package/` root are preserved, so a leak has nowhere to hide.
// These tests pin the pure path-normalization logic only — no tar execution,
// no network, deterministic inputs.

import { describe, expect, test } from "bun:test";
import {
  MAX_ARCHIVE_MEMBER_BYTES,
  MAX_SCANNED_MEMBER_BYTES,
  commonArchiveRoot,
  isPackedArtifactPath,
  normalizeArchiveEntry,
} from "../src/packed-artifact";

describe("isPackedArtifactPath", () => {
  test("accepts .tgz and .tar.gz suffixes", () => {
    expect(isPackedArtifactPath("pkg.tgz")).toBe(true);
    expect(isPackedArtifactPath("pkg.tar.gz")).toBe(true);
    expect(isPackedArtifactPath("dir/pkg-1.0.0.tgz")).toBe(true);
  });

  test("is case-insensitive", () => {
    expect(isPackedArtifactPath("PKG.TGZ")).toBe(true);
    expect(isPackedArtifactPath("Pkg.Tar.Gz")).toBe(true);
  });

  test("rejects other suffixes and extension lookalikes", () => {
    expect(isPackedArtifactPath("pkg.zip")).toBe(false);
    expect(isPackedArtifactPath("pkg.tar")).toBe(false);
    expect(isPackedArtifactPath("pkg.tgz/extra")).toBe(false);
    expect(isPackedArtifactPath("pkg")).toBe(false);
    expect(isPackedArtifactPath("")).toBe(false);
  });
});

describe("commonArchiveRoot", () => {
  test("returns the single shared top-level directory", () => {
    expect(commonArchiveRoot(["package/package.json", "package/dist/index.js"])).toBe("package");
  });

  test("strips ./ and leading-slash prefixes before deciding", () => {
    expect(commonArchiveRoot(["./package/package.json", "package/dist/index.js"])).toBe("package");
    expect(commonArchiveRoot(["/package/package.json"])).toBe("package");
  });

  test("skips directory-only entries", () => {
    expect(commonArchiveRoot(["package/", "package/x"])).toBe("package");
  });

  test("returns null when members do not share one root", () => {
    expect(commonArchiveRoot(["package/a.js", "other/b.js"])).toBeNull();
    expect(commonArchiveRoot(["a/x", "a/y", "b/z"])).toBeNull();
  });

  test("returns null for a bare root entry with no file beneath it", () => {
    expect(commonArchiveRoot(["package", "package/x"])).toBeNull();
  });

  test("returns null for an empty list and for directories only", () => {
    expect(commonArchiveRoot([])).toBeNull();
    expect(commonArchiveRoot(["package/"])).toBeNull();
  });

  test("returns the first segment when every entry shares it", () => {
    expect(commonArchiveRoot(["a/b", "a/c"])).toBe("a");
  });
});

describe("normalizeArchiveEntry", () => {
  test("strips the common root", () => {
    expect(normalizeArchiveEntry("package/package.json", "package")).toBe("package.json");
    expect(normalizeArchiveEntry("package/dist/index.js", "package")).toBe("dist/index.js");
  });

  test("falls back to stripping the npm package/ prefix when no common root", () => {
    expect(normalizeArchiveEntry("package/package.json", null)).toBe("package.json");
  });

  test("normalizes ./ and leading-slash spellings", () => {
    expect(normalizeArchiveEntry("./package/package.json", "package")).toBe("package.json");
    expect(normalizeArchiveEntry("/package/x", "package")).toBe("x");
  });

  test("returns null for the root itself and for directories", () => {
    expect(normalizeArchiveEntry("package", "package")).toBeNull();
    expect(normalizeArchiveEntry("package/", "package")).toBeNull();
    expect(normalizeArchiveEntry("", null)).toBeNull();
  });

  test("preserves members outside the root instead of rewriting them", () => {
    // The security property: a hand-rolled archive whose members do not sit
    // under `package/` keeps its paths — returning null would let a member be
    // silently dropped from the scan.
    expect(normalizeArchiveEntry("other/x", "package")).toBe("other/x");
    expect(normalizeArchiveEntry("dist/index.js", "package")).toBe("dist/index.js");
  });

  test("strips a leading package/ prefix on an otherwise untouched entry", () => {
    expect(normalizeArchiveEntry("package/x", "other")).toBe("x");
  });
});

describe("archive size bounds", () => {
  test("the default buffered-read cap is 5 MiB and the scan cap is 512 MiB", () => {
    expect(MAX_ARCHIVE_MEMBER_BYTES).toBe(5 * 1024 * 1024);
    expect(MAX_SCANNED_MEMBER_BYTES).toBe(512 * 1024 * 1024);
  });

  test("the scan cap is strictly larger than the default cap", () => {
    expect(MAX_SCANNED_MEMBER_BYTES).toBeGreaterThan(MAX_ARCHIVE_MEMBER_BYTES);
  });
});
