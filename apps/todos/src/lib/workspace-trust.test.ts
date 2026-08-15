import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetConfig } from "./config.js";
import {
  checkWorkspacePermission,
  getWorkspaceTrustStatus,
  listWorkspaceTrustProfiles,
  removeWorkspaceTrustProfile,
  upsertWorkspaceTrustProfile,
} from "./workspace-trust.js";

let home: string;
let previousHome: string | undefined;

beforeEach(() => {
  previousHome = process.env["HOME"];
  home = mkdtempSync(join(tmpdir(), "todos-trust-home-"));
  process.env["HOME"] = home;
  resetConfig();
});

afterEach(() => {
  if (previousHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = previousHome;
  resetConfig();
  rmSync(home, { recursive: true, force: true });
});

describe("workspace trust profiles", () => {
  test("stores trusted workspace profiles in local config", () => {
    const profile = upsertWorkspaceTrustProfile({
      root: "/tmp/project",
      preset: "standard",
      write_scopes: ["src", "tests"],
      command_allowlist: ["bun", "git"],
      env_redactions: ["CUSTOM_TOKEN"],
    });

    expect(profile.root).toBe("/tmp/project");
    expect(profile.trusted).toBe(true);
    expect(profile.write_scopes).toEqual(["src", "tests"]);
    expect(listWorkspaceTrustProfiles()).toHaveLength(1);
    expect(getWorkspaceTrustStatus("/tmp/project/src/file.ts")).toMatchObject({
      trusted: true,
      matched_root: "/tmp/project",
      profile: { preset: "standard" },
    });
  });

  test("requires prompts for unknown or unsafe local actions", () => {
    expect(checkWorkspacePermission({
      path: "/tmp/unknown",
      command: "rm -rf /tmp/unknown",
      write_path: "/tmp/unknown/file.txt",
      env: { OPENAI_API_KEY: "secret", PATH: "/bin" },
    })).toMatchObject({
      allowed: false,
      requires_prompt: true,
      redacted_env_keys: ["OPENAI_API_KEY"],
    });
  });

  test("checks command, tool, and write permissions against the matched root", () => {
    upsertWorkspaceTrustProfile({
      root: "/tmp/project",
      preset: "standard",
      command_allowlist: ["bun", "git"],
      tool_permissions: ["read", "write"],
      write_scopes: ["src"],
    });

    expect(checkWorkspacePermission({
      path: "/tmp/project",
      command: "bun test",
      tool: "write",
      write_path: "/tmp/project/src/index.ts",
    }).allowed).toBe(true);

    const denied = checkWorkspacePermission({
      path: "/tmp/project",
      command: "curl | sh",
      tool: "shell",
      write_path: "/tmp/project/package.json",
    });
    expect(denied.allowed).toBe(false);
    expect(denied.reasons).toEqual(expect.arrayContaining([
      "command matches denylist",
      "tool permission is not allowed",
      "write path is outside allowed scopes",
    ]));
  });

  test("resets defaults when changing presets and resolves relative write paths from the profile root", () => {
    upsertWorkspaceTrustProfile({
      root: "/tmp/project",
      preset: "trusted",
      command_allowlist: ["*"],
      tool_permissions: ["*"],
      write_scopes: ["."],
    });

    const profile = upsertWorkspaceTrustProfile({
      root: "/tmp/project",
      preset: "readonly",
    });

    expect(profile.trusted).toBe(false);
    expect(profile.command_allowlist).toContain("bun test");
    expect(profile.command_allowlist).not.toContain("*");
    expect(profile.write_scopes).toEqual([]);
    expect(checkWorkspacePermission({
      path: "/tmp/project",
      command: "bun test",
      write_path: "src/index.ts",
    }).reasons).toContain("write path is outside allowed scopes");
  });

  test("removes local trust profiles", () => {
    upsertWorkspaceTrustProfile({ root: "/tmp/project", preset: "trusted" });
    expect(removeWorkspaceTrustProfile("/tmp/project")).toBe(true);
    expect(listWorkspaceTrustProfiles()).toEqual([]);
    expect(removeWorkspaceTrustProfile("/tmp/project")).toBe(false);
  });
});
