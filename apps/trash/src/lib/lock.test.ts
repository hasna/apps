/**
 * The mutating-sweep lock.
 *
 * The behaviour that matters is not "it excludes" — it is that RELEASE IS
 * OWNERSHIP-VALIDATED. A sweep that overruns the stale threshold is declared
 * dead, a second sweep takes the lock, and the first sweep's `finally` must not
 * then unlink the second sweep's lock file (which would let a third in while
 * the second is still mutating). One test here is that exact interleaving.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createSandbox, type Sandbox } from "../testing/sandbox.js";
import { lockIsHeld, withFileLock, withFileLockSync } from "./lock.js";

let sandbox: Sandbox;

beforeEach(() => {
  sandbox = createSandbox();
});

afterEach(() => {
  sandbox.cleanup();
});

function lockPath(): string {
  return sandbox.path("state/.lock");
}

function writeLock(token: string, ageMs = 0): void {
  const path = lockPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ token, pid: 1, acquiredAt: new Date().toISOString() })}\n`);
  const stamp = new Date(Date.now() - ageMs);
  utimesSync(path, stamp, stamp);
}

describe("withFileLock", () => {
  test("runs the body, in a lock that is visible while held and gone afterwards", async () => {
    const observed: string[] = [];
    const result = await withFileLock("sweep", lockPath(), () => {
      observed.push(lockIsHeld(lockPath()) ? "held" : "free");
      const body = JSON.parse(readFileSync(lockPath(), "utf8")) as { token: string; pid: number };
      expect(typeof body.token).toBe("string");
      expect(body.pid).toBe(process.pid);
      return 42;
    });

    expect(result).toBe(42);
    expect(observed).toEqual(["held"]);
    expect(existsSync(lockPath())).toBe(false);
  });

  test("a body that throws still releases the lock", async () => {
    await expect(
      withFileLock("sweep", lockPath(), () => {
        throw new Error("the sweep failed halfway");
      }),
    ).rejects.toThrow(/halfway/);
    expect(existsSync(lockPath())).toBe(false);
  });

  test("the release is ownership-validated: a taken-over lock is NOT deleted by its first holder", async () => {
    // The interleaving §12 warns about. Sweep A overruns 30 s, sweep B declares
    // it stale and takes the lock, then A finishes. An unconditional release
    // would unlink B's lock file and let a third sweeper in beside B.
    await withFileLock("sweep", lockPath(), () => {
      writeLock("holder-B");
      return "A finished";
    });

    expect(existsSync(lockPath())).toBe(true);
    expect((JSON.parse(readFileSync(lockPath(), "utf8")) as { token: string }).token).toBe("holder-B");
  });

  test("a lock that another holder already removed is not an error", async () => {
    await withFileLock("sweep", lockPath(), () => {
      unlinkSync(lockPath());
    });
    expect(existsSync(lockPath())).toBe(false);
  });

  test("a lock nobody holds is not reported as held", () => {
    expect(lockIsHeld(lockPath())).toBe(false);
  });

  test("age alone never permits taking over a lock", async () => {
    writeLock("long-dead", 10 * 60_000);
    expect(lockIsHeld(lockPath())).toBe(true);
  });

  test("a live holder remains exclusive after its timestamp becomes old", async () => {
    await withFileLock("sweep", lockPath(), async () => {
      const stamp = new Date(Date.now() - 60_000);
      utimesSync(lockPath(), stamp, stamp);
      let entered = false;
      await expect(withFileLock("sweep", lockPath(), () => { entered = true; }, { timeoutMs: 20 })).rejects.toThrow(/lock/);
      expect(entered).toBe(false);
      expect(lockIsHeld(lockPath())).toBe(true);
    });
  });

  test("a lock with a fresh mtime is respected (not stale)", () => {
    writeLock("live", 0);
    expect(lockIsHeld(lockPath())).toBe(true);
  });
});

test("synchronous source acquisition waits for a sibling process without stealing a held lock", async () => {
  writeLock("sibling");
  const child = Bun.spawn({ cmd: [process.execPath, "-e", 'setTimeout(() => require("node:fs").unlinkSync(process.argv[1]), 50)', lockPath()], stdout: "ignore", stderr: "pipe" });
  try {
    expect(withFileLockSync("source", lockPath(), () => 42, { timeoutMs: 1500 })).toBe(42);
    expect(existsSync(lockPath())).toBe(false);
  } finally { await child.exited; }
});
test("synchronous acquisition times out without entering or replacing the holder", () => {
  writeLock("still-held"); let entered = false;
  expect(() => withFileLockSync("source", lockPath(), () => { entered = true; }, { timeoutMs: 20 })).toThrow();
  expect(entered).toBe(false); expect(JSON.parse(readFileSync(lockPath(), "utf8")).token).toBe("still-held");
});
