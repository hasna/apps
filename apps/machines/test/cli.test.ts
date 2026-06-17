import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
      };
      expect(runCli(["manifest", "init"], env).status).toBe(0);
      const machine = {
        id: "machine001",
        hostname: "machine001",
        sshAddress: "hasna@machine001",
        tailscaleName: "machine001",
        platform: "macos",
        connection: "ssh",
        workspacePath: "/Users/hasna/Workspace",
        metadata: { user: "hasna" },
      };
      const added = runCli(["manifest", "add", "--from-stdin"], env, JSON.stringify(machine));
      expect(added.stderr).toBe("");
      expect(added.status).toBe(0);
      const listed = runCli(["manifest", "list"], env);
      expect(listed.status).toBe(0);
      expect(JSON.parse(listed.stdout).machines[0]).toMatchObject({ id: "machine001", metadata: { user: "hasna" } });
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
        HASNA_MACHINES_REACHABLE_HOSTS: "hasna@machine001",
      };
      const fakeSecrets = join(dir, "fake-secrets");
      writeFileSync(fakeSecrets, "#!/bin/sh\n[ \"$1\" = get ] && [ \"$2\" = machines/screen-sharing/screen-machine001-vnc-password ] && { printf '%s\\n' super-secret-value; exit 0; }\nexit 1\n", { mode: 0o700 });
      expect(runCli(["manifest", "init"], env).status).toBe(0);
      const machine = {
        id: "machine001",
        hostname: "machine001",
        sshAddress: "hasna@machine001",
        platform: "macos",
        connection: "ssh",
        workspacePath: "/Users/hasna/Workspace",
        metadata: {
          user: "hasna",
          screenPasswordSecret: "machines/screen-sharing/screen-machine001-vnc-password",
        },
      };
      expect(runCli(["manifest", "add", "--from-stdin"], env, JSON.stringify(machine)).status).toBe(0);
      const checked = runCli([
        "screen-credentials",
        "--machine",
        "machine001",
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
        machineId: "machine001",
        user: "hasna",
        passwordSecretKey: "machines/screen-sharing/screen-machine001-vnc-password",
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
        HASNA_MACHINES_REACHABLE_HOSTS: "hasna@machine001",
      };
      const fakeSecrets = join(dir, "fake-secrets");
      writeFileSync(fakeSecrets, "#!/bin/sh\nexit 1\n", { mode: 0o700 });
      expect(runCli(["manifest", "init"], env).status).toBe(0);
      const machine = {
        id: "machine001",
        hostname: "machine001",
        sshAddress: "hasna@machine001",
        platform: "macos",
        connection: "ssh",
        workspacePath: "/Users/hasna/Workspace",
        metadata: { user: "hasna" },
      };
      expect(runCli(["manifest", "add", "--from-stdin"], env, JSON.stringify(machine)).status).toBe(0);
      const checked = runCli([
        "screen-credentials",
        "--machine",
        "machine001",
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
        "machine001",
        "--user",
        "hasna",
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
});
