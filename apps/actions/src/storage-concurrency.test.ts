import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { JSON_STORE_LOCK_DIRNAME, JsonActionsStore, withJsonStoreLock } from "./storage.js";

const LOCK_OPTS = { staleMs: 150, heartbeatMs: 30, timeoutMs: 5_000 };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Pre-creates a lock directory with an owner token whose recorded age is `ageMs`. */
function seedStaleLock(dir: string, ageMs: number, nonce = "stale-owner"): string {
  const lockPath = join(dir, JSON_STORE_LOCK_DIRNAME);
  mkdirSync(lockPath, { recursive: true });
  writeFileSync(
    join(lockPath, "owner.json"),
    JSON.stringify({ pid: 4242, nonce, ts: Date.now() - ageMs }),
    { mode: 0o600 },
  );
  return lockPath;
}

const storageModule = join(import.meta.dir, "storage.ts");

/**
 * Appends disjoint audit events from two independent Bun child processes against the
 * same temporary JSON store directory. The JSON store's read-modify-write cycles must
 * not lose either writer's records, or the audit trail is incomplete.
 */
const concurrentWriterScript = `
import { JsonActionsStore } from ${JSON.stringify(storageModule)};

const [, , dataDir, tag, count] = process.argv;
const store = new JsonActionsStore(dataDir);
for (let index = 0; index < Number(count); index += 1) {
  await store.appendAuditEvent({
    id: \`\${tag}-\${index}\`,
    runId: "run-shared",
    actionId: "test.action",
    type: "action.planned",
    time: new Date().toISOString(),
    severity: "info",
    message: "planned",
    data: {},
    metadata: {},
  });
}
console.log("WRITER OK");
`;

describe("JsonActionsStore concurrent writers", () => {
  test("two child processes writing disjoint records both survive after reopening", async () => {
    const root = mkdtempSync(join(tmpdir(), "actions-json-concurrent-"));
    const dir = join(root, "actions");
    try {
      const scriptPath = join(root, "writer.ts");
      writeFileSync(scriptPath, concurrentWriterScript);
      const eventsPerWriter = 10;

      const writers = ["writer-a", "writer-b"].map((tag) =>
        Bun.spawn([
          process.execPath,
          scriptPath,
          dir,
          tag,
          String(eventsPerWriter),
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
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe("WRITER OK");
      }

      const store = new JsonActionsStore(dir);
      const events = await store.listAuditEvents();
      expect(events).toHaveLength(eventsPerWriter * 2);
      const ids = new Set(events.map((event) => event.id));
      for (let index = 0; index < eventsPerWriter; index += 1) {
        expect(ids.has(`writer-a-${index}`)).toBe(true);
        expect(ids.has(`writer-b-${index}`)).toBe(true);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("JsonActionsStore write lock ownership", () => {
  test("a stale lock from a crashed holder is recovered on age", async () => {
    const root = mkdtempSync(join(tmpdir(), "actions-json-stale-recovery-"));
    const dir = join(root, "actions");
    try {
      seedStaleLock(dir, 5_000); // holder died long ago (no heartbeat since)
      let ran = false;
      await withJsonStoreLock(dir, async () => {
        ran = true;
      }, LOCK_OPTS);
      expect(ran).toBe(true);
      // The lock directory is removed on release, not left behind.
      expect(existsSync(join(dir, JSON_STORE_LOCK_DIRNAME))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a live slow holder is never ejected while heartbeating", async () => {
    const root = mkdtempSync(join(tmpdir(), "actions-json-slow-holder-"));
    const dir = join(root, "actions");
    try {
      const order: string[] = [];
      const holder = withJsonStoreLock(dir, async () => {
        order.push("holder-enter");
        await sleep(600); // 4x the stale window; heartbeat must keep the lock fresh
        order.push("holder-exit");
      }, LOCK_OPTS);
      await sleep(50); // let the holder acquire first
      const contender = withJsonStoreLock(dir, async () => {
        order.push("contender-enter");
      }, LOCK_OPTS);
      await Promise.all([holder, contender]);
      expect(order).toEqual(["holder-enter", "holder-exit", "contender-enter"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("release only removes the lock the holder owns", async () => {
    const root = mkdtempSync(join(tmpdir(), "actions-json-owned-release-"));
    const dir = join(root, "actions");
    try {
      const lockPath = join(dir, JSON_STORE_LOCK_DIRNAME);
      await withJsonStoreLock(dir, async () => {
        // A successor took the lock over while we were inside the critical section
        // (the pathological suspension case): our token is replaced by a foreign one.
        writeFileSync(
          join(lockPath, "owner.json"),
          JSON.stringify({ pid: 999, nonce: "foreign-owner", ts: Date.now() }),
          { mode: 0o600 },
        );
      }, { ...LOCK_OPTS, heartbeatMs: 500 });
      // The release must NOT delete the successor's lock.
      expect(existsSync(lockPath)).toBe(true);
      const token = JSON.parse(readFileSync(join(lockPath, "owner.json"), "utf8"));
      expect(token.nonce).toBe("foreign-owner");
      rmSync(lockPath, { recursive: true, force: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("concurrent takeovers of one stale lock stay mutually exclusive", async () => {
    const root = mkdtempSync(join(tmpdir(), "actions-json-takeover-race-"));
    const dir = join(root, "actions");
    try {
      seedStaleLock(dir, 5_000);
      let active = 0;
      let maxActive = 0;
      const critical = async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await sleep(120);
        active -= 1;
      };
      await Promise.all([
        withJsonStoreLock(dir, critical, LOCK_OPTS),
        withJsonStoreLock(dir, critical, LOCK_OPTS),
      ]);
      expect(maxActive).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
