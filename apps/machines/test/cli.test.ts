import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MUTATION_APPROVAL_FLAG_ENV, MUTATION_APPROVAL_TOKEN_ENV, createMutationApprovalToken } from "../src/commands/mutation-approval.js";

const repoRoot = resolve(import.meta.dir, "..");
const cliPath = join(repoRoot, "src", "cli", "index.ts");

function runCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    env,
    input,
    encoding: "utf8",
  });
}

describe("cli command handling", () => {
  test("manifest add --from-stdin bypasses option validation and writes the piped machine", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cli-stdin-"));
    try {
      const env = {
        ...process.env,
        HASNA_MACHINES_MANIFEST_PATH: join(dir, "machines.json"),
        HASNA_MACHINES_DB_PATH: join(dir, "machines.db"),
        HASNA_MACHINES_MACHINE_ID: "control",
        [MUTATION_APPROVAL_FLAG_ENV]: "1",
      };
      expect(runCli(["manifest", "init"], env).status).toBe(0);
      const machine = {
        id: "demo-mac-001",
        hostname: "demo-mac-001",
        sshAddress: "operator@demo-mac-001",
        tailscaleName: "demo-mac-001",
        platform: "macos",
        connection: "ssh",
        workspacePath: "/Users/operator/Workspace",
        metadata: { user: "operator" },
      };
      const added = runCli(["manifest", "add", "--from-stdin"], env, JSON.stringify(machine));
      expect(added.stderr).toBe("");
      expect(added.status).toBe(0);
      const listed = runCli(["manifest", "list"], env);
      expect(listed.status).toBe(0);
      expect(JSON.parse(listed.stdout).machines[0]).toMatchObject({ id: "demo-mac-001", metadata: { user: "operator" } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("screen-credentials reports secret references without printing secret values", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cli-screen-credentials-"));
    try {
      const env = {
        ...process.env,
        HASNA_MACHINES_MANIFEST_PATH: join(dir, "machines.json"),
        HASNA_MACHINES_DB_PATH: join(dir, "machines.db"),
        HASNA_MACHINES_MACHINE_ID: "control",
        HASNA_MACHINES_REACHABLE_HOSTS: "operator@demo-mac-001",
        [MUTATION_APPROVAL_FLAG_ENV]: "1",
      };
      const fakeSecrets = join(dir, "fake-secrets");
      writeFileSync(fakeSecrets, "#!/bin/sh\n[ \"$1\" = get ] && [ \"$2\" = machines/screen-sharing/screen-demo-mac-001-vnc-password ] && { printf '%s\\n' super-secret-value; exit 0; }\nexit 1\n", { mode: 0o700 });
      expect(runCli(["manifest", "init"], env).status).toBe(0);
      const machine = {
        id: "demo-mac-001",
        hostname: "demo-mac-001",
        sshAddress: "operator@demo-mac-001",
        platform: "macos",
        connection: "ssh",
        workspacePath: "/Users/operator/Workspace",
        metadata: {
          user: "operator",
          screenPasswordSecret: "machines/screen-sharing/screen-demo-mac-001-vnc-password",
        },
      };
      expect(runCli(["manifest", "add", "--from-stdin"], env, JSON.stringify(machine)).status).toBe(0);
      const checked = runCli([
        "screen-credentials",
        "--machine",
        "demo-mac-001",
        "--check-secret",
        "--secrets-command",
        fakeSecrets,
        "--json",
      ], env);
      expect(checked.stderr).toBe("");
      expect(checked.status).toBe(0);
      expect(checked.stdout).not.toContain("super-secret-value");
      expect(JSON.parse(checked.stdout)[0]).toMatchObject({
        ok: true,
        machineId: "demo-mac-001",
        user: "operator",
        passwordSecretKey: "machines/screen-sharing/screen-demo-mac-001-vnc-password",
        passwordSecret: { checked: true, present: true },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("screen-credentials exits non-zero in JSON mode when checked secrets are missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cli-screen-missing-secret-"));
    try {
      const env = {
        ...process.env,
        HASNA_MACHINES_MANIFEST_PATH: join(dir, "machines.json"),
        HASNA_MACHINES_DB_PATH: join(dir, "machines.db"),
        HASNA_MACHINES_MACHINE_ID: "control",
        HASNA_MACHINES_REACHABLE_HOSTS: "operator@demo-mac-001",
        [MUTATION_APPROVAL_FLAG_ENV]: "1",
      };
      const fakeSecrets = join(dir, "fake-secrets");
      writeFileSync(fakeSecrets, "#!/bin/sh\nexit 1\n", { mode: 0o700 });
      expect(runCli(["manifest", "init"], env).status).toBe(0);
      const machine = {
        id: "demo-mac-001",
        hostname: "demo-mac-001",
        sshAddress: "operator@demo-mac-001",
        platform: "macos",
        connection: "ssh",
        workspacePath: "/Users/operator/Workspace",
        metadata: { user: "operator" },
      };
      expect(runCli(["manifest", "add", "--from-stdin"], env, JSON.stringify(machine)).status).toBe(0);
      const checked = runCli([
        "screen-credentials",
        "--machine",
        "demo-mac-001",
        "--check-secret",
        "--secrets-command",
        fakeSecrets,
        "--json",
      ], env);
      expect(checked.status).toBe(1);
      expect(JSON.parse(checked.stdout)[0]).toMatchObject({
        ok: true,
        passwordSecret: { checked: true, present: false },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("screen-enable rejects direct VNC passwords", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cli-screen-enable-"));
    try {
      const env = {
        ...process.env,
        HASNA_MACHINES_MANIFEST_PATH: join(dir, "machines.json"),
        HASNA_MACHINES_DB_PATH: join(dir, "machines.db"),
        HASNA_MACHINES_MACHINE_ID: "control",
      };
      const rejected = runCli([
        "screen-enable",
        "--machine",
        "demo-mac-001",
        "--user",
        "operator",
        "--vnc-password",
        "super-secret-value",
      ], env);
      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toContain("Direct --vnc-password values are not accepted");
      expect(rejected.stdout).not.toContain("super-secret-value");
      expect(rejected.stderr).not.toContain("super-secret-value");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("manifest remove requires a CLI-scoped mutation token", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cli-scoped-token-"));
    try {
      const baseEnv = {
        ...process.env,
        HASNA_MACHINES_MANIFEST_PATH: join(dir, "machines.json"),
        HASNA_MACHINES_DB_PATH: join(dir, "machines.db"),
        HASNA_MACHINES_MACHINE_ID: "control",
        [MUTATION_APPROVAL_TOKEN_ENV]: "secret",
      };
      const setupEnv = { ...baseEnv, [MUTATION_APPROVAL_FLAG_ENV]: "1" };
      const machine = {
        id: "demo-node-01",
        platform: "linux",
        workspacePath: "/home/operator/workspace",
      };
      expect(runCli(["manifest", "init"], setupEnv).status).toBe(0);
      expect(runCli(["manifest", "add", "--from-stdin"], setupEnv, JSON.stringify(machine)).status).toBe(0);

      const denied = runCli(["manifest", "remove", "demo-node-01"], baseEnv);
      expect(denied.status).not.toBe(0);
      expect(denied.stderr).toContain("requires operator approval");

      const wrongToken = createMutationApprovalToken({
        surface: "cli",
        operation: "manifest_remove",
        machineId: "other-node",
        callerId: "cli",
        runId: "cli",
        transport: "cli",
        args: { machine_id: "demo-node-01" },
      }, { env: baseEnv, now: Date.now(), nonce: "wrong-cli" });
      const wrong = runCli(["manifest", "remove", "demo-node-01", "--approval-token", wrongToken], baseEnv);
      expect(wrong.status).not.toBe(0);

      const token = createMutationApprovalToken({
        surface: "cli",
        operation: "manifest_remove",
        machineId: "demo-node-01",
        callerId: "cli",
        runId: "cli",
        transport: "cli",
        args: { machine_id: "demo-node-01" },
      }, { env: baseEnv, now: Date.now(), nonce: "right-cli" });
      const removed = runCli(["manifest", "remove", "demo-node-01", "--approval-token", token], baseEnv);
      expect(removed.stderr).toBe("");
      expect(removed.status).toBe(0);
      expect(JSON.parse(removed.stdout).machines).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("manifest add rejects same-id argument tampering", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cli-args-hash-"));
    try {
      const baseEnv = {
        ...process.env,
        HASNA_MACHINES_MANIFEST_PATH: join(dir, "machines.json"),
        HASNA_MACHINES_DB_PATH: join(dir, "machines.db"),
        HASNA_MACHINES_MACHINE_ID: "control",
        [MUTATION_APPROVAL_TOKEN_ENV]: "secret",
      };
      const setupEnv = { ...baseEnv, [MUTATION_APPROVAL_FLAG_ENV]: "1" };
      expect(runCli(["manifest", "init"], setupEnv).status).toBe(0);

      const approvedMachine = {
        id: "demo-node-02",
        platform: "linux",
        workspacePath: "/home/operator/approved",
        metadata: { purpose: "approved" },
      };
      const tamperedMachine = {
        ...approvedMachine,
        workspacePath: "/home/operator/tampered",
        metadata: { purpose: "tampered" },
      };
      const token = createMutationApprovalToken({
        surface: "cli",
        operation: "manifest_add",
        machineId: "demo-node-02",
        callerId: "cli",
        runId: "cli",
        transport: "cli",
        args: approvedMachine,
      }, { env: baseEnv, now: Date.now(), nonce: "manifest-add-args" });

      const denied = runCli(["manifest", "add", "--from-stdin", "--approval-token", token], baseEnv, JSON.stringify(tamperedMachine));
      expect(denied.status).not.toBe(0);
      expect(denied.stderr).toContain("requires operator approval");
      expect(denied.stderr).not.toContain(token);

      const added = runCli(["manifest", "add", "--from-stdin", "--approval-token", token], baseEnv, JSON.stringify(approvedMachine));
      expect(added.stderr).toBe("");
      expect(added.status).toBe(0);
      expect(JSON.parse(added.stdout).machines[0]).toMatchObject(approvedMachine);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("apps apply tokens are bound to the approved plan digest", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cli-plan-digest-"));
    try {
      const baseEnv = {
        ...process.env,
        HASNA_MACHINES_MANIFEST_PATH: join(dir, "machines.json"),
        HASNA_MACHINES_DB_PATH: join(dir, "machines.db"),
        HASNA_MACHINES_MACHINE_ID: "control",
        HASNA_MACHINES_MUTATION_REPLAY_PATH: "",
        [MUTATION_APPROVAL_TOKEN_ENV]: "secret",
      };
      const setupEnv = { ...baseEnv, [MUTATION_APPROVAL_FLAG_ENV]: "1" };
      const machine = {
        id: "demo-node-03",
        platform: "linux",
        workspacePath: "/tmp/machines-plan-digest",
        apps: [],
      };
      expect(runCli(["manifest", "init"], setupEnv).status).toBe(0);
      expect(runCli(["manifest", "add", "--from-stdin"], setupEnv, JSON.stringify(machine)).status).toBe(0);

      const planned = runCli(["apps", "plan", "--machine", "demo-node-03"], baseEnv);
      expect(planned.status).toBe(0);
      const planDigest = JSON.parse(planned.stdout).planDigest;
      expect(planDigest).toMatch(/^[a-f0-9]{64}$/);
      const token = createMutationApprovalToken({
        surface: "cli",
        operation: "apps_apply",
        machineId: "demo-node-03",
        resourceId: `plan:apps_apply:demo-node-03:${planDigest}`,
        callerId: "cli",
        runId: "cli",
        transport: "cli",
        args: { machine_id: "demo-node-03", yes: true, plan_digest: planDigest },
      }, { env: baseEnv, now: Date.now(), nonce: "apps-plan-digest-cli" });

      const applied = runCli(["apps", "apply", "--machine", "demo-node-03", "--yes", "--approval-token", token], baseEnv);
      expect(applied.stderr).toBe("");
      expect(applied.status).toBe(0);
      expect(JSON.parse(applied.stdout)).toMatchObject({ machineId: "demo-node-03", mode: "apply", executed: 0, planDigest });

      const mutated = {
        ...machine,
        apps: [{ name: "drifted-custom", manager: "custom", packageName: "printf cli-plan-drift-executed" }],
      };
      expect(runCli(["manifest", "add", "--from-stdin"], setupEnv, JSON.stringify(mutated)).status).toBe(0);
      const denied = runCli(["apps", "apply", "--machine", "demo-node-03", "--yes", "--approval-token", token], baseEnv);
      expect(denied.status).not.toBe(0);
      expect(denied.stderr).toContain("requires operator approval");
      expect(denied.stderr).not.toContain(token);
      expect(denied.stdout).not.toContain("cli-plan-drift-executed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
