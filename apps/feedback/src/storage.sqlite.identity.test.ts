import { describe, expect, test } from "bun:test";
import { mkdtemp, symlink } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { tmpdir } from "node:os";
import { SqliteFeedbackStore } from "./storage.sqlite.js";

/**
 * DELIBERATELY IMPORTS ONLY `SqliteFeedbackStore`.
 *
 * This file must be runnable against the PRE-FIX tree, or its pre-fix run
 * proves nothing. An earlier regression test here imported symbols that did
 * not exist on `33b5324`, so running it against that tree failed at IMPORT —
 * and a failure at import is indistinguishable from a failure of the
 * assertion, which is exactly the hole that let the cross-instance deadlock
 * survive an earlier review. Everything below sticks to API present on both
 * trees, and `notify` is an unknown option pre-fix that is simply ignored.
 */
async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "open-feedback-ident-"));
}

function quietStore(dataDir: string): SqliteFeedbackStore {
  return new SqliteFeedbackStore({ dataDir, eventSink: null, taskSink: null, notify: false });
}

/** Four ordinary writes across two stores. Returns rejections and duration. */
async function raceTwoStores(dirA: string, dirB: string): Promise<{ rejected: number; elapsed: number }> {
  const a = quietStore(dirA);
  const b = quietStore(dirB);
  try {
    const ia = await a.createFeedback({ appId: "app", message: "a" });
    const ib = await b.createFeedback({ appId: "app", message: "b" });
    const started = Date.now();
    const settled = await Promise.allSettled([
      a.updateFeedbackStatus(ia.id, "triaged"),
      b.updateFeedbackStatus(ib.id, "triaged"),
      a.updateFeedbackStatus(ia.id, "closed"),
      b.updateFeedbackStatus(ib.id, "closed"),
    ]);
    return {
      rejected: settled.filter((outcome) => outcome.status === "rejected").length,
      elapsed: Date.now() - started,
    };
  } finally {
    a.close();
    b.close();
  }
}

describe("SqliteFeedbackStore database identity", () => {
  /**
   * The mutation chain is keyed on the FILE, not on the path string used to
   * reach it. Keying on `path.resolve` passed every test in the suite and
   * still deadlocked here: `resolve` normalises spelling but follows no
   * symlink, so a symlinked pair got two chains and lost two writes
   * (`rejected=2 elapsed=10059ms`) with everything green.
   *
   * macOS reaches this without anything exotic — `/tmp` is a symlink to
   * `/private/tmp`.
   */
  test("two stores reaching one database through a symlink share a chain", async () => {
    const real = await tempDir();
    const linkParent = await tempDir();
    const link = join(linkParent, "alias");
    await symlink(real, link);

    // The premise of the test: these two spellings are NOT equal under
    // `path.resolve` but ARE the same file. If this ever stops holding, the
    // test below would pass for the wrong reason.
    expect(resolvePath(join(real, "feedback.db"))).not.toBe(resolvePath(join(link, "feedback.db")));

    const { rejected, elapsed } = await raceTwoStores(real, link);
    expect(rejected).toBe(0);
    // The failure burned a full 5s `busy_timeout` per blocked write.
    expect(elapsed).toBeLessThan(2_000);
  }, 30_000);

  /**
   * NEGATIVE CONTROL. Relative-vs-absolute spellings of the same directory
   * were ALREADY unified by `path.resolve`, so this passes on both trees. It
   * is what attributes the failure above to the symlink rather than to the
   * harness — without it, a broken race helper would look like the defect.
   */
  test("relative and absolute spellings of one directory share a chain", async () => {
    const dir = await tempDir();
    const { rejected, elapsed } = await raceTwoStores(dir, join(dir, "sub", ".."));
    expect(rejected).toBe(0);
    expect(elapsed).toBeLessThan(2_000);
  }, 30_000);

  test("a symlinked pair really does resolve to one file", async () => {
    const real = await tempDir();
    const linkParent = await tempDir();
    const link = join(linkParent, "alias");
    await symlink(real, link);
    const store = quietStore(link);
    try {
      expect(realpathSync(join(link, "feedback.db"))).toBe(realpathSync(join(real, "feedback.db")));
    } finally {
      store.close();
    }
  });

  test("distinct databases keep distinct chains", async () => {
    const { rejected, elapsed } = await raceTwoStores(await tempDir(), await tempDir());
    expect(rejected).toBe(0);
    expect(elapsed).toBeLessThan(2_000);
  }, 30_000);
});
