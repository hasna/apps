import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

function runCli(args: string[], env: Record<string, string | undefined> = {}) {
  return spawnSync("bun", ["src/cli/index.tsx", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

describe("calendar storage CLI", () => {
  test("help advertises storage sync", () => {
    const result = runCli(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("storage");
  });

  test("storage status reports local mode as JSON", () => {
    const home = mkdtempSync(join(tmpdir(), "open-calendar-storage-cli-"));
    try {
      const result = runCli(["storage", "status", "--json"], {
        HOME: home,
        BUN_TEST: "",
        CALENDAR_DB_PATH: join(home, "calendar.db"),
        HASNA_CALENDAR_DATABASE_URL: "",
        CALENDAR_DATABASE_URL: "",
        HASNA_CALENDAR_STORAGE_MODE: "",
        CALENDAR_STORAGE_MODE: "",
      });

      expect(result.status).toBe(0);
      const status = JSON.parse(result.stdout) as { configured: boolean; mode: string; activeEnv: string | null; service: string; tables: string[] };
      expect(status.configured).toBe(false);
      expect(status.mode).toBe("local");
      expect(status.activeEnv).toBe(null);
      expect(status.service).toBe("calendar");
      expect(status.tables).toContain("events");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
