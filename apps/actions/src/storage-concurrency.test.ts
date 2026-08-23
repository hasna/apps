import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { JSON_STORE_LOCK_DIRNAME, JsonActionsStore, JsonStoreWriteLock } from "./storage.js";

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

/**
 * Deterministic lock-protocol regression tests. The protocol must never let a
 * stale-lock takeover or a release remove a live successor's lock: that
 * interleaving is what previously allowed two writers into the critical section
 * with overlapping whole-file renames (record loss). Child-process timing
 * cannot force these interleavings, so they are driven through the internal
 * JsonStoreWriteLock seam: staleness is process liveness (dead-pid owners),
 * and the beforeTakeover hook interposes deterministically between a breaker's
 * staleness observation and its rename.
 */
describe("JsonActionsStore lock protocol interleavings", () => {
  const oldMtime = new Date(Date.now() - 60_000);
  const deadOwnerRecord = JSON.stringify({ ownerId: "dead-owner", pid: 999_999_999, starttime: null });

  function writeStaleLock(dir: string, ownerContent: string): string {
    const lockDir = join(dir, JSON_STORE_LOCK_DIRNAME);
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, "owner"), ownerContent);
    utimesSync(join(lockDir, "owner"), oldMtime, oldMtime);
    utimesSync(lockDir, oldMtime, oldMtime);
    return lockDir;
  }

  test("a breaker never displaces a live successor's lock", async () => {
    const root = mkdtempSync(join(tmpdir(), "actions-json-lock-live-"));
    const dir = join(root, "actions");
    try {
      mkdirSync(dir, { recursive: true });
      const holder = new JsonStoreWriteLock(dir);
      await holder.acquire(Date.now() + 5_000);

      const breaker = new JsonStoreWriteLock(dir);
      await expect(breaker.acquire(Date.now() + 200)).rejects.toThrow(/Timed out/);

      expect(await holder.owns()).toBe(true);
      await holder.release();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a live holder is never displaced even when its owner file looks old", async () => {
    const root = mkdtempSync(join(tmpdir(), "actions-json-lock-liveold-"));
    const dir = join(root, "actions");
    try {
      mkdirSync(dir, { recursive: true });
      const holder = new JsonStoreWriteLock(dir);
      await holder.acquire(Date.now() + 5_000);
      // With no heartbeat the owner file's mtime stops moving, but staleness is
      // process liveness — the holder's pid is the test process, which is alive.
      utimesSync(holder.ownerPath, oldMtime, oldMtime);

      const breaker = new JsonStoreWriteLock(dir);
      await expect(breaker.acquire(Date.now() + 300)).rejects.toThrow(/Timed out/);

      expect(await holder.owns()).toBe(true);
      await holder.release();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a stale lock is claimed by exactly one breaker and the displaced holder's fence fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "actions-json-lock-stale-"));
    const dir = join(root, "actions");
    try {
      mkdirSync(dir, { recursive: true });
      // A handle for the dead owner, so the fence can be probed from its side.
      const staleHolder = new JsonStoreWriteLock(dir);
      writeStaleLock(dir, JSON.stringify({ ownerId: staleHolder.ownerId, pid: 999_999_999, starttime: null }));

      const breaker1 = new JsonStoreWriteLock(dir);
      await breaker1.acquire(Date.now() + 5_000);

      expect(await staleHolder.owns()).toBe(false);
      expect(await breaker1.owns()).toBe(true);

      // breaker1 is the live test process; a second breaker must wait.
      const breaker2 = new JsonStoreWriteLock(dir);
      await expect(breaker2.acquire(Date.now() + 200)).rejects.toThrow(/Timed out/);

      await breaker1.release();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a delayed breaker interposed between its stale observation and its rename never displaces a live successor", async () => {
    const root = mkdtempSync(join(tmpdir(), "actions-json-lock-delayed-"));
    const dir = join(root, "actions");
    try {
      mkdirSync(dir, { recursive: true });
      const lockDir = writeStaleLock(dir, deadOwnerRecord);

      // The delayed breaker determines staleness, then — inside the hook — a
      // live successor claims the canonical path, and only then does the
      // breaker's rename run. The rename must move the successor's live
      // directory, the re-verify must detect the mismatch, restore it, and the
      // breaker must never enter the critical section.
      const delayed = new JsonStoreWriteLock(dir, {
        beforeTakeover: async () => {
          const successorTomb = join(dir, `${JSON_STORE_LOCK_DIRNAME}.tomb-simulated`);
          renameSync(lockDir, successorTomb);
          mkdirSync(lockDir, { recursive: true });
          writeFileSync(
            join(lockDir, "owner"),
            JSON.stringify({ ownerId: "successor", pid: process.pid, starttime: null }),
          );
        },
      });
      await expect(delayed.acquire(Date.now() + 500)).rejects.toThrow(/Timed out/);

      // The live successor must still own the canonical path, untouched.
      const canonicalOwner = JSON.parse(readFileSync(join(lockDir, "owner"), "utf-8")) as { ownerId: string };
      expect(canonicalOwner.ownerId).toBe("successor");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("release never removes a successor's lock", async () => {
    const root = mkdtempSync(join(tmpdir(), "actions-json-lock-release-"));
    const dir = join(root, "actions");
    try {
      mkdirSync(dir, { recursive: true });
      const holder = new JsonStoreWriteLock(dir);
      await holder.acquire(Date.now() + 5_000);

      // Simulate a displacement: the holder's directory is moved away and a
      // successor acquires the canonical path.
      const tomb = join(dir, `${JSON_STORE_LOCK_DIRNAME}.tomb-simulated`);
      renameSync(holder.lockPath, tomb);
      const successor = new JsonStoreWriteLock(dir);
      await successor.acquire(Date.now() + 5_000);

      await holder.release();

      expect(await successor.owns()).toBe(true);
      await successor.release();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a dead acquirer's empty lock directory is reclaimed", async () => {
    const root = mkdtempSync(join(tmpdir(), "actions-json-lock-empty-"));
    const dir = join(root, "actions");
    try {
      // The canonical lock directory exists but has no owner file: a dead
      // acquirer between mkdir and owner write. It must be reclaimable by age.
      writeStaleLock(dir, "");
      const acquirer = new JsonStoreWriteLock(dir);
      await acquirer.acquire(Date.now() + 5_000);
      expect(await acquirer.owns()).toBe(true);
      await acquirer.release();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("three writers racing against a pre-existing stale lock all survive after reopening", async () => {
    const root = mkdtempSync(join(tmpdir(), "actions-json-stale-race-"));
    const dir = join(root, "actions");
    try {
      // The P1 precondition: a stale lock directory with a dead owner is in
      // place, so the first writer takes it over while the others race it.
      mkdirSync(dir, { recursive: true });
      writeStaleLock(dir, deadOwnerRecord);

      const scriptPath = join(root, "writer.ts");
      writeFileSync(scriptPath, concurrentWriterScript);
      const eventsPerWriter = 10;
      const writers = ["writer-a", "writer-b", "writer-c"].map((tag) =>
        Bun.spawn([process.execPath, scriptPath, dir, tag, String(eventsPerWriter)], {
          stdout: "pipe",
          stderr: "pipe",
        }),
      );
      const results = await Promise.all(
        writers.map(async (child) => {
          const [stdout, stderr, exitCode] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
            child.exited,
          ]);
          return { stdout, stderr, exitCode };
        }),
      );
      for (const result of results) {
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe("WRITER OK");
      }

      const store = new JsonActionsStore(dir);
      const events = await store.listAuditEvents();
      expect(events).toHaveLength(eventsPerWriter * 3);
      const ids = new Set(events.map((event) => event.id));
      for (const tag of ["writer-a", "writer-b", "writer-c"]) {
        for (let index = 0; index < eventsPerWriter; index += 1) {
          expect(ids.has(`${tag}-${index}`)).toBe(true);
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
