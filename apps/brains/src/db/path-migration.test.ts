import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("brains database path migration", () => {
  test("copies legacy ~/.brains database files into ~/.hasna/brains", async () => {
    const home = mkdtempSync(join(tmpdir(), "brains-db-home-"));
    const legacyDir = join(home, ".brains");

    try {
      mkdirSync(legacyDir, { recursive: true });
      writeFileSync(join(legacyDir, "brains.db"), "legacy-db");

      const script = `
        const { existsSync, readFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const { getBrainsDbPath } = await import("./src/db/index.ts");
        const migratedPath = join(process.env.HOME, ".hasna", "brains", "brains.db");
        console.log(JSON.stringify({
          dbPath: getBrainsDbPath(),
          migrated: existsSync(migratedPath),
          contents: readFileSync(migratedPath, "utf8")
        }));
      `;
      const env = {
        ...process.env,
        HOME: home,
        USERPROFILE: "",
      };
      delete env["HASNA_BRAINS_DB_PATH"];
      delete env["BRAINS_DB_PATH"];
      const proc = Bun.spawn({
        cmd: ["bun", "--eval", script],
        cwd: process.cwd(),
        env,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout)).toEqual({
        dbPath: join(home, ".hasna", "brains", "brains.db"),
        migrated: true,
        contents: "legacy-db",
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
