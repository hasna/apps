import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, linkSync, renameSync, writeFileSync } from "node:fs";
import { createSandbox, type Sandbox } from "../testing/sandbox.js";
import { crashingAt, makeTestStore } from "../testing/store.js";
import type { TrashStore } from "./store.js";
import { withFileLockSync } from "./lock.js";
import { join } from "node:path";

let sandbox: Sandbox;
beforeEach(() => { sandbox = createSandbox(); });
afterEach(() => { sandbox.cleanup(); });

test("restore refuses payload changed through a surviving hardlink and retains the entry", () => {
  const store = makeTestStore(sandbox);
  const original = sandbox.file("work/document", "captured bytes");
  const alias = sandbox.path("work/alias");
  linkSync(original, alias);
  const id = store.put(original)[0]!.entryId!;
  writeFileSync(alias, "changed bytes with a different length");
  expect(() => store.restore(id)).toThrow(/integrity/);
  expect(existsSync(original)).toBe(false);
  expect(store.info(id)?.status).toBe("staged");
  expect(existsSync(store.payloadPath(id))).toBe(true);
});

test("restore refuses a parent replaced with a symlink", () => {
  const store = makeTestStore(sandbox);
  const original = sandbox.file("work/document", "captured bytes");
  const id = store.put(original)[0]!.entryId!;
  renameSync(sandbox.path("work"), sandbox.path("old-work"));
  sandbox.symlink(sandbox.dir("elsewhere"), "work");
  expect(() => store.restore(id)).toThrow(/symlink/);
  expect(existsSync(sandbox.path("elsewhere/document"))).toBe(false);
  expect(store.info(id)?.status).toBe("staged");
});

test("a pin acquired during remote verification prevents the sweep commit", async () => {
  let now = Date.now();
  let store: TrashStore;
  store = makeTestStore(sandbox, {
    now: () => now,
    verifyRemote: async (entry) => {
      store.setPinned(entry.id, true);
      return { ...entry.remote! };
    },
  });
  const id = store.put(sandbox.file("expired", "retain me"), { retentionDays: 0 })[0]!.entryId!;
  const entry = store.info(id)!;
  store.recordRemote(id, { key: "synthetic/object", versionId: "v1", sha256: entry.sha256,
    sizeBytes: entry.sizeBytes, confirmedAt: new Date(now).toISOString() });
  now += 1000;
  const result = await store.sweep({ apply: true });
  expect(result.deleted).toHaveLength(0);
  expect(result.kept.some((item) => item.id === id && item.basis === "pinned")).toBe(true);
  expect(store.info(id)?.pinned).toBe(true);
  expect(existsSync(store.payloadPath(id))).toBe(true);
});

test("restore recovery requires matching content before removing its receipt", () => {
  const store = makeTestStore(sandbox, { crashAt: crashingAt("after_restore_move") });
  const original = sandbox.file("work/document", "captured bytes");
  const id = store.put(original)[0]!.entryId!;
  expect(() => store.restore(id)).toThrow();
  writeFileSync(original, "unrelated replacement");
  const report = store.recover();
  expect(report.restoredEntries).not.toContain(id);
  expect(report.unresolvable.some((item) => item.includes(id))).toBe(true);
  expect(store.info(id)).not.toBeNull();
});

test("an entry mutation lock excludes updates, restore, purge and recovery", () => {
  const store = makeTestStore(sandbox);
  const id = store.put(sandbox.file("work/document", "captured bytes"))[0]!.entryId!;
  store.updateEntry(id, (entry) => ({ ...entry, status: "restoring" }));
  withFileLockSync("test", join(store.roots.state, "locks", `${id}.lock`), () => {
    expect(() => store.setPinned(id, true)).toThrow(/lock/);
    expect(() => store.restore(id)).toThrow(/lock/);
    expect(() => store.purge([id], { apply: true })).toThrow(/lock/);
    expect(store.recover().inFlight).toContain(id);
    expect(store.info(id)?.status).toBe("restoring");
    expect(existsSync(store.payloadPath(id))).toBe(true);
  });
});

test("a reentrant metadata update cannot overwrite another mutation", () => {
  const store = makeTestStore(sandbox);
  const id = store.put(sandbox.file("work/document", "captured bytes"))[0]!.entryId!;
  expect(() => store.updateEntry(id, (entry) => {
    store.setPinned(id, true);
    return entry;
  })).toThrow(/lock/);
  expect(store.info(id)?.revision).toBe(1);
});

test("ordinary force and legacy exclusion globs never bypass capture", () => {
  const store = makeTestStore(sandbox, { config: { capture: {
    maxEntryBytes: 2, excludeGlobs: ["**/node_modules/**"],
  } } });
  const path = sandbox.file("project/node_modules/valuable", "cannot capture this");
  const result = store.put(path, { force: true })[0]!;
  expect(result.status).toBe("refused");
  expect(existsSync(path)).toBe(true);
  expect(result.refusals[0]?.deleted).toBe(false);
});

test("default capture remains recoverable for 90 days", () => {
  const store = makeTestStore(sandbox);
  const id = store.put(sandbox.file("work/document", "captured bytes"))[0]!.entryId!;
  const entry = store.info(id)!;
  expect(entry.retentionDays).toBe(90);
  expect(Date.parse(entry.expiresAt!) - Date.parse(entry.capturedAt)).toBe(90 * 86_400_000);
});
