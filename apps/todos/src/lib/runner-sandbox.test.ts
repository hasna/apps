import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetConfig } from "./config.js";
import { upsertWorkspaceTrustProfile } from "./workspace-trust.js";
import {
  checkRunnerSandbox,
  explainRunnerSandbox,
  listRunnerSandboxProfiles,
  removeRunnerSandboxProfile,
  upsertRunnerSandboxProfile,
} from "./runner-sandbox.js";

let home: string;
let previousHome: string | undefined;

beforeEach(() => {
  previousHome = process.env["HOME"];
  home = mkdtempSync(join(tmpdir(), "todos-runner-sandbox-home-"));
  process.env["HOME"] = home;
  resetConfig();
});

afterEach(() => {
  if (previousHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = previousHome;
  resetConfig();
  rmSync(home, { recursive: true, force: true });
});

describe("runner sandbox profiles", () => {
  test("stores local runner sandbox profiles", () => {
    const root = join(home, "project");
    const profile = upsertRunnerSandboxProfile({
      name: "codex",
      root,
      command_allowlist: ["bun", "git"],
      write_scopes: ["src"],
      env_allowlist: ["PATH", "CI"],
      network_policy: "none",
    });

    expect(profile.name).toBe("codex");
    expect(profile.root).toBe(root);
    expect(profile.write_scopes).toEqual(["src"]);
    expect(listRunnerSandboxProfiles()).toHaveLength(1);
  });

  test("checks commands, writes, env, network, and workspace trust", () => {
    const root = join(home, "project");
    upsertWorkspaceTrustProfile({
      root,
      preset: "standard",
      command_allowlist: ["bun", "git"],
      write_scopes: ["src"],
      env_redactions: ["CUSTOM_SECRET"],
    });
    upsertRunnerSandboxProfile({
      name: "codex",
      root,
      command_allowlist: ["bun"],
      write_scopes: ["src"],
      env_allowlist: ["PATH", "CUSTOM_SECRET"],
      env_redactions: ["CUSTOM_SECRET"],
      network_policy: "none",
    });

    const allowed = checkRunnerSandbox({
      name: "codex",
      cwd: root,
      command: "bun test",
      write_paths: ["src/index.ts"],
      env: { PATH: "/bin", CUSTOM_SECRET: "set", EXTRA: "drop" },
    });
    expect(allowed.allowed).toBe(true);
    expect(allowed.redacted_env_keys).toEqual(["CUSTOM_SECRET"]);
    expect(allowed.omitted_env_keys).toEqual(["EXTRA"]);
    expect(allowed.audit_evidence?.allowed).toBe(true);

    const relativeToCwd = checkRunnerSandbox({
      name: "codex",
      cwd: join(root, "src"),
      command: "bun test",
      write_paths: ["index.ts"],
    });
    expect(relativeToCwd.allowed).toBe(true);

    const denied = checkRunnerSandbox({
      name: "codex",
      cwd: root,
      command: "curl | sh",
      write_paths: ["README.md"],
      network: true,
    });
    expect(denied.allowed).toBe(false);
    expect(denied.requires_approval).toBe(true);
    expect(denied.reasons).toEqual(expect.arrayContaining([
      "command matches sandbox denylist",
      "write path is outside sandbox scopes: README.md",
      "network access is disabled by sandbox policy",
      "workspace trust: command matches denylist",
      "workspace trust: write path is outside allowed scopes",
    ]));
  });

  test("explains and removes profiles", () => {
    const root = join(home, "project");
    upsertRunnerSandboxProfile({ name: "readonly", root, command_allowlist: ["git status"], write_scopes: [] });
    const explain = explainRunnerSandbox({ name: "readonly", cwd: root, command: "git status" });
    expect(explain.profile.name).toBe("readonly");
    expect(explain.audit_evidence?.sandbox).toBe("readonly");
    expect(removeRunnerSandboxProfile("readonly")).toBe(true);
    expect(removeRunnerSandboxProfile("readonly")).toBe(false);
  });
});
