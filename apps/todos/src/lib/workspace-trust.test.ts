import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  checkPermission,
  assertPermission,
  getDefaultWorkspaceTrustProfiles,
  loadWorkspaceTrustConfig,
  resetWorkspaceTrustCache,
  trustWorkspace,
  WorkspacePermissionError,
} from "./workspace-trust.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "trust-test-"));
  mkdirSync(join(tempDir, ".todos"), { recursive: true });
  process.env["TODOS_WORKSPACE_TRUST_PATH"] = join(tempDir, ".todos", "workspace-trust.json");
  resetWorkspaceTrustCache();
});

afterEach(() => {
  resetWorkspaceTrustCache();
  delete process.env["TODOS_WORKSPACE_TRUST_PATH"];
  rmSync(tempDir, { recursive: true, force: true });
});

describe("workspace trust profiles", () => {
  it("read_only allows read but denies write", () => {
    expect(checkPermission("task:read", { profile: "read_only" }).allowed).toBe(true);
    expect(checkPermission("task:write", { profile: "read_only" }).allowed).toBe(false);
  });

  it("agent_safe allows complete but denies delete", () => {
    expect(checkPermission("task:complete", { profile: "agent_safe" }).allowed).toBe(true);
    expect(checkPermission("task:delete", { profile: "agent_safe" }).allowed).toBe(false);
  });

  it("admin allows all operations", () => {
    expect(checkPermission("admin", { profile: "admin" }).allowed).toBe(true);
    expect(checkPermission("task:delete", { profile: "admin" }).allowed).toBe(true);
  });

  it("assertPermission throws clear errors", () => {
    expect(() => assertPermission("task:delete", { profile: "read_only" })).toThrow(WorkspacePermissionError);
  });

  it("trusted workspace list can restrict cwd", () => {
    trustWorkspace("/only/this/path");
    resetWorkspaceTrustCache();
    expect(checkPermission("task:read", { profile: "admin", cwd: tempDir }).allowed).toBe(false);
    expect(checkPermission("task:read", { profile: "admin", cwd: "/only/this/path/sub" }).allowed).toBe(true);
  });

  it("default profiles are local-only", () => {
    for (const p of getDefaultWorkspaceTrustProfiles()) {
      expect(JSON.stringify(p)).not.toMatch(/platform-todos|oauth|cloudflare/i);
    }
    expect(loadWorkspaceTrustConfig().default_profile).toBe("agent_safe");
  });
});
