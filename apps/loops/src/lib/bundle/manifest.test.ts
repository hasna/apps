import { describe, expect, test } from "bun:test";
import {
  assertBundleName,
  assertSafeBundlePath,
  BundleIntegrityError,
  computeBundleDigest,
  isBundleName,
  LOOP_BUNDLE_MANIFEST_SCHEMA,
  MODE_DATA,
  MODE_SCRIPT,
  requiredModeFor,
  validateBundleManifest,
  type BundleManifestFile,
} from "./manifest.js";

const loopJson: BundleManifestFile = {
  path: "loop.json",
  sha256: "a".repeat(64),
  mode: MODE_DATA,
  size: 42,
};
const script: BundleManifestFile = {
  path: "scripts/run.sh",
  sha256: "b".repeat(64),
  mode: MODE_SCRIPT,
  size: 17,
};

function manifest(files: BundleManifestFile[] = [loopJson, script], overrides: Record<string, unknown> = {}) {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : 1));
  return {
    schema: LOOP_BUNDLE_MANIFEST_SCHEMA,
    version: 1,
    loopId: "lp_1",
    name: "demo",
    bundleDigest: computeBundleDigest(sorted),
    createdAt: "2026-09-04T00:00:00.000Z",
    files: sorted,
    source: { station: "station03", agent: "station03-fable" },
    ...overrides,
  };
}

describe("bundle names", () => {
  test.each(["a", "demo", "pr-drain", "a.b_c-1", `a${"b".repeat(126)}c`])("accepts %s", (name) => {
    expect(isBundleName(name)).toBe(true);
  });

  test.each(["", ".", "..", "-demo", "demo-", "Demo", "de mo", "demo/sub", "a".repeat(200)])("rejects %s", (name) => {
    expect(isBundleName(name)).toBe(false);
    expect(() => assertBundleName(name)).toThrow(BundleIntegrityError);
  });
});

describe("bundle paths", () => {
  test.each([
    ["../escape", "'..'"],
    ["/etc/passwd", "absolute"],
    ["a\\b", "backslash"],
    ["a\0b", "NUL"],
    ["./a", "'.'"],
    ["a//b", "empty"],
    ["C:/win", "drive"],
  ])("refuses %s", (path) => {
    expect(() => assertSafeBundlePath(path)).toThrow(BundleIntegrityError);
  });

  test("accepts an ordinary nested path", () => {
    expect(assertSafeBundlePath("scripts/nested/run.sh")).toBe("scripts/nested/run.sh");
  });

  test("mode is decided by the scripts/ prefix, not by the file's own bits", () => {
    expect(requiredModeFor("scripts/run.sh")).toBe(MODE_SCRIPT);
    expect(requiredModeFor("scripts")).toBe(MODE_SCRIPT);
    expect(requiredModeFor("scriptsy/run.sh")).toBe(MODE_DATA);
    // macOS resolves Scripts/ and scripts/ to one directory, so the prefix
    // match is case-insensitive; otherwise one spelling could claim the
    // executable directory while validating as inert data.
    expect(requiredModeFor("Scripts/run.sh")).toBe(MODE_SCRIPT);
    expect(requiredModeFor("README.md")).toBe(MODE_DATA);
  });
});

describe("bundleDigest", () => {
  test("is stable across two computations of the same file set", () => {
    expect(computeBundleDigest([loopJson, script])).toBe(computeBundleDigest([script, loopJson]));
  });

  test("changes when content changes", () => {
    const changed = { ...script, sha256: "c".repeat(64) };
    expect(computeBundleDigest([loopJson, changed])).not.toBe(computeBundleDigest([loopJson, script]));
  });

  test("changes when a mode changes", () => {
    // A script that lost its executable bit is a real change; a content-only
    // digest would call the two trees identical.
    const demoted = { ...script, path: "notes.txt", mode: MODE_DATA };
    const promoted = { ...script, path: "notes.txt", mode: MODE_SCRIPT };
    expect(computeBundleDigest([loopJson, demoted])).not.toBe(computeBundleDigest([loopJson, promoted]));
  });

  test("changes when a file is renamed", () => {
    expect(computeBundleDigest([loopJson, { ...script, path: "scripts/other.sh" }])).not.toBe(
      computeBundleDigest([loopJson, script]),
    );
  });
});

describe("validateBundleManifest", () => {
  test("accepts a well-formed manifest and normalises createdAt", () => {
    const parsed = validateBundleManifest(manifest());
    expect(parsed.name).toBe("demo");
    expect(parsed.files.map((file) => file.path)).toEqual(["loop.json", "scripts/run.sh"]);
    expect(parsed.createdAt).toBe("2026-09-04T00:00:00.000Z");
  });

  test.each([
    ["a wrong schema tag", manifest([loopJson, script], { schema: "nope" })],
    ["a negative version", manifest([loopJson, script], { version: -1 })],
    ["an unusable bundle name", manifest([loopJson, script], { name: "Demo" })],
    ["a malformed createdAt", manifest([loopJson, script], { createdAt: "not-a-date" })],
    ["an empty file list", manifest([loopJson, script], { files: [] })],
    ["a missing loop.json", manifest([script])],
    ["a missing source.station", manifest([loopJson, script], { source: { agent: "x" } })],
  ])("refuses %s", (_label, value) => {
    expect(() => validateBundleManifest(value)).toThrow(BundleIntegrityError);
  });

  test("refuses a manifest that lists itself", () => {
    const selfListing = manifest([loopJson, { ...script, path: "manifest.json", mode: MODE_DATA }]);
    expect(() => validateBundleManifest(selfListing)).toThrow(/manifest.json/);
  });

  test("refuses a mode that disagrees with the path", () => {
    const wrongMode = manifest([loopJson, { ...script, mode: MODE_DATA }]);
    expect(() => validateBundleManifest(wrongMode)).toThrow(/scripts/);
  });

  test("refuses an out-of-order file list", () => {
    const unsorted = { ...manifest(), files: [script, loopJson] };
    expect(() => validateBundleManifest(unsorted)).toThrow(/sorted/);
  });

  test("refuses a case-duplicate path", () => {
    const dupes = [loopJson, script, { ...script, path: "Scripts/run.sh" }].sort((a, b) => (a.path < b.path ? -1 : 1));
    expect(() => validateBundleManifest({ ...manifest(), files: dupes, bundleDigest: computeBundleDigest(dupes) })).toThrow(/duplicate/);
  });

  test("refuses a declared digest that disagrees with its own file list", () => {
    const lying = manifest([loopJson, script], { bundleDigest: `sha256:${"0".repeat(64)}` });
    expect(() => validateBundleManifest(lying)).toThrow(/does not match its own file list/);
  });
});
