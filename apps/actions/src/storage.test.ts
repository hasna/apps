import { chmodSync, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, spyOn, test } from "bun:test";
import {
  ACTIONS_DATABASE_FILENAME,
  ACTIONS_JSON_MIGRATION_KEY,
  JsonActionsStore,
  SQLiteActionsStore,
  getActionsStatus,
} from "./storage.js";
import type { ActionAuditEvent, ActionManifest, ActionRun } from "./types.js";

const storageModule = join(import.meta.dir, "storage.ts");

/**
 * Simulates a data dir the process can write but cannot chmod: a shared team directory,
 * a container bind mount, or a volume without POSIX modes.
 */
const chmodDeniedPreload = `
import { mock } from "bun:test";
import * as realFs from "node:fs";

mock.module("node:fs", () => ({
  ...realFs,
  default: realFs,
  chmodSync: (path) => {
    const error = new Error(\`EPERM: operation not permitted, chmod '\${path}'\`);
    error.code = "EPERM";
    throw error;
  },
}));
`;

const chmodDeniedScript = `
import { SQLiteActionsStore } from ${JSON.stringify(storageModule)};

const store = new SQLiteActionsStore(process.argv[2]);
await store.saveManifest(JSON.parse(process.argv[3]));
const stored = await store.getManifest("test.action");
console.log(stored?.id === "test.action" ? "STORE OK" : "STORE MISMATCH");
`;

/**
 * Opens the store in a second process. The ready file lets the test hold its lock until
 * the child is genuinely about to open, so the wait is exercised rather than raced past.
 */
const openStoreScript = `
import { writeFileSync } from "node:fs";
import { SQLiteActionsStore } from ${JSON.stringify(storageModule)};

writeFileSync(process.argv[3], "ready");
const store = new SQLiteActionsStore(process.argv[2]);
await store.listManifests();
console.log("OPEN OK");
`;

/** Appends audit events from a separate process so two real writers contend for the file. */
const concurrentWriterScript = `
import { SQLiteActionsStore } from ${JSON.stringify(storageModule)};

const [, , dataDir, tag, count, template] = process.argv;
const store = new SQLiteActionsStore(dataDir);
const base = JSON.parse(template);
for (let index = 0; index < Number(count); index += 1) {
  await store.appendAuditEvent({ ...base, id: \`\${tag}_\${index}\` });
}
console.log("WRITER OK");
`;

const manifest: ActionManifest = {
  id: "test.action",
  name: "Test Action",
  version: "1.0.0",
  description: "A test action.",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  actor: { types: ["human"] },
  resource: { type: "test" },
  scope: { level: "local" },
  riskLevel: "low",
  requiredApprovals: [],
  idempotency: { supported: true },
  dryRun: { supported: true, default: true },
  confirmation: { title: "Test action" },
  audit: { eventTypes: ["action.planned"] },
  evidence: { required: false },
  rollback: { strategy: "none" },
  executorBindings: [{ kind: "typescript", ref: "test" }],
};

const run: ActionRun = {
  id: "run_1",
  actionId: "test.action",
  actionVersion: "1.0.0",
  status: "planned",
  input: {},
  plan: [],
  riskLevel: "low",
  requiredApprovals: [],
  approvals: [],
  guardrailResults: [],
  evidence: [],
  idempotencyKey: "idem-1",
  dryRun: true,
  confirmationSummary: "Test action",
  rollback: { strategy: "none" },
  events: [],
  metadata: {},
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const auditEvent: ActionAuditEvent = {
  id: "event_1",
  runId: "run_1",
  actionId: "test.action",
  type: "action.planned",
  time: "2026-01-01T00:00:00.000Z",
  severity: "info",
  message: "Action planned",
  data: {},
  metadata: {},
};

/** Writes the legacy `manifests.json` / `runs.json` / `audit-events.json` trio. */
async function seedLegacyJsonStore(dir: string): Promise<void> {
  const jsonStore = new JsonActionsStore(dir);
  await jsonStore.saveManifest(manifest);
  await jsonStore.createRun(run);
  await jsonStore.appendAuditEvent(auditEvent);
}

function readMigrationMarker(dir: string): string | undefined {
  const database = new Database(join(dir, ACTIONS_DATABASE_FILENAME), { readonly: true });
  try {
    const row = database
      .query("SELECT value FROM actions_metadata WHERE key = ?")
      .get(ACTIONS_JSON_MIGRATION_KEY) as { value: string } | null;
    return row?.value;
  } finally {
    database.close();
  }
}

describe("JsonActionsStore", () => {
  test("persists manifests, runs, idempotency lookup, and status", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-store-"));
    try {
      const store = new JsonActionsStore(dir);
      await store.saveManifest(manifest);
      expect(await store.getManifest("test.action")).toMatchObject({ id: "test.action" });

      await store.createRun(run);
      expect(await store.findRunByIdempotencyKey("test.action", "idem-1")).toMatchObject({ id: "run_1" });

      const status = await getActionsStatus(dir);
      expect(status.counts.manifests).toBe(1);
      expect(status.counts.runs).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("SQLiteActionsStore", () => {
  test("persists CRUD records and idempotency lookups", async () => {
    const root = mkdtempSync(join(tmpdir(), "actions-sqlite-"));
    const dir = join(root, "actions");
    try {
      const store = new SQLiteActionsStore(dir);
      await store.saveManifest(manifest);
      await store.createRun(run);
      await store.appendAuditEvent(auditEvent);

      expect(await store.getManifest("test.action")).toMatchObject({ id: "test.action" });
      expect(await store.findRunByIdempotencyKey("test.action", "idem-1")).toMatchObject({ id: "run_1" });
      expect(await store.listAuditEvents({ runId: "run_1" })).toEqual([auditEvent]);

      await store.updateRun({ ...run, status: "succeeded", updatedAt: "2026-01-01T00:01:00.000Z" });
      expect(await store.getRun("run_1")).toMatchObject({ status: "succeeded" });

      const status = await getActionsStatus(dir);
      expect(status.storage).toEqual({
        engine: "sqlite",
        database: { path: join(dir, "actions.db"), exists: true },
      });
      expect(status.counts).toEqual({ manifests: 1, runs: 1, auditEvents: 1 });
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(statSync(join(dir, "actions.db")).mode & 0o777).toBe(0o600);
      expect(existsSync(join(dir, "actions.db-wal"))).toBe(false);
      expect(existsSync(join(dir, "actions.db-shm"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("migrates legacy JSON records on first open", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-sqlite-migration-"));
    try {
      await seedLegacyJsonStore(dir);
      chmodSync(dir, 0o755);

      const store = new SQLiteActionsStore(dir);
      expect(await store.getManifest("test.action")).toEqual(manifest);
      expect(await store.getRun("run_1")).toEqual(run);
      expect(await store.listAuditEvents()).toEqual([auditEvent]);

      expect(existsSync(join(dir, "actions.db"))).toBe(true);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(statSync(join(dir, "actions.db")).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * Isolates the `INSERT OR IGNORE` guarantee: the completion marker is deleted so the
   * migration genuinely replays over rows SQLite has since moved past.
   */
  test("never overwrites newer SQLite rows when the migration replays", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-sqlite-replay-"));
    try {
      await seedLegacyJsonStore(dir);

      const store = new SQLiteActionsStore(dir);
      await store.saveManifest({ ...manifest, name: "SQLite state" });
      await store.updateRun({ ...run, status: "succeeded", updatedAt: "2026-01-01T00:01:00.000Z" });

      expect(readMigrationMarker(dir)).toBe("completed");
      const database = new Database(join(dir, ACTIONS_DATABASE_FILENAME));
      database.query("DELETE FROM actions_metadata WHERE key = ?").run(ACTIONS_JSON_MIGRATION_KEY);
      database.close();

      const reopened = new SQLiteActionsStore(dir);
      expect(await reopened.getManifest("test.action")).toMatchObject({ name: "SQLite state" });
      expect(await reopened.getRun("run_1")).toMatchObject({ status: "succeeded" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * Isolates the completion marker: without it every open would re-import the legacy
   * files, which are deliberately left on disk.
   */
  test("marks the migration complete so later opens skip the legacy files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-sqlite-marker-"));
    try {
      await seedLegacyJsonStore(dir);

      const store = new SQLiteActionsStore(dir);
      expect(await store.getManifest("test.action")).toEqual(manifest);
      expect(readMigrationMarker(dir)).toBe("completed");

      writeFileSync(
        join(dir, "manifests.json"),
        `${JSON.stringify([manifest, { ...manifest, id: "late.action" }], null, 2)}\n`,
      );

      const reopened = new SQLiteActionsStore(dir);
      expect(await reopened.getManifest("late.action")).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("opens despite an unreadable legacy file and retries it once repaired", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-sqlite-corrupt-"));
    const errors = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await seedLegacyJsonStore(dir);
      const corruptPath = join(dir, "audit-events.json");
      writeFileSync(corruptPath, `${JSON.stringify([auditEvent], null, 2).slice(0, 40)}`);

      const store = new SQLiteActionsStore(dir);
      expect(await store.getManifest("test.action")).toEqual(manifest);
      expect(await store.getRun("run_1")).toEqual(run);
      expect(await store.listAuditEvents()).toEqual([]);
      expect(errors.mock.calls.flat().join("\n")).toContain(corruptPath);
      expect(readMigrationMarker(dir)).toBeUndefined();

      writeFileSync(corruptPath, `${JSON.stringify([auditEvent], null, 2)}\n`);
      const reopened = new SQLiteActionsStore(dir);
      expect(await reopened.listAuditEvents()).toEqual([auditEvent]);
      expect(readMigrationMarker(dir)).toBe("completed");
    } finally {
      errors.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("stays usable in a data dir whose permissions cannot be tightened", async () => {
    const root = mkdtempSync(join(tmpdir(), "actions-sqlite-chmod-"));
    const dir = join(root, "actions");
    try {
      writeFileSync(join(root, "preload.ts"), chmodDeniedPreload);
      writeFileSync(join(root, "open-store.ts"), chmodDeniedScript);

      const child = Bun.spawnSync([
        process.execPath,
        "--preload",
        join(root, "preload.ts"),
        join(root, "open-store.ts"),
        dir,
        JSON.stringify(manifest),
      ], { stdout: "pipe", stderr: "pipe" });

      const stdout = child.stdout.toString();
      const stderr = child.stderr.toString();
      expect(`${stderr}${stdout}`).not.toContain("EPERM");
      expect(child.exitCode).toBe(0);
      expect(stdout.trim()).toBe("STORE OK");
      expect(existsSync(join(dir, "actions.db"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * Isolates the pragma ordering: `PRAGMA journal_mode` reads the database file, so it
   * collides with a writer holding the EXCLUSIVE lock a rollback-journal commit takes.
   * Unless `PRAGMA busy_timeout` runs first the busy handler is not armed for it yet and
   * the open aborts with SQLITE_BUSY instead of waiting.
   */
  test("waits for another process holding the write lock instead of failing to open", async () => {
    const root = mkdtempSync(join(tmpdir(), "actions-sqlite-busy-"));
    const dir = join(root, "actions");
    try {
      await new SQLiteActionsStore(dir).init();
      const scriptPath = join(root, "open-store.ts");
      const readyPath = join(root, "child-ready");
      writeFileSync(scriptPath, openStoreScript);

      const holder = new Database(join(dir, ACTIONS_DATABASE_FILENAME));
      holder.exec("PRAGMA busy_timeout = 5000;");
      holder.exec("BEGIN EXCLUSIVE;");
      holder.query("INSERT INTO action_manifests (id, json) VALUES (?, ?)").run("lock.holder", "{}");

      const child = Bun.spawn([process.execPath, scriptPath, dir, readyPath], {
        stdout: "pipe",
        stderr: "pipe",
      });
      try {
        await waitForFile(readyPath);
        await Bun.sleep(250);
      } finally {
        holder.exec("COMMIT");
        holder.close();
      }

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(stderr).not.toContain("SQLITE_BUSY");
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe("OPEN OK");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * The fleet runs several `actions` processes against one data dir — a CLI command
   * alongside `actions-mcp`, or parallel agents. Neither writer may abort, and because
   * this store also backs the audit trail, every event has to survive the contention.
   */
  test("two writer processes sharing a data dir both record every event", async () => {
    const root = mkdtempSync(join(tmpdir(), "actions-sqlite-concurrent-"));
    const dir = join(root, "actions");
    try {
      const scriptPath = join(root, "writer.ts");
      writeFileSync(scriptPath, concurrentWriterScript);
      const eventsPerWriter = 30;

      const writers = ["writer-a", "writer-b"].map((tag) =>
        Bun.spawn([
          process.execPath,
          scriptPath,
          dir,
          tag,
          String(eventsPerWriter),
          JSON.stringify(auditEvent),
        ], { stdout: "pipe", stderr: "pipe" }),
      );

      const results = await Promise.all(writers.map(async (child) => {
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        return { stdout, stderr, exitCode };
      }));

      for (const result of results) {
        expect(result.stderr).not.toContain("SQLITE_BUSY");
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe("WRITER OK");
      }
      expect(await new SQLiteActionsStore(dir).listAuditEvents()).toHaveLength(eventsPerWriter * 2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/** Polls for a file a spawned process writes to announce it is about to open the store. */
async function waitForFile(path: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${path}`);
    await Bun.sleep(10);
  }
}
