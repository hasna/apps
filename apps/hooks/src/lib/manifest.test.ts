/**
 * Regression tests for manifest script path containment (P1-2).
 *
 * A manifest's script must resolve inside the hook's own directory. Escaping
 * paths (../, absolute, symlink to outside) must refuse with a clear error
 * naming the offending path, and the write path must never create a file
 * outside the hook directory.
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resolveScript, writeCustomHook, readCustomManifest, ScriptContainmentError, type HookManifest } from "./manifest.js";

const TEST_DIR = mkdtempSync(join(tmpdir(), "hooks-manifest-test-"));

function manifest(script: string): HookManifest {
  return { name: "demo", version: "1.0.0", events: ["PostToolUse"], script };
}

beforeAll(() => {
  process.env.HASNA_HOOKS_DATA_DIR = TEST_DIR;
});

afterAll(() => {
  delete process.env.HASNA_HOOKS_DATA_DIR;
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("resolveScript containment", () => {
  test("refuses a script path that escapes via ../", () => {
    const dir = join(TEST_DIR, "src-a");
    mkdirSync(dir, { recursive: true });
    const err = (() => {
      try {
        resolveScript(manifest("../escape.sh"), dir);
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(ScriptContainmentError);
    expect(String(err)).toContain("../escape.sh");
    expect(String(err)).toContain(dir);
  });

  test("refuses an absolute script path", () => {
    const dir = join(TEST_DIR, "src-b");
    mkdirSync(dir, { recursive: true });
    expect(() => resolveScript(manifest("/tmp/escape.sh"), dir)).toThrow(/must be relative or inline/);
  });

  test("refuses a symlink inside the hook dir that points outside", () => {
    const outside = join(TEST_DIR, "outside-target.ts");
    writeFileSync(outside, "export {};\n");
    const dir = join(TEST_DIR, "src-c");
    mkdirSync(dir, { recursive: true });
    symlinkSync(outside, join(dir, "linked.ts"));
    expect(() => resolveScript(manifest("linked.ts"), dir)).toThrow(ScriptContainmentError);
  });

  test("still resolves a contained relative script", () => {
    const dir = join(TEST_DIR, "src-ok");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "tool.ts"), "export default 1;\n");
    const res = resolveScript(manifest("tool.ts"), dir);
    expect(res.content).toBe("export default 1;\n");
  });
});

describe("writeCustomHook containment", () => {
  test("refuses ../ escape before writing anything", () => {
    const hookManifest = { ...manifest("../escape.sh"), name: "escape" };
    expect(() => writeCustomHook("escape", hookManifest, "echo pwned", "../escape.sh")).toThrow(ScriptContainmentError);
    expect(existsSync(join(TEST_DIR, "escape.sh"))).toBe(false);
    expect(existsSync(join(TEST_DIR, "hooks", "escape"))).toBe(false);
  });

  test("refuses an absolute script path", () => {
    const hookManifest = { ...manifest("script.ts"), name: "abs-escape" };
    expect(() => writeCustomHook("abs-escape", hookManifest, "echo pwned", "/outside/escape.sh")).toThrow(
      ScriptContainmentError,
    );
    expect(existsSync(join(TEST_DIR, "hooks", "abs-escape"))).toBe(false);
  });

  test("refuses a hook-dir symlink that points outside", () => {
    const hookDir = join(TEST_DIR, "hooks", "sym-escape");
    mkdirSync(hookDir, { recursive: true });
    const outsideDir = join(TEST_DIR, "outside-dir");
    mkdirSync(outsideDir, { recursive: true });
    symlinkSync(outsideDir, join(hookDir, "sub"));
    const hookManifest = { ...manifest("sub/escape.sh"), name: "sym-escape" };
    expect(() => writeCustomHook("sym-escape", hookManifest, "echo pwned", "sub/escape.sh")).toThrow(
      ScriptContainmentError,
    );
    expect(existsSync(join(outsideDir, "escape.sh"))).toBe(false);
  });

  test("still writes a contained nested script path", () => {
    const hookManifest = { ...manifest("sub/tool.ts"), name: "ok-hook" };
    const res = writeCustomHook("ok-hook", hookManifest, "export default 1;\n", "sub/tool.ts");
    expect(existsSync(res.scriptPath)).toBe(true);
    expect(existsSync(join(res.dir, "manifest.json"))).toBe(true);
  });
});

describe("readCustomManifest containment", () => {
  test("surfaces a containment violation instead of hiding it as 'not found'", () => {
    const dir = join(TEST_DIR, "hooks", "evil");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "manifest.json"),
      JSON.stringify({ name: "evil", version: "1.0.0", events: ["PostToolUse"], script: "../escape.sh" }),
    );
    expect(() => readCustomManifest("evil")).toThrow(ScriptContainmentError);
  });
});
