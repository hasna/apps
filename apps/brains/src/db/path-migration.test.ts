import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
        const { existsSync, readFileSync, statSync } = await import("node:fs");
        const { join } = await import("node:path");
        const { getBrainsDbPath } = await import("./src/db/index.ts");
        const migratedDir = join(process.env.HOME, ".hasna", "brains");
        const migratedPath = join(process.env.HOME, ".hasna", "brains", "brains.db");
        function mode(path) {
          if (process.platform === "win32") return null;
          return statSync(path).mode & 0o777;
        }
        console.log(JSON.stringify({
          dbPath: getBrainsDbPath(),
          migrated: existsSync(migratedPath),
          contents: readFileSync(migratedPath, "utf8"),
          dirMode: mode(migratedDir),
          fileMode: mode(migratedPath)
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
        dirMode: process.platform === "win32" ? null : 0o700,
        fileMode: process.platform === "win32" ? null : 0o600,
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("creates fresh local database files with owner-only permissions", async () => {
    const home = mkdtempSync(join(tmpdir(), "brains-db-fresh-home-"));

    try {
      const script = `
        const { statSync } = await import("node:fs");
        const { dirname } = await import("node:path");
        const { getBrainsDbPath, getRawDb } = await import("./src/db/index.ts");
        const dbPath = getBrainsDbPath();
        const db = getRawDb();
        db.close();
        function mode(path) {
          if (process.platform === "win32") return null;
          return statSync(path).mode & 0o777;
        }
        console.log(JSON.stringify({
          dbPath,
          dirMode: mode(dirname(dbPath)),
          fileMode: mode(dbPath)
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
        dirMode: process.platform === "win32" ? null : 0o700,
        fileMode: process.platform === "win32" ? null : 0o600,
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("does not chmod an existing custom database parent directory", async () => {
    if (process.platform === "win32") return;

    const customDir = mkdtempSync(join(tmpdir(), "brains-custom-db-parent-"));
    chmodSync(customDir, 0o777);

    try {
      const script = `
        const { statSync } = await import("node:fs");
        const { join } = await import("node:path");
        const { getRawDb } = await import("./src/db/index.ts");
        const dbPath = join(process.env.CUSTOM_DB_PARENT, "brains.db");
        const db = getRawDb(dbPath);
        db.close();
        function mode(path) {
          return statSync(path).mode & 0o777;
        }
        console.log(JSON.stringify({
          dirMode: mode(process.env.CUSTOM_DB_PARENT),
          fileMode: mode(dbPath)
        }));
      `;
      const proc = Bun.spawn({
        cmd: ["bun", "--eval", script],
        cwd: process.cwd(),
        env: {
          ...process.env,
          CUSTOM_DB_PARENT: customDir,
        },
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
        dirMode: 0o777,
        fileMode: 0o600,
      });
    } finally {
      rmSync(customDir, { recursive: true, force: true });
    }
  });
});
