import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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
});
