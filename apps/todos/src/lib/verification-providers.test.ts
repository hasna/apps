import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask } from "../db/tasks.js";
import {
  loadVerificationProviders,
  saveVerificationProviders,
  runVerification,
  listVerificationRecords,
  getDefaultProviders,
  resetVerificationProviderCache,
  VERIFICATION_SCHEMA_VERSION,
} from "./verification-providers.js";

let db: Database;
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "todos-verify-test-"));
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  resetVerificationProviderCache();
  db = getDatabase();
  mkdirSync(join(tempDir, ".todos"), { recursive: true });
  process.chdir(tempDir);
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  resetVerificationProviderCache();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("loadVerificationProviders", () => {
  it("returns defaults when no config file exists", () => {
    const providers = loadVerificationProviders();
    expect(providers.length).toBeGreaterThan(0);
    expect(providers.some((p) => p.name === "test")).toBe(true);
  });

  it("loads custom providers from .todos/verification-providers.json", () => {
    saveVerificationProviders([
      { name: "custom-shell", type: "shell", command: "echo ok" },
    ]);
    resetVerificationProviderCache();
    const providers = loadVerificationProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0]!.name).toBe("custom-shell");
  });
});

describe("runVerification", () => {
  it("runs shell provider and records normalized evidence", () => {
    saveVerificationProviders([{ name: "echo-test", type: "shell", command: "echo hello" }]);
    resetVerificationProviderCache();
    const task = createTask({ title: "Verify me" }, db);
    const record = runVerification({ provider: "echo-test", task_id: task.id }, db);

    expect(record.schema_version).toBe(VERIFICATION_SCHEMA_VERSION);
    expect(record.status).toBe("passed");
    expect(record.provider_type).toBe("shell");
    expect(record.task_id).toBe(task.id);
    expect(record.evidence.exit_code).toBe(0);
  });

  it("runs ci_snapshot provider against JSON file", () => {
    const snapshot = join(tempDir, "ci.json");
    writeFileSync(snapshot, JSON.stringify({ status: "passed", job: "test" }));
    saveVerificationProviders([{ name: "ci", type: "ci_snapshot", snapshot_path: snapshot }]);
    resetVerificationProviderCache();

    const record = runVerification({ provider: "ci" }, db);
    expect(record.status).toBe("passed");
    expect(record.provider_type).toBe("ci_snapshot");
  });

  it("records manual verification with note", () => {
    saveVerificationProviders([{ name: "manual-review", type: "manual" }]);
    resetVerificationProviderCache();
    const record = runVerification({ provider: "manual-review", note: "Reviewed by human" }, db);
    expect(record.status).toBe("passed");
    expect(record.evidence.note).toBe("Reviewed by human");
  });

  it("rejects unknown provider", () => {
    expect(() => runVerification({ provider: "missing" }, db)).toThrow("Unknown verification provider");
  });
});

describe("listVerificationRecords", () => {
  it("filters by task_id", () => {
    saveVerificationProviders([{ name: "m", type: "manual" }]);
    resetVerificationProviderCache();
    const t1 = createTask({ title: "T1" }, db);
    const t2 = createTask({ title: "T2" }, db);
    runVerification({ provider: "m", task_id: t1.id, note: "a" }, db);
    runVerification({ provider: "m", task_id: t2.id, note: "b" }, db);

    const records = listVerificationRecords({ task_id: t1.id }, db);
    expect(records).toHaveLength(1);
    expect(records[0]!.task_id).toBe(t1.id);
  });
});

describe("contract: local-only", () => {
  it("default providers do not reference hosted services", () => {
    const src = require("node:fs").readFileSync(join(import.meta.dir, "verification-providers.ts"), "utf8");
    expect(src).not.toMatch(/todos\.md|platform-todos|fetch\s*\(/i);
    for (const p of getDefaultProviders()) {
      expect(JSON.stringify(p)).not.toMatch(/todos\.md|platform-todos/i);
    }
  });
});
