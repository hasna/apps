import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { JSON_STORE_LOCK_DIRNAME, JsonActionsStore, withJsonStoreLock } from "./storage.js";

const LOCK_OPTS = { staleMs: 150, heartbeatMs: 30, timeoutMs: 5_000 };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pre-creates a lock directory with an owner token that looks `ageMs` old: the
 * recorded ts AND the file mtime are aged, because the lock's freshness signal is
 * the token file's mtime (refreshed by the holder's heartbeat).
 */
function seedStaleLock(dir: string, ageMs: number, nonce = "stale-owner"): string {
  const lockPath = join(dir, JSON_STORE_LOCK_DIRNAME);
  mkdirSync(lockPath, { recursive: true });
  const tokenPath = join(lockPath, "owner.json");
  writeFileSync(
    tokenPath,
    JSON.stringify({ pid: 4242, nonce, ts: Date.now() - ageMs }),
    { mode: 0o600 },
  );
  utimesSync(tokenPath, new Date(Date.now() - ageMs), new Date(Date.now() - ageMs));
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
      // Release removed the holder's token; the empty directory (if it remains)
      // carries no token and is adopted by the next contender.
      expect(existsSync(join(dir, JSON_STORE_LOCK_DIRNAME, "owner.json"))).toBe(false);
      // The released lock is immediately re-acquirable (empty-dir adoption).
      let ranAgain = false;
      await withJsonStoreLock(dir, async () => {
        ranAgain = true;
      }, LOCK_OPTS);
      expect(ranAgain).toBe(true);
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

  test("a resumed holder's heartbeat never replaces a successor's token", async () => {
    const root = mkdtempSync(join(tmpdir(), "actions-json-heartbeat-takeover-"));
    const dir = join(root, "actions");
    const tokenPath = join(dir, JSON_STORE_LOCK_DIRNAME, "owner.json");
    try {
      // The holder heartbeats every 50ms, so its heartbeats keep firing while the
      // successor holds the lock.
      const holderOpts = { staleMs: 150, heartbeatMs: 50, timeoutMs: 5_000 };
      const successorOpts = { staleMs: 150, heartbeatMs: 10_000, timeoutMs: 5_000 };
      let successorToken: string | null = null;
      let successorEntered: () => void = () => undefined;
      const entered = new Promise<void>((resolve) => {
        successorEntered = resolve;
      });
      const holder = withJsonStoreLock(dir, async () => {
        // Simulate suspension: age our token beyond the stale window before the
        // successor's takeover observes it (the first holder heartbeat fires at
        // 50ms, so this aging sticks deterministically).
        utimesSync(tokenPath, new Date(Date.now() - 5_000), new Date(Date.now() - 5_000));
        await entered; // wait until the successor took over and holds
        await sleep(200); // resume; several holder heartbeat periods elapse
      }, holderOpts);
      await sleep(40);
      const successor = withJsonStoreLock(dir, async () => {
        successorToken = readFileSync(tokenPath, "utf8");
        successorEntered();
        await sleep(200); // holder heartbeats fire during this hold
        expect(successorToken).not.toBeNull();
      expect(readFileSync(tokenPath, "utf8")).toBe(successorToken!);
        await sleep(300); // hold past the resumed holder's release
      }, successorOpts);
      await holder;
      // The resumed holder's heartbeats (mtime touches) and its release must leave
      // the successor's token content untouched while the successor still holds.
      expect(successorToken).not.toBeNull();
      expect(readFileSync(tokenPath, "utf8")).toBe(successorToken!);
      await successor;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a stale holder's release restores the successor's lock", async () => {
    const root = mkdtempSync(join(tmpdir(), "actions-json-release-takeover-"));
    const dir = join(root, "actions");
    const tokenPath = join(dir, JSON_STORE_LOCK_DIRNAME, "owner.json");
    try {
      // The holder never heartbeats (10s interval), so its token goes stale while
      // it is still inside its critical section.
      const holderOpts = { staleMs: 150, heartbeatMs: 10_000, timeoutMs: 5_000 };
      let successorToken: string | null = null;
      let successorEntered: () => void = () => undefined;
      const entered = new Promise<void>((resolve) => {
        successorEntered = resolve;
      });
      const holder = withJsonStoreLock(dir, async () => {
        utimesSync(tokenPath, new Date(Date.now() - 5_000), new Date(Date.now() - 5_000));
        await entered; // the successor took over and holds; we resume
      }, holderOpts);
      await sleep(40);
      const successor = withJsonStoreLock(dir, async () => {
        successorToken = readFileSync(tokenPath, "utf8");
        successorEntered();
        await sleep(400); // hold past the stale holder's release
      }, holderOpts);
      await holder;
      // The stale holder's release must not delete the successor's lock: the
      // successor's token is intact and still current while it holds.
      expect(successorToken).not.toBeNull();
      expect(readFileSync(tokenPath, "utf8")).toBe(successorToken!);
      await successor;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
