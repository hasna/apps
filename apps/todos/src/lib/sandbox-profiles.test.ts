import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  checkSandboxCommand,
  loadSandboxProfiles,
  saveSandboxProfiles,
  resetSandboxProfileCache,
  getDefaultSandboxProfiles,
} from "./sandbox-profiles.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "sandbox-test-"));
  mkdirSync(join(tempDir, ".todos"), { recursive: true });
  process.env["TODOS_SANDBOX_PROFILES_PATH"] = join(tempDir, ".todos", "sandbox-profiles.json");
  resetSandboxProfileCache();
});

afterEach(() => {
  resetSandboxProfileCache();
  delete process.env["TODOS_SANDBOX_PROFILES_PATH"];
  rmSync(tempDir, { recursive: true, force: true });
});

describe("checkSandboxCommand", () => {
  it("allows bun test in default profile", () => {
    const result = checkSandboxCommand({ command: "bun test src/foo.test.ts" });
    expect(result.allowed).toBe(true);
  });

  it("denies curl in default profile", () => {
    const result = checkSandboxCommand({ command: "curl https://example.com" });
    expect(result.allowed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("redacts sensitive env keys", () => {
    const result = checkSandboxCommand({
      command: "bun test",
      env: { API_KEY: "secret", PATH: "/usr/bin" },
    });
    expect(result.redacted_env?.API_KEY).toBe("[REDACTED]");
    expect(result.redacted_env?.PATH).toBe("/usr/bin");
  });

  it("dry-run adds explanation", () => {
    const result = checkSandboxCommand({ command: "bun test" }, "default", true);
    expect(result.explanations.some((e) => e.includes("Dry-run"))).toBe(true);
  });
});

describe("sandbox config", () => {
  it("loads custom profiles", () => {
    saveSandboxProfiles([{ name: "tiny", version: 1, allow_commands: ["echo"], deny_commands: [] }]);
    resetSandboxProfileCache();
    expect(loadSandboxProfiles()[0]!.name).toBe("tiny");
  });

  it("default profiles are local-only", () => {
    for (const p of getDefaultSandboxProfiles()) {
      expect(JSON.stringify(p)).not.toMatch(/todos\.md|cloudflare|platform-todos/i);
    }
  });
});
