import { describe, test, expect, afterEach } from "bun:test";
import { existsSync, unlinkSync, mkdirSync, openSync, closeSync, utimesSync, rmSync } from "fs";
import { join } from "path";
import { withWriteLock, LockTimeoutError } from "./lock.js";
import { connectorsHome } from "./paths.js";

const TEST_CONNECTOR = `zzztest-lock-${process.pid}`;
const TEST_DIR = join(connectorsHome(), `connect-${TEST_CONNECTOR}`);
const lockFile = join(TEST_DIR, ".write.lock");

afterEach(() => {
  try { unlinkSync(lockFile); } catch { /* already gone */ }
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* already gone */ }
});

describe("withWriteLock", () => {
  test("executes callback and returns result", async () => {
    const result = await withWriteLock(TEST_CONNECTOR, () => 42);
    expect(result).toBe(42);
  });

  test("executes async callback", async () => {
    const result = await withWriteLock(TEST_CONNECTOR, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return "done";
    });
    expect(result).toBe("done");
  });

  test("releases lock after success", async () => {
    await withWriteLock(TEST_CONNECTOR, () => "ok");
    expect(existsSync(lockFile)).toBe(false);
  });

  test("releases lock after callback throws", async () => {
    await expect(withWriteLock(TEST_CONNECTOR, () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(existsSync(lockFile)).toBe(false);
  });

  test("sequential calls both succeed", async () => {
    const r1 = await withWriteLock(TEST_CONNECTOR, () => 1);
    const r2 = await withWriteLock(TEST_CONNECTOR, () => 2);
    expect(r1).toBe(1);
    expect(r2).toBe(2);
  });

  test("concurrent calls serialize (second waits for first)", async () => {
    const order: number[] = [];
    const p1 = withWriteLock(TEST_CONNECTOR, async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push(1);
    });
    // Small delay so p1 acquires lock first
    await new Promise((r) => setTimeout(r, 5));
    const p2 = withWriteLock(TEST_CONNECTOR, async () => {
      order.push(2);
    });
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  test("stale lock (>30s old) is broken and new caller succeeds", async () => {
    // Create a lock file manually then backdate it
    mkdirSync(join(connectorsHome(), `connect-${TEST_CONNECTOR}`), { recursive: true });
    const fd = openSync(lockFile, "wx");
    closeSync(fd);
    const staleTime = new Date(Date.now() - 35_000);
    utimesSync(lockFile, staleTime, staleTime);

    // Should succeed despite lock existing (stale)
    const result = await withWriteLock(TEST_CONNECTOR, () => "recovered");
    expect(result).toBe("recovered");
  });

  test("LockTimeoutError has correct connector name", async () => {
    const err = new LockTimeoutError("stripe");
    expect(err.connector).toBe("stripe");
    expect(err.name).toBe("LockTimeoutError");
    expect(err.message).toContain("stripe");
  });
});
