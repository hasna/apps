import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runCli(args: string[], env: Record<string, string | undefined> = {}) {
  return Bun.spawnSync({
    cmd: ["bun", "run", "src/cli/index.tsx", ...args],
    cwd: join(import.meta.dir, "../.."),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      ...env,
    },
  });
}

describe("search storage CLI", () => {
  test("help advertises storage sync without legacy cloud command", () => {
    const result = runCli(["--help"]);
    const out = new TextDecoder().decode(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(out).toContain("storage");
    expect(out).not.toContain("cloud");
  });

  test("storage status reports local mode as JSON", () => {
    const home = mkdtempSync(join(tmpdir(), "open-search-storage-cli-"));
    try {
      const result = runCli(["storage", "status", "--json"], {
        HOME: home,
        HASNA_SEARCH_DB_PATH: ":memory:",
        HASNA_SEARCH_DATABASE_URL: "",
        SEARCH_DATABASE_URL: "",
      });
      const out = new TextDecoder().decode(result.stdout);

      expect(result.exitCode).toBe(0);
      const status = JSON.parse(out) as { mode: string; enabled: boolean; tables: Array<{ table: string; rows: number }> };
      expect(status.mode).toBe("local");
      expect(status.enabled).toBe(false);
      expect(status.tables.some((table) => table.table === "searches")).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
