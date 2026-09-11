/**
 * Restore and the explicit destructive verbs (purge / empty).
 *
 * The property that matters is byte-identity: a restore must return the SAME
 * bytes, not equivalent ones. A digest taken before the capture is compared
 * against a digest taken after the restore, and for a tree the comparison is
 * over every file — restore is the operation that decides whether a trash is
 * trustworthy at all.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, readFileSync, readlinkSync, statSync } from "node:fs";
import { createSandbox, type Sandbox } from "../testing/sandbox.js";
import { CrashSentinel, crashingAt, makeTestStore } from "../testing/store.js";
import { TrashStore } from "./store.js";
import { hashPath } from "./hash.js";
import { testEnv } from "../testing/sandbox.js";

let sandbox: Sandbox;

beforeEach(() => {
  sandbox = createSandbox();
});

afterEach(() => {
  sandbox.cleanup();
});

describe("restore", () => {
  test("returns byte-identical content to the original path", () => {
    const store = makeTestStore(sandbox);
    const original = sandbox.file("work/report.md", "# report\nbody bytes\n");
    const before = hashPath(original, { maxBytes: 1024 });

    const id = store.put(original)[0]!.entryId!;
    expect(existsSync(original)).toBe(false);

    const result = store.restore(id);

    expect(result.restoredTo).toBe(original);
    expect(existsSync(original)).toBe(true);
    const after = hashPath(original, { maxBytes: 1024 });
    expect(after.sha256).toBe(before.sha256);
    expect(readFileSync(original, "utf8")).toBe("# report\nbody bytes\n");
    // The entry is gone from the store: the bytes no longer exist twice.
    expect(store.info(id)).toBeNull();
    expect(existsSync(store.payloadPath(id))).toBe(false);
  });

  test("--to restores beside the original when the original path is occupied", () => {
    const store = makeTestStore(sandbox);
    const original = sandbox.file("work/notes.txt", "original bytes");
    const id = store.put(original)[0]!.entryId!;
    // Something else now occupies the original path.
    sandbox.file("work/notes.txt", "a newer file");

    const destination = sandbox.path("work/notes.restored.txt");
    const result = store.restore(id, { to: destination });

    expect(result.restoredTo).toBe(destination);
    expect(readFileSync(destination, "utf8")).toBe("original bytes");
    expect(readFileSync(original, "utf8")).toBe("a newer file");
  });

  test("refuses to clobber an occupied destination, and the entry stays restorable", () => {
    const store = makeTestStore(sandbox);
    const original = sandbox.file("work/keep.txt", "captured bytes");
    const id = store.put(original)[0]!.entryId!;
    sandbox.file("work/keep.txt", "do not overwrite me");

    expect(() => store.restore(id)).toThrow(/refusing to restore over/);

    expect(readFileSync(original, "utf8")).toBe("do not overwrite me");
    const entry = store.info(id)!;
    expect(entry.status).toBe("staged");
    expect(existsSync(store.payloadPath(id))).toBe(true);
  });

  test("restores a directory tree with every member intact", () => {
    const store = makeTestStore(sandbox);
    sandbox.file("proj/a.txt", "a");
    sandbox.file("proj/nested/b.txt", "b");
    sandbox.file("proj/nested/deeper/c.txt", "c");
    const dir = sandbox.path("proj");
    const before = hashPath(dir, { maxBytes: 1024 });

    const id = store.put(dir)[0]!.entryId!;
    const result = store.restore(id);

    expect(result.restoredTo).toBe(dir);
    expect(hashPath(dir, { maxBytes: 1024 }).sha256).toBe(before.sha256);
    expect(readFileSync(`${dir}/nested/deeper/c.txt`, "utf8")).toBe("c");
  });

  test("restores a symlink as a symlink, still pointing at the same target", () => {
    const store = makeTestStore(sandbox);
    const target = sandbox.file("real.txt", "target bytes");
    const link = sandbox.symlink(target, "link.txt");
    const id = store.put(link)[0]!.entryId!;

    const result = store.restore(id);

    expect(result.restoredTo).toBe(link);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(target);
    expect(readFileSync(target, "utf8")).toBe("target bytes");
  });

  test("refuses an unknown id and an entry that is mid-restore", () => {
    const store = makeTestStore(sandbox);
    expect(() => store.restore("00000000-0000-4000-8000-000000000000")).toThrow(/no such entry/);

    const id = store.put(sandbox.file("x.txt", "x"))[0]!.entryId!;
    store.updateEntry(id, (entry) => ({ ...entry, status: "restoring" }));
    expect(() => store.restore(id)).toThrow(/race another operation/);
  });

  test("a crash after the bytes move is completed by recovery, not by a second move", () => {
    const spool = sandbox.path("spool");
    const store = makeTestStore(sandbox, { spool, crashAt: crashingAt("after_restore_move") });
    const original = sandbox.file("work/crash.txt", "crash-restore bytes");
    const id = store.put(original)[0]!.entryId!;

    expect(() => store.restore(id)).toThrow(CrashSentinel);
    // The bytes ARE back in place; only the metadata removal was interrupted.
    expect(readFileSync(original, "utf8")).toBe("crash-restore bytes");
    expect(existsSync(store.payloadPath(id))).toBe(false);

    const reopened = new TrashStore({ env: testEnv(sandbox), roots: { root: spool } });
    const report = reopened.init();

    expect(report.restoredEntries).toContain(id);
    expect(reopened.info(id)).toBeNull();
    expect(readFileSync(original, "utf8")).toBe("crash-restore bytes");
  });

  test("an interrupted restore whose bytes never moved rolls back to restorable", () => {
    const spool = sandbox.path("spool");
    const store = makeTestStore(sandbox, { spool });
    const original = sandbox.file("work/still-there.txt", "still in the store");
    const id = store.put(original)[0]!.entryId!;
    // Simulate the state a crash between "mark restoring" and "move" leaves.
    store.updateEntry(id, (entry) => ({ ...entry, status: "restoring", restoredTo: original }));

    const report = store.recover();

    expect(report.pendingRestores).toContain(id);
    expect(store.info(id)!.status).toBe("staged");
    expect(existsSync(store.payloadPath(id))).toBe(true);
    // And it is restorable again.
    expect(store.restore(id).restoredTo).toBe(original);
    expect(readFileSync(original, "utf8")).toBe("still in the store");
  });
});

describe("purge and empty", () => {
  test("purge is a dry run until --apply, and then removes payload and metadata together", () => {
    const store = makeTestStore(sandbox);
    const id = store.put(sandbox.file("a.txt", "a"))[0]!.entryId!;

    const dry = store.purge([id]);
    expect(dry.dryRun).toBe(true);
    expect(dry.purged).toHaveLength(0);
    expect(existsSync(store.payloadPath(id))).toBe(true);
    expect(store.info(id)).not.toBeNull();

    const applied = store.purge([id], { apply: true });
    expect(applied.purged).toEqual([id]);
    expect(applied.bytes).toBe(1);
    expect(existsSync(store.payloadPath(id))).toBe(false);
    expect(store.info(id)).toBeNull();
    expect(store.list()).toHaveLength(0);
  });

  test("purge removes a directory payload recursively, and only that payload", () => {
    const store = makeTestStore(sandbox);
    sandbox.file("tree/inner/file.txt", "inner");
    const id = store.put(sandbox.path("tree"))[0]!.entryId!;

    store.purge([id], { apply: true });

    expect(existsSync(store.payloadPath(id))).toBe(false);
    // The rest of the store is untouched.
    expect(statSync(store.roots.info).isDirectory()).toBe(true);
  });

  test("empty clears the whole store only with apply", () => {
    const store = makeTestStore(sandbox);
    for (let i = 0; i < 3; i += 1) store.put(sandbox.file(`bulk/f${i}.txt`, `f${i}`));
    expect(store.list()).toHaveLength(3);

    expect(store.empty().dryRun).toBe(true);
    expect(store.list()).toHaveLength(3);

    const result = store.empty({ apply: true });
    expect(result.purged).toHaveLength(3);
    expect(store.list()).toHaveLength(0);
  });

  test("purge removes a pinned entry too — pinning protects against the SWEEPER, not against the operator", () => {
    const store = makeTestStore(sandbox);
    const id = store.put(sandbox.file("pinned.txt", "pin me"))[0]!.entryId!;
    store.setPinned(id, true);

    expect(store.purge([id], { apply: true }).purged).toEqual([id]);
    expect(store.info(id)).toBeNull();
  });
});
