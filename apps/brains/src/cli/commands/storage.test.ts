import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runCli(args: string[], env: Record<string, string | undefined> = {}) {
  return Bun.spawnSync({
    cmd: ["bun", "run", "src/cli/index.ts", ...args],
    cwd: join(import.meta.dir, "../../.."),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      ...env,
    },
  });
}

describe("brains storage CLI", () => {
  test("help advertises storage sync without legacy cloud command", () => {
    const result = runCli(["--help"]);
    const out = new TextDecoder().decode(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(out).toContain("storage");
    expect(out).not.toContain("cloud");
  });

  test("storage status reports local mode as JSON", () => {
    const home = mkdtempSync(join(tmpdir(), "open-brains-storage-cli-"));
    try {
      const result = runCli(["storage", "status", "--json"], {
        HOME: home,
        HASNA_BRAINS_DATABASE_URL: "",
        BRAINS_DATABASE_URL: "",
        HASNA_BRAINS_STORAGE_MODE: "",
        BRAINS_STORAGE_MODE: "",
      });
      const out = new TextDecoder().decode(result.stdout);

      expect(result.exitCode).toBe(0);
      const status = JSON.parse(out) as { configured: boolean; mode: string; tables: string[] };
      expect(status.configured).toBe(false);
      expect(status.mode).toBe("local");
      expect(status.tables).toContain("fine_tuned_models");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
