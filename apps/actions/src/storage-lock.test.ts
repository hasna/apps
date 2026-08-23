import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  JSON_STORE_LOCK_DIRNAME,
  JSON_STORE_LOCK_OWNER_FILE,
  JsonActionsStore,
  releaseJsonStoreLockIfOwned,
  takeOverJsonStoreLock,
} from "./storage.js";

/**
 * Regression coverage for the lock-ownership guarantees the write lock must hold:
 * 1. A stale lock whose holder process is DEAD may be broken (takeover), so a crashed
 *    writer never blocks the store forever.
 * 2. A stale lock whose holder process is STILL ALIVE is never broken, so a suspended or
 *    slow writer keeps its lock and no successor can overlap it (overlapping whole-file
 *    renames is exactly the audit-record loss the lock exists to prevent).
 * 3. Release removes a lock only while the releasing process still owns it, so a stale
 *    holder whose lock was taken over can never delete the successor's live lock.
 * 4. A takeover moves only the OWNER FILE — the lock directory never leaves the
 *    canonical path — so a delayed breaker can never expose an empty lock path that a
 *    third writer could acquire into while a live owner continues.
 */
function readOwner(lockPath: string): { token: string } {
  return JSON.parse(
    readFileSync(join(lockPath, JSON_STORE_LOCK_OWNER_FILE), "utf8"),
  ) as { token: string };
}

function sampleEvent(id: string) {
  return {
    id,
    runId: "run-shared",
    actionId: "test.action",
    type: "action.planned" as const,
    time: new Date().toISOString(),
    severity: "info" as const,
    message: "planned",
    data: {},
    metadata: {},
  };
}

describe("JsonActionsStore write-lock ownership", () => {
  test("a stale lock whose holder pid is dead is broken and the write proceeds", async () => {
    const root = mkdtempSync(join(tmpdir(), "actions-json-lock-dead-"));
    const dir = join(root, "actions");
    const lockPath = join(dir, JSON_STORE_LOCK_DIRNAME);
    try {
      mkdirSync(lockPath, { recursive: true });
      writeFileSync(
        join(lockPath, JSON_STORE_LOCK_OWNER_FILE),
        JSON.stringify({ token: "dead-holder", pid: 99999999, host: "test", startedAt: new Date().toISOString() }),
      );
      const past = new Date(Date.now() - 60_000);
      utimesSync(lockPath, past, past);

      const store = new JsonActionsStore(dir);
      await store.appendAuditEvent(sampleEvent("after-takeover"));

      expect(existsSync(lockPath)).toBe(false);
      const events = await store.listAuditEvents();
      expect(events.some((event) => event.id === "after-takeover")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a stale lock whose holder is still alive is never broken", async () => {
    const root = mkdtempSync(join(tmpdir(), "actions-json-lock-live-"));
    const dir = join(root, "actions");
    const lockPath = join(dir, JSON_STORE_LOCK_DIRNAME);
    try {
      mkdirSync(lockPath, { recursive: true });
      writeFileSync(
        join(lockPath, JSON_STORE_LOCK_OWNER_FILE),
        JSON.stringify({ token: "live-holder", pid: process.pid, host: "test", startedAt: new Date().toISOString() }),
      );
      const past = new Date(Date.now() - 60_000);
      utimesSync(lockPath, past, past);

      const store = new JsonActionsStore(dir);
      await expect(store.appendAuditEvent(sampleEvent("must-not-overlap"))).rejects.toThrow(
        /Timed out waiting for the actions JSON store write lock/,
      );
      // The live holder's lock must still be in place afterwards: no successor took it.
      expect(existsSync(lockPath)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 25_000);

  test("a delayed takeover that validated a stale lock cannot delete a successor's fresh lock", async () => {
    // Interleaving under test: waiter B validated the stale dead-owner lock, then was
    // preempted. Waiter A took over and installed its fresh live lock. B's delayed
    // takeover must move A's fresh owner file aside, recognize it is NOT the validated
    // stale lock, and restore it — never delete it, and never empty the canonical
    // lock path (the directory stays in place throughout).
    const root = mkdtempSync(join(tmpdir(), "actions-json-lock-race-"));
    const lockPath = join(root, JSON_STORE_LOCK_DIRNAME);
    const quarantine = join(root, `${JSON_STORE_LOCK_DIRNAME}.quarantine-test`);
    const validated = { token: "stale-holder", pid: 99999999, host: "test", startedAt: new Date().toISOString() };
    const myOwner = { token: "breaker-b", pid: process.pid, host: "test", startedAt: new Date().toISOString() };
    try {
      // B's validated stale lock is already gone; the lock now holds A's fresh owner.
      mkdirSync(lockPath, { recursive: true });
      writeFileSync(
        join(lockPath, JSON_STORE_LOCK_OWNER_FILE),
        JSON.stringify({ token: "successor-a", pid: process.pid, host: "test", startedAt: new Date().toISOString() }),
      );
      const staleMtime = new Date(Date.now() - 60_000);
      utimesSync(lockPath, staleMtime, staleMtime);

      const vacated = await takeOverJsonStoreLock(lockPath, validated, myOwner, quarantine);

      // The successor's lock must be back in place, still owned by successor-a, and
      // the canonical lock path must never have been absent.
      expect(vacated).toBe(false);
      expect(existsSync(lockPath)).toBe(true);
      expect(readOwner(lockPath).token).toBe("successor-a");
      expect(existsSync(quarantine)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a takeover of an already-vacated stale lock is a no-op", async () => {
    const root = mkdtempSync(join(tmpdir(), "actions-json-lock-vacated-"));
    const lockPath = join(root, JSON_STORE_LOCK_DIRNAME);
    const quarantine = join(root, `${JSON_STORE_LOCK_DIRNAME}.quarantine-test`);
    const validated = { token: "stale-holder", pid: 99999999, host: "test", startedAt: new Date().toISOString() };
    const myOwner = { token: "breaker-b", pid: process.pid, host: "test", startedAt: new Date().toISOString() };
    try {
      const vacated = await takeOverJsonStoreLock(lockPath, validated, myOwner, quarantine);
      expect(vacated).toBe(false);
      expect(existsSync(lockPath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a third writer can never acquire into a delayed breaker's takeover window (three-party interleaving)", async () => {
    // Interleaving under test: breaker B validated the dead-owner lock, then was
    // preempted. Successor C takes over (installs its live owner). B resumes and
    // moves the owner file out — but the lock DIRECTORY never leaves the canonical
    // path, so third writer D's `mkdir` keeps failing EEXIST at every instant, and a
    // D that samples the owner file while it is momentarily absent must not treat
    // the missing owner as grounds to take over a live critical section. C's records
    // are therefore never overlapped.
    const root = mkdtempSync(join(tmpdir(), "actions-json-lock-three-"));
    const lockPath = join(root, JSON_STORE_LOCK_DIRNAME);
    const deadOwner = { token: "stale-holder", pid: 99999999, host: "test", startedAt: new Date().toISOString() };
    const ownerC = { token: "successor-c", pid: process.pid, host: "test", startedAt: new Date().toISOString() };
    const ownerB = { token: "breaker-b", pid: process.pid, host: "test", startedAt: new Date().toISOString() };
    const ownerD = { token: "writer-d", pid: process.pid, host: "test", startedAt: new Date().toISOString() };
    try {
      mkdirSync(lockPath, { recursive: true });
      writeFileSync(join(lockPath, JSON_STORE_LOCK_OWNER_FILE), JSON.stringify(deadOwner));
      const staleMtime = new Date(Date.now() - 60_000);
      utimesSync(lockPath, staleMtime, staleMtime);

      // C takes over the dead lock and installs its live owner.
      const tookOverC = await takeOverJsonStoreLock(
        lockPath, deadOwner, ownerC, join(root, `${JSON_STORE_LOCK_DIRNAME}.quarantine-c`),
      );
      expect(tookOverC).toBe(true);
      expect(existsSync(lockPath)).toBe(true);
      expect(readOwner(lockPath).token).toBe("successor-c");

      // B (delayed, still validating the long-gone dead owner) performs its move.
      const tookOverB = await takeOverJsonStoreLock(
        lockPath, deadOwner, ownerB, join(root, `${JSON_STORE_LOCK_DIRNAME}.quarantine-b`),
      );
      expect(tookOverB).toBe(false);
      // C's owner is restored; the canonical lock path never left place.
      expect(existsSync(lockPath)).toBe(true);
      expect(readOwner(lockPath).token).toBe("successor-c");
      expect(existsSync(join(root, `${JSON_STORE_LOCK_DIRNAME}.quarantine-b`))).toBe(false);

      // D's entry point: `mkdir` on the canonical path fails EEXIST — the directory
      // is present at every instant of the interleaving, so D can never enter while C
      // continues. D's own takeover attempt with the long-dead validation must also
      // fail against the missing owner (B's window) and leave C's lock intact.
      expect(() => mkdirSync(lockPath)).toThrow(/EEXIST|already exists/); // path never empty
      const ownerFile = join(lockPath, JSON_STORE_LOCK_OWNER_FILE);
      rmSync(ownerFile, { force: true }); // simulate D sampling inside B's move window
      const tookOverD = await takeOverJsonStoreLock(
        lockPath, deadOwner, ownerD, join(root, `${JSON_STORE_LOCK_DIRNAME}.quarantine-d`),
      );
      expect(tookOverD).toBe(false);
      expect(existsSync(lockPath)).toBe(true);
      // B's restore lands; C still owns the lock. No third writer entered.
      writeFileSync(ownerFile, JSON.stringify(ownerC));
      expect(readOwner(lockPath).token).toBe("successor-c");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("release removes only a lock this process still owns", async () => {
    const root = mkdtempSync(join(tmpdir(), "actions-json-lock-release-"));
    const lockPath = join(root, JSON_STORE_LOCK_DIRNAME);
    try {
      mkdirSync(lockPath, { recursive: true });
      writeFileSync(
        join(lockPath, JSON_STORE_LOCK_OWNER_FILE),
        JSON.stringify({ token: "successor", pid: process.pid, host: "test", startedAt: new Date().toISOString() }),
      );

      // A stale holder (token "original") releasing after a takeover must not delete the
      // successor's lock.
      await releaseJsonStoreLockIfOwned(lockPath, "original");
      expect(existsSync(lockPath)).toBe(true);

      // The current owner's release does remove it.
      await releaseJsonStoreLockIfOwned(lockPath, "successor");
      expect(existsSync(lockPath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
