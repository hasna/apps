/**
 * The capture path: what moves, what must NOT move, and what happens when the
 * process dies in the middle of it.
 *
 * Every fixture lives inside a fresh `mkdtemp` sandbox (see
 * `src/testing/sandbox.ts`), and the store is always built with an explicit
 * spool under that sandbox — the real `~/.hasna/trash` is not reachable from
 * these tests even if one of them is wrong.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, linkSync, lstatSync, readFileSync, readdirSync, readlinkSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { createSandbox, createSandboxAt, readdirCount, spawnEnv, testEnv, type Sandbox } from "../testing/sandbox.js";
import { CrashSentinel, crashingAt, makeTestStore } from "../testing/store.js";
import { TrashStore } from "./store.js";
import { listRefusals } from "./refusals.js";
import { inspectSource } from "./inspect.js";
import { createEntry } from "./entry.js";

let sandbox: Sandbox;

beforeEach(() => {
  sandbox = createSandbox();
});

afterEach(() => {
  sandbox.cleanup();
});

describe("put — the move", () => {
  test("captures a loose file, removing the original name", () => {
    const store = makeTestStore(sandbox);
    const original = sandbox.file("work/notes.txt", "hello trash\n");

    const outcome = store.put(original)[0]!;

    expect(outcome.status).toBe("captured");
    expect(outcome.entryId).not.toBeNull();
    expect(existsSync(original)).toBe(false);

    const entry = store.info(outcome.entryId!)!;
    expect(entry.kind).toBe("file");
    expect(entry.sizeBytes).toBe(12);
    expect(entry.originalPath).toBe(original);
    expect(entry.status).toBe("staged");
    expect(entry.remote).toBeNull();
    expect(entry.pinned).toBe(false);
    expect(readFileSync(store.payloadPath(entry.id), "utf8")).toBe("hello trash\n");
    // The payload is its own inode: the original name is gone and the inode
    // lives on under the entry id.
    expect(lstatSync(store.payloadPath(entry.id)).nlink).toBe(1);
  });

  test("captures a directory tree with rename, not link", () => {
    const store = makeTestStore(sandbox);
    sandbox.file("proj/src/a.ts", "a");
    sandbox.file("proj/src/nested/b.ts", "b");
    const dir = sandbox.path("proj");

    const outcome = store.put(dir)[0]!;

    expect(outcome.status).toBe("captured");
    expect(existsSync(dir)).toBe(false);
    const entry = store.info(outcome.entryId!)!;
    expect(entry.kind).toBe("dir");
    expect(existsSync(`${store.payloadPath(entry.id)}/src/nested/b.ts`)).toBe(true);
  });

  test("a relative path resolves against the given cwd, and the audit keeps what was typed", () => {
    const store = makeTestStore(sandbox);
    const target = sandbox.file("cwd/relative.txt", "x");

    const outcome = store.put("relative.txt", { cwd: sandbox.path("cwd") })[0]!;

    expect(outcome.status).toBe("captured");
    const entry = store.info(outcome.entryId!)!;
    expect(entry.givenPath).toBe("relative.txt");
    expect(entry.originalPath).toBe(target);
  });

  test("a missing path is not an error (rm -f semantics)", () => {
    const store = makeTestStore(sandbox);
    const outcome = store.put(sandbox.path("nope.txt"))[0]!;
    expect(outcome.status).toBe("missing");
    expect(outcome.entryId).toBeNull();
  });
});

describe("put — symlinks are objects, never targets", () => {
  test("a symlink is trashed as a symlink and its TARGET survives intact", () => {
    const store = makeTestStore(sandbox);
    const target = sandbox.file("real/data.txt", "precious");
    const link = sandbox.symlink(target, "work/link.txt");

    const outcome = store.put(link)[0]!;

    expect(outcome.status).toBe("captured");
    const entry = store.info(outcome.entryId!)!;
    expect(entry.kind).toBe("symlink");
    expect(existsSync(link)).toBe(false);
    expect(readFileSync(target, "utf8")).toBe("precious");
    // The payload is the LINK, not a copy of the target, and it still points
    // where it pointed.
    const payload = store.payloadPath(entry.id);
    expect(lstatSync(payload).isSymbolicLink()).toBe(true);
    expect(readlinkSync(payload)).toBe(target);
  });

  test("a trailing slash does not turn a symlink into the directory it points at", () => {
    // `lstat("link/")` reports a directory; the trailing slash is stripped
    // before `lstat`, so the link is captured as an object. This is the
    // trash-cli bug where `trash node_modules/Butaro/` removed the TARGET.
    const store = makeTestStore(sandbox);
    const target = sandbox.dir("real-dir");
    sandbox.file("real-dir/keep.txt", "keep");
    const link = sandbox.symlink(target, "link-dir");

    const outcome = store.put(`${link}/`)[0]!;

    expect(outcome.status).toBe("captured");
    expect(store.info(outcome.entryId!)!.kind).toBe("symlink");
    expect(readFileSync(`${target}/keep.txt`, "utf8")).toBe("keep");
    expect(existsSync(link)).toBe(false);
  });

  test("a path through a symlinked ancestor is refused, not traversed", () => {
    const store = makeTestStore(sandbox);
    const realFile = sandbox.file("real/file.txt", "keep me");
    sandbox.symlink(sandbox.path("real"), "linked");

    const outcome = store.put(`${sandbox.path("linked")}/file.txt`)[0]!;

    expect(outcome.status).toBe("refused");
    expect(outcome.detail).toContain("symlink");
    expect(readFileSync(realFile, "utf8")).toBe("keep me");
    const refusals = listRefusals(store.roots.refusals);
    expect(refusals[0]!.reason).toBe("symlink_component");
    expect(refusals[0]!.deleted).toBe(false);
  });

  test("a dangling symlink is still a capture (the object is the target string)", () => {
    const store = makeTestStore(sandbox);
    const link = sandbox.symlink(sandbox.path("does-not-exist"), "dangling");
    const outcome = store.put(link)[0]!;
    expect(outcome.status).toBe("captured");
    expect(store.info(outcome.entryId!)!.kind).toBe("symlink");
    expect(existsSync(link)).toBe(false);
  });
});

describe("put — §11.7, the load-bearing refusal rule", () => {
  const SMALL_CAP = { capture: { maxEntryBytes: 32 } };

  test("capture refused on a NON-excluded path ⇒ the DELETE is refused and the path stays", () => {
    const store = makeTestStore(sandbox, { config: SMALL_CAP });
    const big = sandbox.file("work/big.bin", "x".repeat(64));

    const outcome = store.put(big)[0]!;

    expect(outcome.status).toBe("refused");
    expect(outcome.entryId).toBeNull();
    expect(existsSync(big)).toBe(true);
    expect(readFileSync(big, "utf8").length).toBe(64);
    expect(store.list()).toHaveLength(0);

    const refusals = listRefusals(store.roots.refusals);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]!.reason).toBe("too_large");
    expect(refusals[0]!.excluded).toBe(false);
    expect(refusals[0]!.deleted).toBe(false);
    expect(refusals[0]!.excludeGlob).toBeNull();
  });

  test("capture refused on an EXCLUDED path ⇒ the delete PROCEEDS and the refusal is recorded", () => {
    const store = makeTestStore(sandbox, { config: SMALL_CAP });
    const big = sandbox.file("proj/node_modules/big.bin", "x".repeat(64));

    const outcome = store.put(big)[0]!;

    expect(outcome.status).toBe("deleted_without_capture");
    expect(existsSync(big)).toBe(false);
    // Nothing entered the store: the delete was not captured, it was recorded.
    expect(store.list()).toHaveLength(0);

    const refusals = listRefusals(store.roots.refusals);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]!.reason).toBe("too_large");
    expect(refusals[0]!.excluded).toBe(true);
    expect(refusals[0]!.excludeGlob).toBe("**/node_modules/**");
    expect(refusals[0]!.deleted).toBe(true);
  });

  test("--force lets a non-excluded refusal through, and the record says it was forced", () => {
    const store = makeTestStore(sandbox, { config: SMALL_CAP });
    const big = sandbox.file("work/big.bin", "x".repeat(64));

    const outcome = store.put(big, { force: true })[0]!;

    expect(outcome.status).toBe("deleted_without_capture");
    expect(existsSync(big)).toBe(false);
    const refusals = listRefusals(store.roots.refusals);
    expect(refusals[0]!.forced).toBe(true);
    expect(refusals[0]!.deleted).toBe(true);
    expect(refusals[0]!.excluded).toBe(false);
  });

  test("a protected path is refused even WITH --force", () => {
    const store = makeTestStore(sandbox);
    const storeRoots = store.put(store.roots.files, { force: true })[0]!;
    expect(storeRoots.status).toBe("refused");
    expect(storeRoots.detail).toContain("protected");
    const homeOutcome = store.put(sandbox.path("home"), { force: true })[0]!;
    expect(homeOutcome.status).toBe("refused");
    expect(existsSync(sandbox.path("home"))).toBe(true);
  });

  test("a refusal inside an excluded tree does not stop a later capture of a good file", () => {
    const store = makeTestStore(sandbox, { config: SMALL_CAP });
    sandbox.file("proj/node_modules/huge.bin", "x".repeat(64));
    const good = sandbox.file("proj/src/small.txt", "small");

    const outcomes = store.put([sandbox.path("proj/node_modules/huge.bin"), good]);

    expect(outcomes[0]!.status).toBe("deleted_without_capture");
    expect(outcomes[1]!.status).toBe("captured");
    expect(store.list()).toHaveLength(1);
  });
});

describe("put — cross-device is refused, never copied", () => {
  test("a source on another device is refused and left exactly where it was", () => {
    let shmSandbox: Sandbox;
    try {
      shmSandbox = createSandboxAt("/dev/shm");
    } catch {
      return; // no /dev/shm on this machine — the refusal is untestable here
    }
    try {
      const spool = sandbox.path("spool");
      const store = makeTestStore(sandbox, { spool });
      store.init();
      const source = shmSandbox.file("payload.bin", "cross-device content");
      if (statSync(shmSandbox.root).dev === statSync(spool).dev) return; // same filesystem

      const outcome = store.put(source)[0]!;

      expect(outcome.status).toBe("refused");
      expect(outcome.detail).toContain("EXDEV is refused, never copied");
      expect(existsSync(source)).toBe(true);
      expect(readFileSync(source, "utf8")).toBe("cross-device content");
      expect(listRefusals(store.roots.refusals).map((r) => r.reason)).toContain("cross_device");
      // Nothing was left behind: no payload, no metadata, no intent.
      expect(store.list()).toHaveLength(0);
      expect(readdirCount(store.roots.files)).toBe(0);
      expect(readdirCount(store.roots.intents)).toBe(0);
    } finally {
      shmSandbox.cleanup();
    }
  });
});

describe("put — crash mid-publish, then recovery", () => {
  test("a crash after the intent, before the move: the source is intact and recovery abandons the intent", () => {
    const file = sandbox.file("work/keep.txt", "still here");
    const spool = sandbox.path("spool");
    const store = makeTestStore(sandbox, { spool, crashAt: crashingAt("after_intent") });

    expect(() => store.put(file)).toThrow(CrashSentinel);

    expect(existsSync(file)).toBe(true);
    expect(readdirCount(store.roots.intents)).toBe(1);

    const reopened = new TrashStore({ env: testEnv(sandbox), roots: { root: spool } });
    const report = reopened.init();

    expect(report.scanned).toBe(1);
    expect(report.abortedIntents).toHaveLength(1);
    expect(report.completedPublishes).toHaveLength(0);
    expect(reopened.list()).toHaveLength(0);
    expect(existsSync(file)).toBe(true);
    expect(readdirCount(reopened.roots.intents)).toBe(0);
  });

  test("a crash after the move, before the metadata: recovery COMPLETES the publish", () => {
    const file = sandbox.file("work/mid.txt", "moved but unindexed");
    const spool = sandbox.path("spool");
    const store = makeTestStore(sandbox, { spool, crashAt: crashingAt("after_payload") });

    expect(() => store.put(file)).toThrow(CrashSentinel);
    expect(existsSync(file)).toBe(false);
    expect(readdirCount(store.roots.files)).toBe(1);
    expect(readdirCount(store.roots.info)).toBe(0);

    const reopened = new TrashStore({ env: testEnv(sandbox), roots: { root: spool } });
    const report = reopened.init();

    expect(report.completedPublishes).toHaveLength(1);
    const entries = reopened.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.originalPath).toBe(file);
    expect(readFileSync(reopened.payloadPath(entries[0]!.id), "utf8")).toBe("moved but unindexed");
    expect(readdirCount(reopened.roots.intents)).toBe(0);
  });

  test("a crash after the metadata, before the intent is dropped: recovery keeps the entry", () => {
    const file = sandbox.file("work/done.txt", "captured");
    const spool = sandbox.path("spool");
    const store = makeTestStore(sandbox, { spool, crashAt: crashingAt("after_metadata") });

    expect(() => store.put(file)).toThrow(CrashSentinel);
    expect(readdirCount(store.roots.info)).toBe(1);
    expect(readdirCount(store.roots.intents)).toBe(1);

    const reopened = new TrashStore({ env: testEnv(sandbox), roots: { root: spool } });
    const report = reopened.init();

    expect(report.staleIntents).toHaveLength(1);
    expect(report.completedPublishes).toHaveLength(0);
    expect(reopened.list()).toHaveLength(1);
    expect(readdirCount(reopened.roots.intents)).toBe(0);
    // Recovery never removes a published entry or its payload.
    expect(readdirCount(reopened.roots.files)).toBe(1);
  });

  test("recovery never unlinks a path whose inode is not the one that was captured", () => {
    // The intent records an identity that does NOT match what is at the path.
    // A naive recovery unlinks the path anyway — destroying a file it never
    // captured. This one compares `st_dev`/`st_ino`, leaves the file alone, and
    // reports the intent as unresolvable instead of guessing.
    const spool = sandbox.path("spool");
    const store = makeTestStore(sandbox, { spool });
    store.init();

    const path = sandbox.file("work/replaced.txt", "someone else's file");
    const at = statSync(path);
    const id = "11111111-1111-4111-8111-111111111111";
    const entry = createEntry({
      id,
      originalPath: path,
      givenPath: path,
      capturedAt: new Date().toISOString(),
      kind: "file",
      sizeBytes: 7,
      sha256: "0".repeat(64),
      device: at.dev,
      // One off the real inode: the comparison is what protects the file, and
      // an inode number can be recycled, so this must never be treated as a
      // licence to unlink.
      inode: at.ino + 1,
      nlink: 1,
      mode: 0o644,
      retentionDays: 30,
      expiresAt: null,
    });
    writeFileSync(
      `${store.roots.intents}/${id}.json`,
      `${JSON.stringify({ schema: "hasna.trash.capture-intent.v1", entry, payloadPath: store.payloadPath(id) }, null, 2)}\n`,
    );

    const report = store.recover();

    expect(report.unresolvable).toHaveLength(1);
    expect(report.abortedIntents).toHaveLength(0);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("someone else's file");
    expect(store.info(id)).toBeNull();
  });

  test("recovery also leaves a replaced path alone when the inode check is what saves it", () => {
    // Same shape, but reached the way it happens in practice: the original was
    // unlinked and a new file created at the same name. If the inode is reused
    // the identity check matches and the intent aborts (the source is intact
    // either way) — what must never happen is an unconditional unlink.
    const spool = sandbox.path("spool");
    const store = makeTestStore(sandbox, { spool });
    store.init();

    const path = sandbox.file("work/raced.txt", "inode A");
    const before = statSync(path);
    const id = "22222222-2222-4222-8222-222222222222";
    const entry = createEntry({
      id,
      originalPath: path,
      givenPath: path,
      capturedAt: new Date().toISOString(),
      kind: "file",
      sizeBytes: 7,
      sha256: "0".repeat(64),
      device: before.dev,
      inode: before.ino,
      nlink: 1,
      mode: 0o644,
      retentionDays: 30,
      expiresAt: null,
    });
    writeFileSync(
      `${store.roots.intents}/${id}.json`,
      `${JSON.stringify({ schema: "hasna.trash.capture-intent.v1", entry, payloadPath: store.payloadPath(id) }, null, 2)}\n`,
    );

    unlinkSync(path);
    writeFileSync(path, "inode B — a different file");
    const after = statSync(path);

    const report = store.recover();

    if (after.ino === before.ino) {
      // The filesystem recycled the inode: the identity matches, so the intent
      // is treated as "never moved" and aborted — and the new file survives.
      expect(report.abortedIntents).toHaveLength(1);
    } else {
      expect(report.unresolvable).toHaveLength(1);
    }
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("inode B — a different file");
  });
});

describe("put — identity collisions are detected, never clobbered", () => {
  test("publishing an entry id that already exists leaves the payload and the metadata alone", () => {
    const store = makeTestStore(sandbox);
    const first = sandbox.file("a.txt", "first");
    const id = store.put(first)[0]!.entryId!;
    const payloadBefore = readFileSync(store.payloadPath(id));
    const metadataBefore = readFileSync(store.infoPath(id), "utf8");

    // Drive the publish primitive directly: this is the branch a re-used id (or
    // a duplicated recovery) hits.
    const second = sandbox.file("b.txt", "second");
    const inspection = inspectSource(second, { cwd: sandbox.root, home: sandbox.path("home"), maxBytes: 1024 });
    const entry = createEntry({
      id,
      originalPath: second,
      givenPath: "b.txt",
      capturedAt: new Date().toISOString(),
      kind: "file",
      sizeBytes: inspection.source!.sizeBytes,
      sha256: inspection.source!.sha256,
      device: inspection.source!.device,
      inode: inspection.source!.inode,
      nlink: 1,
      mode: 0o644,
      retentionDays: 30,
      expiresAt: null,
    });

    const internal = store as unknown as { publishCapture: (e: typeof entry, p: string, kind: "file") => void };
    expect(() => internal.publishCapture(entry, second, "file")).toThrow(/already exists/);

    expect(readFileSync(store.payloadPath(id))).toEqual(payloadBefore);
    expect(readFileSync(store.infoPath(id), "utf8")).toBe(metadataBefore);
    expect(readFileSync(second, "utf8")).toBe("second");
  });
});

describe("put — concurrency", () => {
  test("many captures in one store all land, with unique ids", () => {
    const store = makeTestStore(sandbox);
    const files = Array.from({ length: 12 }, (_, i) => sandbox.file(`burst/f${i}.txt`, `content ${i}`));

    const outcomes = files.map((file) => store.put(file)[0]!);

    expect(outcomes.every((outcome) => outcome.status === "captured")).toBe(true);
    expect(new Set(outcomes.map((outcome) => outcome.entryId)).size).toBe(12);
    expect(store.list()).toHaveLength(12);
    expect(files.every((file) => !existsSync(file))).toBe(true);
    expect(readdirCount(store.roots.intents)).toBe(0);
  });

  test("concurrent PROCESSES capturing the same path: exactly one wins, the loser destroys nothing", async () => {
    const spool = sandbox.path("spool");
    const store = makeTestStore(sandbox, { spool });
    store.init();
    const cli = new URL("../cli/index.ts", import.meta.url).pathname;
    const target = sandbox.file("race.txt", "only one may have it");
    const env = spawnEnv(sandbox);

    const spawnCli = (): ReturnType<typeof Bun.spawn> =>
      Bun.spawn({
        cmd: ["bun", cli, "--spool", spool, "--json", "put", target],
        env,
        stdout: "pipe",
        stderr: "pipe",
      });

    const [a, b] = [spawnCli(), spawnCli()];
    const [codeA, codeB] = await Promise.all([a.exited, b.exited]);
    const [outA, outB] = await Promise.all([new Response(a.stdout).text(), new Response(b.stdout).text()]);

    expect(codeA).toBe(0);
    expect(codeB).toBe(0);
    const statuses = [outA, outB].map((text) => (JSON.parse(text) as { status: string }[])[0]!.status);
    expect(statuses.filter((status) => status === "captured")).toHaveLength(1);
    expect(statuses.filter((status) => status === "missing")).toHaveLength(1);

    expect(existsSync(target)).toBe(false);
    const entries = store.list();
    expect(entries).toHaveLength(1);
    expect(readFileSync(store.payloadPath(entries[0]!.id), "utf8")).toBe("only one may have it");
    expect(readdirCount(store.roots.intents)).toBe(0);
  });

  test("concurrent processes capturing DIFFERENT paths all land", async () => {
    const spool = sandbox.path("spool");
    const store = makeTestStore(sandbox, { spool });
    store.init();
    const cli = new URL("../cli/index.ts", import.meta.url).pathname;
    const files = Array.from({ length: 6 }, (_, i) => sandbox.file(`multi/f${i}.txt`, `multi ${i}`));
    const env = spawnEnv(sandbox);

    const procs = files.map((file) =>
      Bun.spawn({ cmd: ["bun", cli, "--spool", spool, "--json", "put", file], env, stdout: "pipe", stderr: "pipe" }),
    );
    const codes = await Promise.all(procs.map((proc) => proc.exited));

    expect(codes).toEqual([0, 0, 0, 0, 0, 0]);
    expect(store.list()).toHaveLength(6);
    expect(readdirSync(store.roots.files).filter((name) => !name.startsWith(".tmp-"))).toHaveLength(6);
  });

  test(
    "parallel load on a COLD store: every process recovers while its siblings are mid-capture, and every put lands",
    async () => {
      // The reproduction of the CI flake (hasna/apps publish-guard, 2026-09-11):
      // eight processes start on a spool that does not exist yet, so each one
      // runs `init()` → `recover()` while the others are between their intent
      // and their metadata publish. Before recovery was owner-scoped a sibling
      // completed the owner's intent and the owner's own publish collided —
      // `refused`, exit 2 — in 19 of 36 runs under 3x load. Three rounds, each
      // on a fresh spool, so the cold-start window is hit every time.
      const cli = new URL("../cli/index.ts", import.meta.url).pathname;
      const env = spawnEnv(sandbox);
      for (let round = 0; round < 3; round += 1) {
        const spool = sandbox.path(`spool-load-${round}`);
        const files = Array.from({ length: 8 }, (_, i) => sandbox.file(`load/r${round}/f${i}.txt`, `round ${round} file ${i}`));

        const procs = files.map((file) =>
          Bun.spawn({ cmd: ["bun", cli, "--spool", spool, "--json", "put", file], env, stdout: "pipe", stderr: "pipe" }),
        );
        const codes = await Promise.all(procs.map((proc) => proc.exited));
        const outs = await Promise.all(procs.map((proc) => new Response(proc.stdout).text()));
        const errs = await Promise.all(procs.map((proc) => new Response(proc.stderr).text()));

        const failures = codes.map((code, i) => (code === 0 ? null : `proc ${i}: exit ${code}\n${outs[i]}\n${errs[i]}`)).filter(Boolean);
        expect(failures).toEqual([]);
        const statuses = outs.map((text) => (JSON.parse(text) as { status: string }[])[0]!.status);
        expect(statuses).toEqual(Array.from({ length: 8 }, () => "captured"));

        const store = makeTestStore(sandbox, { spool });
        expect(store.list()).toHaveLength(8);
        expect(readdirCount(store.roots.intents)).toBe(0);
        expect(readdirSync(store.roots.info).filter((name) => name.startsWith(".tmp-"))).toEqual([]);
        expect(files.every((file) => !existsSync(file))).toBe(true);
      }
    },
    60_000,
  );
});

describe("recovery is owner-scoped", () => {
  const cli = new URL("../cli/index.ts", import.meta.url).pathname;

  /**
   * Stage a capture exactly as it looks between "payload linked" and
   * "metadata published" — the window a concurrent recovery used to close on
   * the owner's behalf — and attribute the intent to `owner`.
   */
  function stageMidCapture(store: TrashStore, label: string, owner: { pid: number; host: string } | null) {
    const original = sandbox.file(`work/${label}.txt`, `mid-capture ${label}`);
    const at = statSync(original);
    const id = `33333333-3333-4333-8333-${label.padEnd(12, "0").slice(0, 12).replace(/[^0-9a-f]/g, "0")}`;
    const entry = createEntry({
      id,
      originalPath: original,
      givenPath: original,
      capturedAt: new Date().toISOString(),
      kind: "file",
      sizeBytes: at.size,
      sha256: "0".repeat(64),
      device: at.dev,
      inode: at.ino,
      nlink: 1,
      mode: at.mode,
      retentionDays: 30,
      expiresAt: null,
    });
    const payloadPath = store.payloadPath(id);
    linkSync(original, payloadPath);
    const intent = {
      schema: "hasna.trash.capture-intent.v1",
      entry,
      payloadPath,
      ...(owner ? { owner: { ...owner, startedAt: new Date().toISOString() } } : {}),
    };
    const intentPath = store.intentPath(id);
    writeFileSync(intentPath, `${JSON.stringify(intent, null, 2)}\n`);
    return { id, original, payloadPath, intentPath };
  }

  test("an intent owned by a LIVE sibling process is left alone; once that process is gone it is recovered", async () => {
    const store = makeTestStore(sandbox);
    store.init();
    const sibling = Bun.spawn({ cmd: ["sleep", "60"], stdout: "ignore", stderr: "ignore" });
    try {
      const staged = stageMidCapture(store, "alive", { pid: sibling.pid, host: hostname() });

      const during = store.recover();

      expect(during.inFlight).toEqual([staged.id]);
      expect(during.completedPublishes).toEqual([]);
      expect(during.abortedIntents).toEqual([]);
      expect(during.unresolvable).toEqual([]);
      expect(store.info(staged.id)).toBeNull();
      expect(existsSync(staged.intentPath)).toBe(true);
      expect(existsSync(staged.original)).toBe(true);
      expect(existsSync(staged.payloadPath)).toBe(true);

      sibling.kill();
      await sibling.exited;

      const after = store.recover();

      expect(after.inFlight).toEqual([]);
      expect(after.completedPublishes).toEqual([staged.id]);
      expect(store.info(staged.id)?.originalPath).toBe(staged.original);
      expect(existsSync(staged.intentPath)).toBe(false);
      expect(existsSync(staged.original)).toBe(false);
      expect(readFileSync(staged.payloadPath, "utf8")).toBe("mid-capture alive");
    } finally {
      sibling.kill();
    }
  });

  test("an intent owned by THIS pid is recovered: the capture path is synchronous, so it can only be an aborted one", () => {
    const store = makeTestStore(sandbox);
    store.init();
    const staged = stageMidCapture(store, "selfpid", { pid: process.pid, host: hostname() });

    const report = store.recover();

    expect(report.inFlight).toEqual([]);
    expect(report.completedPublishes).toEqual([staged.id]);
    expect(store.info(staged.id)).not.toBeNull();
  });

  test("an intent without an owner, or from another host, cannot be checked and is recovered as before", async () => {
    const store = makeTestStore(sandbox);
    store.init();
    const sibling = Bun.spawn({ cmd: ["sleep", "60"], stdout: "ignore", stderr: "ignore" });
    try {
      const legacy = stageMidCapture(store, "legacy", null);
      const foreign = stageMidCapture(store, "foreign", { pid: sibling.pid, host: `${hostname()}-not-this-host` });

      const report = store.recover();

      expect(report.inFlight).toEqual([]);
      expect(report.completedPublishes.sort()).toEqual([legacy.id, foreign.id].sort());
    } finally {
      sibling.kill();
      await sibling.exited;
    }
  });

  test("the owner tolerates a recoverer that completed its intent: the capture is reported captured, not refused", () => {
    // A recoverer that cannot see the owner is alive (an older writer with no
    // owner on the intent, or a sibling on another host) publishes the owner's
    // metadata from the owner's payload. Simulated in-process: the sibling's
    // `init()` runs at the after_payload seam, and the same-pid rule makes it
    // treat the intent as aborted. The owner's publish then finds identical
    // metadata already there — that is completion, not a collision.
    const spool = sandbox.path("spool");
    const file = sandbox.file("work/completed-by-sibling.txt", "finished by someone else");
    const sibling: { report: ReturnType<TrashStore["init"]> | null } = { report: null };
    const owner = makeTestStore(sandbox, {
      spool,
      crashAt: (point) => {
        if (point === "after_payload") sibling.report = makeTestStore(sandbox, { spool }).init();
      },
    });

    const [outcome] = owner.put(file);

    expect(sibling.report?.completedPublishes).toHaveLength(1);
    expect(outcome!.status).toBe("captured");
    expect(outcome!.entryId).not.toBeNull();
    expect(outcome!.refusals).toEqual([]);
    expect(existsSync(file)).toBe(false);
    const entries = owner.list();
    expect(entries).toHaveLength(1);
    expect(readFileSync(owner.payloadPath(entries[0]!.id), "utf8")).toBe("finished by someone else");
    expect(readdirCount(owner.roots.intents)).toBe(0);
    expect(readdirSync(owner.roots.info).filter((name) => name.startsWith(".tmp-"))).toEqual([]);
  });

  test("a genuine identity collision at the metadata path is still refused", () => {
    // Different content at the metadata path is somebody else's entry: the
    // tolerance above must never turn that into a false "captured".
    const spool = sandbox.path("spool");
    const file = sandbox.file("work/collide.txt", "mine");
    const owner = makeTestStore(sandbox, {
      spool,
      crashAt: (point) => {
        if (point !== "after_payload") return;
        const intents = readdirSync(owner.roots.intents).filter((name) => name.endsWith(".json"));
        const id = intents[0]!.replace(/\.json$/, "");
        writeFileSync(owner.infoPath(id), `${JSON.stringify({ schema: "hasna.trash.entry.v1", id, forged: true }, null, 2)}\n`);
      },
    });

    const [outcome] = owner.put(file);

    expect(outcome!.status).toBe("refused");
    expect(outcome!.detail).toContain("entry id collision");
  });

  test("the CLI records its pid and host on the intent it writes", () => {
    const spool = sandbox.path("spool");
    const file = sandbox.file("work/owned.txt", "owned");
    const store = makeTestStore(sandbox, { spool, crashAt: crashingAt("after_intent") });

    expect(() => store.put(file)).toThrow(CrashSentinel);

    const [name] = readdirSync(store.roots.intents).filter((n) => n.endsWith(".json"));
    const intent = JSON.parse(readFileSync(`${store.roots.intents}/${name}`, "utf8")) as { owner?: { pid: number; host: string; startedAt: string } };
    expect(intent.owner?.pid).toBe(process.pid);
    expect(intent.owner?.host).toBe(hostname());
    expect(typeof intent.owner?.startedAt).toBe("string");
    void cli;
  });
});
