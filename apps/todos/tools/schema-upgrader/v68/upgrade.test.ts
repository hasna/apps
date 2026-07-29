import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { inspectLocalSchema } from "../../../src/db/current-schema.js";
import { MIGRATIONS } from "../../../src/db/migrations.js";
import { upgradeDatabase } from "./upgrade.js";

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function paths(): { database: string; backup: string; evidence: string } {
  tempDir = mkdtempSync(join(tmpdir(), "todos-detached-upgrade-"));
  return {
    database: join(tempDir, "todos.db"),
    backup: join(tempDir, "backup.db"),
    evidence: join(tempDir, "evidence.json"),
  };
}

describe("detached one-use v68 upgrader", () => {
  test("backs up, upgrades, verifies, records evidence, and is idempotent", () => {
    const target = paths();
    const legacy = new Database(target.database);
    legacy.exec(MIGRATIONS[0]!);
    legacy.query("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run("p1", "Legacy", "/legacy");
    legacy.query("INSERT INTO tasks (id, project_id, title) VALUES (?, ?, ?)").run("t1", "p1", "Upgrade me");
    legacy.close();

    const result = upgradeDatabase(target);
    expect(result.status).toBe("complete");
    expect(existsSync(target.backup)).toBe(true);
    const evidence = JSON.parse(readFileSync(target.evidence, "utf8"));
    expect(evidence).toMatchObject({
      status: "complete",
      backup: { verified: true, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
      before: { tables: { tasks: { rows: 1 } } },
      after: { tables: { tasks: { rows: 1 } } },
    });
    expect(evidence.checkpoints.map((item: { name: string }) => item.name)).toEqual([
      "source_verified_and_locked",
      "backup_created_and_verified",
      "transform_verified",
      "cutover_verified",
    ]);

    const upgraded = new Database(target.database, { readonly: true });
    expect(inspectLocalSchema(upgraded).kind).toBe("current");
    expect(upgraded.query("SELECT title FROM tasks WHERE id = 't1'").get()).toEqual({ title: "Upgrade me" });
    upgraded.close();

    const secondEvidence = join(tempDir!, "second-evidence.json");
    expect(upgradeDatabase({ ...target, evidence: secondEvidence })).toMatchObject({
      status: "already_current",
      backup_path: null,
    });
    expect(JSON.parse(readFileSync(secondEvidence, "utf8"))).toMatchObject({ status: "already_current" });
  });

  test("fails on ambiguous state before creating backup or evidence", () => {
    const target = paths();
    const ambiguous = new Database(target.database);
    ambiguous.exec("CREATE TABLE unknown_store (id TEXT PRIMARY KEY)");
    ambiguous.close();

    expect(() => upgradeDatabase(target)).toThrow(/ambiguous source state/i);
    expect(existsSync(target.backup)).toBe(false);
    expect(existsSync(target.evidence)).toBe(false);
  });

  test("is absent from package exports, bins, scripts, and published files", () => {
    const packageJson = JSON.parse(readFileSync(join(import.meta.dir, "../../../package.json"), "utf8"));
    const publicSurface = JSON.stringify({
      exports: packageJson.exports,
      bin: packageJson.bin,
      scripts: packageJson.scripts,
      files: packageJson.files,
    });
    expect(publicSurface).not.toContain("schema-upgrader");
    expect(Object.keys(packageJson.bin)).toEqual(["todos", "todos-mcp", "todos-serve"]);
  });
});
