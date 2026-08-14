import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeDb, getDb, getTestDb } from "./database.js";

const SAFE_INIT_ERROR = "Unable to initialize Shield database safely";

function captureErrorMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected operation to throw");
}

function tableNames(db: ReturnType<typeof getTestDb>): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE ? ORDER BY name")
    .all("table", "sqlite_%")
    .map((row: any) => row.name);
}

describe("database", () => {
  test("getTestDb returns a working in-memory database", () => {
    const db = getTestDb();
    expect(db).toBeDefined();

    const row = db.prepare("SELECT 1 as val").get() as { val: number };
    expect(row.val).toBe(1);

    db.close();
  });

  test("migrations create all expected tables", () => {
    const db = getTestDb();
    const names = tableNames(db);

    expect(names).toContain("_migrations");
    expect(names).toContain("projects");
    expect(names).toContain("scans");
    expect(names).toContain("findings");
    expect(names).toContain("rules");
    expect(names).toContain("policies");
    expect(names).toContain("baselines");
    expect(names).toContain("llm_cache");
    expect(names).toContain("agents");

    db.close();
  });

  test("migrations are idempotent across fresh databases", () => {
    const db1 = getTestDb();
    const db2 = getTestDb();

    expect(tableNames(db1)).toEqual(tableNames(db2));

    db1.close();
    db2.close();
  });

  test("foreign keys are enabled", () => {
    const db = getTestDb();
    const row = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    expect(row.foreign_keys).toBe(1);
    db.close();
  });

  test("migrations table tracks applied migrations", () => {
    const db = getTestDb();
    const migrations = db
      .prepare("SELECT name FROM _migrations")
      .all() as Array<{ name: string }>;

    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations[0].name).toBe("001_initial");

    db.close();
  });

  test("does not reuse a partially initialized connection after credential scrub failure", () => {
    const originalSecurityDb = process.env.SECURITY_DB;
    const directory = mkdtempSync(join(tmpdir(), "shield-init-fail-closed-"));
    const path = join(directory, "shield.db");
    const marker = `gh${"o"}_${"InitFailClosed_".repeat(3)}`;

    try {
      closeDb();
      process.env.SECURITY_DB = path;

      // Establish the current schema, then add a legacy row whose scrub is
      // forced to fail during the next singleton initialization.
      getDb();
      closeDb();
      const fixture = new Database(path);
      fixture.prepare(
        "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES ('project', ?, '/safe', 'now', 'now')",
      ).run(marker);
      fixture.exec(`
        CREATE TRIGGER reject_legacy_project_update
        BEFORE UPDATE ON projects
        BEGIN
          SELECT RAISE(ABORT, 'synthetic write rejection');
        END;
      `);
      fixture.close();

      const message = captureErrorMessage(() => getDb());
      expect(message).toBe(SAFE_INIT_ERROR);
      expect(message).not.toContain(marker);
      const retryMessage = captureErrorMessage(() => getDb());
      expect(retryMessage).toBe(SAFE_INIT_ERROR);
      expect(retryMessage).not.toContain(marker);

      // Remove only the injected failure. A subsequent getDb() must open a
      // fresh connection and retry the scrub before exposing the database.
      const repaired = new Database(path);
      repaired.exec("DROP TRIGGER reject_legacy_project_update");
      repaired.close();

      const recovered = getDb();
      expect(JSON.stringify(recovered.prepare("SELECT * FROM projects").all())).not.toContain(marker);
      expect(recovered.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      closeDb();
      if (originalSecurityDb === undefined) delete process.env.SECURITY_DB;
      else process.env.SECURITY_DB = originalSecurityDb;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("sanitizes constructor and migration initialization errors", () => {
    const originalSecurityDb = process.env.SECURITY_DB;
    const directory = mkdtempSync(join(tmpdir(), "shield-init-errors-"));
    const malformedPath = join(directory, "malformed.db");

    try {
      closeDb();
      process.env.SECURITY_DB = directory;
      const constructorMessage = captureErrorMessage(() => getDb());
      expect(constructorMessage).toBe(SAFE_INIT_ERROR);
      expect(constructorMessage).not.toContain(directory);

      const malformed = new Database(malformedPath);
      malformed.exec("CREATE TABLE _migrations (id INTEGER PRIMARY KEY)");
      malformed.close();

      process.env.SECURITY_DB = malformedPath;
      const migrationMessage = captureErrorMessage(() => getDb());
      expect(migrationMessage).toBe(SAFE_INIT_ERROR);
      expect(migrationMessage).not.toContain("_migrations");
      expect(migrationMessage).not.toContain(malformedPath);
    } finally {
      closeDb();
      if (originalSecurityDb === undefined) delete process.env.SECURITY_DB;
      else process.env.SECURITY_DB = originalSecurityDb;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("sanitizes storage-mode resolution failures and recovers on retry", () => {
    const directory = mkdtempSync(join(tmpdir(), "shield-storage-mode-init-"));
    const path = join(directory, "shield.db");
    const marker = `invalid-mode-${"synthetic-marker-".repeat(3)}`;
    const moduleUrl = new URL("./database.ts", import.meta.url).href;
    const program = `
      import { closeDb, getDb } from ${JSON.stringify(moduleUrl)};
      const marker = ${JSON.stringify(marker)};
      process.env.SECURITY_DB = ${JSON.stringify(path)};
      process.env.HASNA_SHIELD_STORAGE_MODE = marker;

      const capture = () => {
        try { getDb(); } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
        return "did not fail";
      };
      for (const message of [capture(), capture()]) {
        if (message !== ${JSON.stringify(SAFE_INIT_ERROR)} || message.includes(marker)) process.exit(31);
      }

      process.env.HASNA_SHIELD_STORAGE_MODE = "local";
      const recovered = getDb();
      if ((recovered.prepare("SELECT 1 AS value").get()).value !== 1) process.exit(32);
      closeDb();
    `;

    try {
      const child = Bun.spawnSync({
        cmd: [process.execPath, "-e", program],
        env: { ...process.env, SECURITY_DB: path },
        stderr: "pipe",
        stdout: "pipe",
      });
      expect(`${child.stdout.toString()}${child.stderr.toString()}`).not.toContain(marker);
      expect(child.exitCode).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("sanitizes path preparation failures and recovers after the parent is repaired", () => {
    const directory = mkdtempSync(join(tmpdir(), "shield-path-preparation-init-"));
    const blockedParent = join(directory, "blocked-parent");
    const path = join(blockedParent, "shield.db");
    writeFileSync(blockedParent, "not a directory", "utf-8");
    const moduleUrl = new URL("./database.ts", import.meta.url).href;
    const program = `
      import { mkdirSync, rmSync } from "fs";
      import { closeDb, getDb } from ${JSON.stringify(moduleUrl)};
      const unsafePath = ${JSON.stringify(path)};
      process.env.SECURITY_DB = unsafePath;
      process.env.HASNA_SHIELD_STORAGE_MODE = "local";

      const capture = () => {
        try { getDb(); } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
        return "did not fail";
      };
      for (const message of [capture(), capture()]) {
        if (message !== ${JSON.stringify(SAFE_INIT_ERROR)} || message.includes(unsafePath)) process.exit(41);
      }

      rmSync(${JSON.stringify(blockedParent)});
      mkdirSync(${JSON.stringify(blockedParent)});
      const recovered = getDb();
      if ((recovered.prepare("SELECT 1 AS value").get()).value !== 1) process.exit(42);
      closeDb();
    `;

    try {
      const child = Bun.spawnSync({
        cmd: [process.execPath, "-e", program],
        env: { ...process.env, SECURITY_DB: path },
        stderr: "pipe",
        stdout: "pipe",
      });
      const output = `${child.stdout.toString()}${child.stderr.toString()}`;
      expect(output).not.toContain(path);
      expect(child.exitCode).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("closes and retries a fresh connection after a post-init callback failure", () => {
    const directory = mkdtempSync(join(tmpdir(), "shield-callback-fail-closed-"));
    const path = join(directory, "shield.db");
    const marker = `sk_${"CallbackFailure_".repeat(3)}`;
    const moduleUrl = new URL("./database.ts", import.meta.url).href;
    const program = `
      import { closeDb, getDb, onDbInit } from ${JSON.stringify(moduleUrl)};
      process.env.SECURITY_DB = ${JSON.stringify(path)};
      const marker = ${JSON.stringify(marker)};
      let attempts = 0;
      let failedHandle;
      onDbInit(() => {
        attempts++;
        const current = getDb();
        if (attempts === 1) {
          failedHandle = current;
          throw new Error(marker);
        }
        if (current === failedHandle) throw new Error("callback reused failed handle");
      });

      let firstMessage = "";
      try { getDb(); } catch (error) {
        firstMessage = error instanceof Error ? error.message : String(error);
      }
      if (firstMessage !== ${JSON.stringify(SAFE_INIT_ERROR)} || firstMessage.includes(marker)) process.exit(11);
      if (!failedHandle) process.exit(12);
      try {
        failedHandle.exec("SELECT 1");
        process.exit(13);
      } catch {}

      const recovered = getDb();
      if (attempts !== 2 || recovered === failedHandle) process.exit(14);
      if ((recovered.prepare("SELECT 1 AS value").get()).value !== 1) process.exit(15);

      let immediateAttempts = 0;
      let immediateFailedHandle;
      let immediateMessage = "";
      try {
        onDbInit(() => {
          immediateAttempts++;
          const current = getDb();
          if (immediateAttempts === 1) {
            immediateFailedHandle = current;
            throw new Error(marker);
          }
          if (current === immediateFailedHandle) throw new Error("immediate callback reused failed handle");
        });
      } catch (error) {
        immediateMessage = error instanceof Error ? error.message : String(error);
      }
      if (immediateMessage !== ${JSON.stringify(SAFE_INIT_ERROR)} || immediateMessage.includes(marker)) process.exit(16);
      if (!immediateFailedHandle) process.exit(17);
      try {
        immediateFailedHandle.exec("SELECT 1");
        process.exit(18);
      } catch {}

      const recoveredAgain = getDb();
      if (immediateAttempts !== 2 || recoveredAgain === immediateFailedHandle) process.exit(19);
      if ((recoveredAgain.prepare("SELECT 1 AS value").get()).value !== 1) process.exit(20);
      closeDb();
    `;

    try {
      const child = Bun.spawnSync({
        cmd: [process.execPath, "-e", program],
        env: { SECURITY_DB: path },
        stderr: "pipe",
        stdout: "pipe",
      });
      const output = `${child.stdout.toString()}${child.stderr.toString()}`;
      expect(output).not.toContain(marker);
      expect(child.exitCode).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("closes a recursively published replacement when the outer callback initialization fails", () => {
    const directory = mkdtempSync(join(tmpdir(), "shield-callback-replacement-"));
    const path = join(directory, "shield.db");
    const marker = `sk_${"ReplacementFailure_".repeat(3)}`;
    const moduleUrl = new URL("./database.ts", import.meta.url).href;
    const program = `
      import { closeDb, getDb, onDbInit } from ${JSON.stringify(moduleUrl)};
      process.env.SECURITY_DB = ${JSON.stringify(path)};
      const marker = ${JSON.stringify(marker)};
      let attempts = 0;
      let originalHandle;
      let replacementHandle;
      onDbInit(() => {
        attempts++;
        const current = getDb();
        if (attempts !== 1) return;
        originalHandle = current;
        closeDb();
        replacementHandle = getDb();
      });

      let outerMessage = "";
      try { getDb(); } catch (error) {
        outerMessage = error instanceof Error ? error.message : String(error);
      }
      if (outerMessage !== ${JSON.stringify(SAFE_INIT_ERROR)} || outerMessage.includes(marker)) process.exit(21);
      if (!originalHandle || !replacementHandle || originalHandle === replacementHandle) process.exit(22);
      for (const failed of [originalHandle, replacementHandle]) {
        try {
          failed.exec("SELECT 1");
          process.exit(23);
        } catch {}
      }

      const recovered = getDb();
      if (attempts !== 3 || recovered === originalHandle || recovered === replacementHandle) process.exit(24);
      if ((recovered.prepare("SELECT 1 AS value").get()).value !== 1) process.exit(25);
      closeDb();
    `;

    try {
      const child = Bun.spawnSync({
        cmd: [process.execPath, "-e", program],
        env: { SECURITY_DB: path },
        stderr: "pipe",
        stdout: "pipe",
      });
      const output = `${child.stdout.toString()}${child.stderr.toString()}`;
      expect(output).not.toContain(marker);
      expect(child.exitCode).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
