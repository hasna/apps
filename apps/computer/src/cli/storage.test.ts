import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

function runCli(args: string[], env: Record<string, string | undefined> = {}) {
  return spawnSync("bun", ["src/cli/index.ts", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

describe("computer storage CLI", () => {
  test("help advertises storage sync without legacy cloud command", () => {
    const result = runCli(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("storage");
    expect(result.stdout).toContain("pause");
    expect(result.stdout).toContain("resume");
    expect(result.stdout).toContain("cancel");
    expect(result.stdout).not.toContain("cloud");
  });

  test("storage status reports local mode as JSON", () => {
    const home = mkdtempSync(join(tmpdir(), "open-computer-storage-cli-"));
    try {
      const result = runCli(["storage", "status", "--json"], {
        HOME: home,
        COMPUTER_DB_PATH: join(home, "computer.db"),
        COMPUTER_DATA_DIR: home,
        HASNA_COMPUTER_DATABASE_URL: "",
        COMPUTER_DATABASE_URL: "",
        HASNA_COMPUTER_STORAGE_MODE: "",
        COMPUTER_STORAGE_MODE: "",
      });

      expect(result.status).toBe(0);
        const status = JSON.parse(result.stdout) as { configured: boolean; mode: string; activeEnv: string | null; service: string; tables: string[] };
      expect(status.configured).toBe(false);
      expect(status.mode).toBe("local");
      expect(status.activeEnv).toBe(null);
      expect(status.service).toBe("computer");
      expect(status.tables).toContain("sessions");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("storage push fails closed without explicit sync consent", () => {
    const home = mkdtempSync(join(tmpdir(), "open-computer-storage-cli-"));
    try {
      const result = runCli(["storage", "push"], {
        HOME: home,
        COMPUTER_DB_PATH: join(home, "computer.db"),
        COMPUTER_DATA_DIR: home,
        HASNA_COMPUTER_DATABASE_URL: "postgres://remote.example/computer?sslmode=require",
        HASNA_COMPUTER_STORAGE_SYNC_CONSENT: "",
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Remote storage sync requires explicit consent");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
