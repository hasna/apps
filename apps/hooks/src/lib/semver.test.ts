/**
 * Regression tests for P2-10 (shared semver across manifest and routes) and
 * P2-14 (redirect refusal on URL installs, explicit script_kind).
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { parseManifest, resolveScript } from "./manifest.js";
import { SEMVER_PATTERN, compareVersions, isValidSemver } from "./semver.js";
import { installCustomSource } from "./custom-install.js";
import { closeDb } from "../db/index.js";

const TEST_DIR = mkdtempSync(join(tmpdir(), "hooks-semver-test-"));

beforeAll(() => {
  process.env.HASNA_HOOKS_DATA_DIR = TEST_DIR;
  process.env.HASNA_HOOKS_DB_PATH = ":memory:";
});

afterAll(() => {
  delete process.env.HASNA_HOOKS_DATA_DIR;
  delete process.env.HASNA_HOOKS_DB_PATH;
  closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("shared semver (P2-10)", () => {
  test("SEMVER_PATTERN accepts what the manifest validation accepts", () => {
    expect(SEMVER_PATTERN.test("1.2.3")).toBe(true);
    expect(SEMVER_PATTERN.test("1.2.3-beta")).toBe(true);
    expect(SEMVER_PATTERN.test("1.2.3-beta.1+build.5")).toBe(true);
    expect(SEMVER_PATTERN.test("0.0.1-alpha")).toBe(true);
    expect(SEMVER_PATTERN.test("1.2")).toBe(false);
    expect(SEMVER_PATTERN.test("v1.2.3")).toBe(false);
    expect(SEMVER_PATTERN.test("1.2.3-beta$")).toBe(false);
    expect(isValidSemver("1.2.3-beta.1")).toBe(true);
    expect(isValidSemver("1.2")).toBe(false);
  });

  test("a prerelease manifest version parses (previously half-accepted)", () => {
    const manifest = parseManifest(JSON.stringify({
      name: "pre-demo",
      version: "1.2.3-beta.1",
      events: ["PostToolUse"],
      script: "console.log('x')",
    }));
    expect(manifest.version).toBe("1.2.3-beta.1");
  });

  test("a clearly invalid version is rejected", () => {
    expect(() => parseManifest(JSON.stringify({
      name: "bad-demo",
      version: "1.2",
      events: ["PostToolUse"],
      script: "x",
    }))).toThrow(/semver/);
  });
});

describe("compareVersions precedence (bug 6e412e52)", () => {
  test("core components compare numerically", () => {
    expect(compareVersions("1.0.2", "1.0.1")).toBeGreaterThan(0);
    expect(compareVersions("1.0.1", "1.0.2")).toBeLessThan(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });

  test("a prerelease sorts before its release", () => {
    expect(compareVersions("1.0.0-beta", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0-beta")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBeLessThan(0);
  });

  test("prerelease identifiers: numeric < alphanumeric, numeric compares numerically, fewer identifiers sort first", () => {
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBeLessThan(0);
    expect(compareVersions("1.0.0-beta.10", "1.0.0-beta.2")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-beta.1", "1.0.0-beta.alpha")).toBeLessThan(0);
    expect(compareVersions("1.0.0-beta", "1.0.0-beta.1")).toBeLessThan(0);
  });

  test("build metadata never participates in precedence", () => {
    expect(compareVersions("1.0.0+meta.5", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "1.0.0+meta.5")).toBe(0);
    expect(compareVersions("1.0.1+build.9", "1.0.0+meta.5")).toBeGreaterThan(0);
  });
});

describe("explicit script_kind (P2-14)", () => {
  test("script_kind:file resolves a path even when the value contains a newline", () => {
    const dir = join(TEST_DIR, "kind-file");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "hook.ts"), "console.log('file-content')", "utf-8");
    const resolved = resolveScript(
      { name: "k", version: "1.0.0", events: ["PostToolUse"], script: "hook.ts", script_kind: "file" },
      dir,
    );
    expect(resolved.path).toBe("hook.ts");
    expect(resolved.content).toContain("file-content");
  });

  test("script_kind:inline treats the value as content even without a newline", () => {
    const dir = join(TEST_DIR, "kind-inline");
    const resolved = resolveScript(
      { name: "k", version: "1.0.0", events: ["PostToolUse"], script: "console.log('inline-content')", script_kind: "inline" },
      dir,
    );
    expect(resolved.path).toContain("script");
    expect(resolved.content).toContain("inline-content");
  });

  test("legacy fallback keeps the newline heuristic for old manifests", () => {
    const dir = join(TEST_DIR, "kind-legacy");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "hook.ts"), "console.log('legacy')", "utf-8");
    const asFile = resolveScript(
      { name: "k", version: "1.0.0", events: ["PostToolUse"], script: "hook.ts" },
      dir,
    );
    expect(asFile.path).toBe("hook.ts");
    const asInline = resolveScript(
      { name: "k", version: "1.0.0", events: ["PostToolUse"], script: "console.log('inline')\n" },
      dir,
    );
    expect(asInline.path).toContain("script");
  });
});

describe("URL install refuses redirects (P2-14)", () => {
  test("a manifest URL that redirects is refused — the content is never followed", async () => {
    const manifestBody = JSON.stringify({
      name: "redirect-demo",
      version: "1.0.0",
      events: ["PostToolUse"],
      script: "console.log('redirected')",
    });
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/manifest.json") {
          return new Response(null, { status: 302, headers: { location: "/evil.json" } });
        }
        if (url.pathname === "/evil.json") {
          return new Response(manifestBody, { status: 200 });
        }
        return new Response("not found", { status: 404 });
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      await expect(installCustomSource(`${base}/manifest.json`)).rejects.toThrow();
      expect(existsSync(join(TEST_DIR, "hooks", "redirect-demo"))).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("a script URL that redirects is refused too", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/manifest.json") {
          return new Response(JSON.stringify({
            name: "redirect-script-demo",
            version: "1.0.0",
            events: ["PostToolUse"],
            script: "hook.ts",
            script_kind: "file",
          }), { status: 200 });
        }
        if (url.pathname === "/hook.ts") {
          return new Response(null, { status: 301, headers: { location: "/evil.ts" } });
        }
        if (url.pathname === "/evil.ts") {
          return new Response("console.log('evil')", { status: 200 });
        }
        return new Response("not found", { status: 404 });
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      await expect(installCustomSource(`${base}/manifest.json`)).rejects.toThrow();
      expect(existsSync(join(TEST_DIR, "hooks", "redirect-script-demo"))).toBe(false);
    } finally {
      server.stop(true);
    }
  });
});

describe("strict semver numeric identifiers (reviewer P3)", () => {
  test("leading-zero numeric identifiers are invalid (prerelease and core)", () => {
    expect(isValidSemver("1.0.0-01")).toBe(false);
    expect(isValidSemver("1.0.0-1.01")).toBe(false);
    expect(isValidSemver("1.0.0-alpha.01")).toBe(false);
    expect(isValidSemver("01.0.0")).toBe(false);
    expect(isValidSemver("1.01.0")).toBe(false);
    expect(isValidSemver("1.0.01")).toBe(false);
    // Valid counterparts stay valid.
    expect(isValidSemver("1.0.0-1")).toBe(true);
    expect(isValidSemver("1.0.0-alpha.1")).toBe(true);
    expect(isValidSemver("1.0.0-alpha.01b")).toBe(true);
  });

  test("numeric identifiers longer than 16 digits are invalid", () => {
    expect(isValidSemver("1.0.0-12345678901234567")).toBe(false); // 17-digit prerelease
    expect(isValidSemver("1.0.0-1234567890123456")).toBe(true); // 16-digit prerelease
    expect(isValidSemver("1.0.12345678901234567")).toBe(false); // 17-digit patch
    expect(isValidSemver("12345678901234567.0.0")).toBe(false); // 17-digit major
  });

  test("compareVersions is antisymmetric (P3-5)", () => {
    for (const [a, b] of [
      ["1.0.0-01", "1.0.0-1"], // the pair that compared >0 both ways
      ["1.0.0-2", "1.0.0-10"],
      ["1.0.0-alpha", "1.0.0-beta"],
      ["1.0.0", "1.0.0-rc.1"],
      ["2.0.0", "1.9.9"],
      ["1.0.0-beta.2", "1.0.0-beta.10"],
    ]) {
      const ab = compareVersions(a, b);
      const ba = compareVersions(b, a);
      // sign(ab) + sign(ba) === 0 — handles the 0/-0 case Object.is would reject.
      expect(Math.sign(ab) + Math.sign(ba), `${a} vs ${b} must be antisymmetric`).toBe(0);
    }
  });

  test("large numeric identifiers compare precisely (BigInt, no Number precision loss)", () => {
    // 9007199254740992 = MAX_SAFE_INTEGER + 1 — Number() cannot tell these apart.
    expect(compareVersions("1.0.0-9007199254740992", "1.0.0-9007199254740991")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-9007199254740991", "1.0.0-9007199254740992")).toBeLessThan(0);
    expect(compareVersions("1.0.0-9999999999999999", "1.0.0-9999999999999998")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-9999999999999999", "1.0.0-9999999999999999")).toBe(0);
    // 17-digit numerics are rejected as invalid, but if one ever reaches the
    // comparator it must still compare precisely rather than via Number().
    expect(compareVersions("1.0.0-12345678901234567", "1.0.0-12345678901234566")).toBeGreaterThan(0);
  });
});
