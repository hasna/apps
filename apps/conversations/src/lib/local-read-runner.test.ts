/**
 * Regressions for the two defects that blocked PR #154 (todos 0ae63bc7).
 *
 * 1. PACKAGING. `local-read-runner.ts` starts a separate worker file, but the
 *    canonical build never emitted it and `npm pack` never shipped it, so every
 *    worker-backed read in an installed copy died on "local collection worker is
 *    missing from this installation". The source tree hid it: the runner's first
 *    candidate is the `.ts` beside it, which only exists in a checkout.
 *
 * 2. LIFECYCLE. The runner started a NEW Worker per read, paying a full module
 *    graph load — bun:sqlite, the db open with its schema and migration pass —
 *    on every call. Roughly 110ms per read against ~13-36ms pooled: small on
 *    its own, but the suite pays it thousands of times and every CLI end-to-end
 *    test pays it again inside each subprocess, which is the accumulation that
 *    pushed the full gate past 900s.
 *
 * Both are asserted two-sided: the packaging tests also prove the packed worker
 * is load-bearing by removing it and watching the same command fail, and the
 * pooling tests assert reuse AND that a timed-out worker is never reused.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sendMessage } from "./messages.js";
import { closeDb, getDb } from "./db.js";
import {
  disposeLocalReadWorkersForTests,
  idleLocalReadWorkerIdsForTests,
  LocalCollectionTimeoutError,
  runLocalCancellationProbeForTests,
  runLocalReadWorker,
  runLocalReadWorkerWithIdentityForTests,
} from "./local-read-runner.js";
import { createDisposableStore, enterHermeticTestEnv } from "../test/hermetic.js";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** The build output path the runner resolves from a packed `bin/*.js` bundle. */
const BUILT_WORKER = join(REPO_ROOT, "bin", "local-read-worker.js");
const PACKED_WORKER = join("package", "bin", "local-read-worker.js");

const MISSING_WORKER_MESSAGE = "local collection worker is missing from this installation";

// ---------------------------------------------------------------------------
// Packaging
// ---------------------------------------------------------------------------

type PackedInstall = { root: string; packageDir: string };

let packed: PackedInstall | null = null;
const tempRoots: string[] = [];

function run(command: string, args: string[], cwd: string) {
  return spawnSync(command, args, { cwd, encoding: "utf8", timeout: 300_000 });
}

/**
 * Build and pack exactly the way a release does, then unpack the tarball on its
 * own so nothing can resolve back into this checkout. Memoised: the build is
 * ~25s and every packaging test wants the same artifact.
 */
function preparePackedInstall(): PackedInstall {
  if (packed) return packed;

  const build = run("bun", ["run", "build"], REPO_ROOT);
  expect(build.status, `bun run build failed: ${build.stderr}`).toBe(0);

  const root = mkdtempSync(join(tmpdir(), "0ae63bc7-packed-"));
  tempRoots.push(root);

  const pack = run("npm", ["pack", REPO_ROOT, "--pack-destination", root], root);
  expect(pack.status, `npm pack failed: ${pack.stderr}`).toBe(0);

  const tarball = pack.stdout.trim().split("\n").pop()!;
  const extract = run("tar", ["xzf", tarball], root);
  expect(extract.status, `tar failed: ${extract.stderr}`).toBe(0);

  // A published install resolves dependencies from node_modules; the tarball
  // carries none, and the CLI bundle keeps ink/react/chalk external.
  const link = run("ln", ["-sfn", join(REPO_ROOT, "node_modules"), join(root, "package", "node_modules")], root);
  expect(link.status).toBe(0);

  packed = { root, packageDir: join(root, "package") };
  return packed;
}

/** Run the packed CLI with nothing ambient: no real HOME, no inherited config. */
function runPackedCli(install: PackedInstall, args: string[]) {
  const home = join(install.root, "home");
  mkdirSync(home, { recursive: true });
  return spawnSync("bun", [join(install.packageDir, "bin", "index.js"), ...args], {
    cwd: install.root,
    encoding: "utf8",
    timeout: 120_000,
    env: {
      PATH: process.env.PATH,
      HOME: home,
      CONVERSATIONS_DB_PATH: join(install.root, "packed.db"),
      CONVERSATIONS_AGENT_ID: "packaged-reader",
    },
  });
}

afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

describe("packaged local-read worker (regression 0ae63bc7)", () => {
  test("the canonical build emits the worker where the runner resolves it", () => {
    preparePackedInstall();
    // `bin/local-read-worker.js` is the one path that satisfies every bundle
    // that embeds the runner: bin/*.js find it as ./local-read-worker.js, and
    // dist/index.js finds the same file as ../bin/local-read-worker.js.
    expect(existsSync(BUILT_WORKER)).toBe(true);
  }, 300_000);

  test("npm pack ships the worker", () => {
    preparePackedInstall();
    const packed = run("npm", ["pack", "--dry-run", "--json"], REPO_ROOT);
    expect(packed.status, `npm pack --dry-run failed: ${packed.stderr}`).toBe(0);
    const files: string[] = JSON.parse(packed.stdout)[0].files.map((file: { path: string }) => file.path);
    expect(files).toContain("bin/local-read-worker.js");
  }, 300_000);

  test("a worker-backed read succeeds from the packed install with no source tree to fall back to", () => {
    const install = preparePackedInstall();

    // The runner prefers `./local-read-worker.ts` when a checkout is present.
    // A published install has no src/, so success here can only come from the
    // built worker.
    expect(existsSync(join(install.packageDir, "src"))).toBe(false);

    const read = runPackedCli(install, ["read", "--limit", "1"]);
    expect(read.stderr).not.toContain(MISSING_WORKER_MESSAGE);
    expect(read.status, `packed read failed: ${read.stderr}`).toBe(0);
  }, 300_000);

  test("removing the packed worker breaks that same read, proving it is worker-backed", () => {
    const install = preparePackedInstall();
    const worker = join(install.root, PACKED_WORKER);
    const parked = `${worker}.parked`;

    renameSync(worker, parked);
    try {
      const read = runPackedCli(install, ["read", "--limit", "1"]);
      expect(read.status).not.toBe(0);
      expect(read.stderr).toContain(MISSING_WORKER_MESSAGE);
    } finally {
      renameSync(parked, worker);
    }
  }, 300_000);
});

// ---------------------------------------------------------------------------
// Runner lifecycle
// ---------------------------------------------------------------------------

describe("local read worker lifecycle (regression 0ae63bc7)", () => {
  let disposable: ReturnType<typeof createDisposableStore>;
  let restoreEnv: () => void;

  beforeEach(() => {
    disposable = createDisposableStore("local-read-runner");
    restoreEnv = enterHermeticTestEnv({
      CONVERSATIONS_DB_PATH: disposable.dbPath,
      CONVERSATIONS_EXPORT_DIR: `${disposable.dbPath}.exports`,
    });
    closeDb();
    getDb();
  });

  afterEach(() => {
    disposeLocalReadWorkersForTests();
    closeDb();
    restoreEnv();
    disposable.cleanup();
  });

  test("sequential reads reuse pooled workers instead of starting one per read", async () => {
    sendMessage({ from: "writer", to: "pool-reader", content: "hello" });

    const READS = 10;
    const workerIds = new Set<number>();
    const startedAt = performance.now();

    for (let i = 0; i < READS; i++) {
      const dispatched = runLocalReadWorkerWithIdentityForTests<{ messages: unknown[] }>(
        "readMessagePreviews",
        [{ agent: "pool-reader", limit: 5 }],
        undefined,
      );
      workerIds.add(dispatched.workerId);
      const page = await dispatched.result;
      expect(Array.isArray(page.messages)).toBe(true);
    }

    // The defect: one Worker identity per read. Measure only these ten
    // dispatches; background readers share the process and may evict one warm
    // worker under the documented four-slot cap. Staying within that cap still
    // separates pooling from the old ten-for-ten behavior.
    expect(workerIds.size).toBeLessThanOrEqual(4);
    expect(workerIds.size).toBeLessThan(READS);

    // A guard against a gross regression, NOT the discriminator: identity
    // above is what fails on the defect. Measured on an idle box, these ten
    // reads took 1065-1236ms with a Worker per read and 131-362ms pooled — a
    // real cost at suite scale, but far too small a gap to assert on directly
    // without flaking under CI load.
    expect(performance.now() - startedAt).toBeLessThan(20_000);
  }, 120_000);

  test("a timed-out worker is terminated and replaced, never handed to a later read", async () => {
    sendMessage({ from: "writer", to: "pool-reader", content: "hello" });

    // Warm the pool so the probe below takes a pooled worker rather than a new
    // one; that is the case where reuse could leak a killed worker.
    await runLocalReadWorker("readMessagePreviews", [{ agent: "pool-reader", limit: 5 }], undefined);
    const idleAfterWarm = idleLocalReadWorkerIdsForTests();
    expect(idleAfterWarm.length).toBeGreaterThan(0);
    // acquireWorker pops, so the probe below takes this one.
    const doomed = idleAfterWarm[idleAfterWarm.length - 1];

    let caught: unknown;
    try {
      await runLocalCancellationProbeForTests(500);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LocalCollectionTimeoutError);
    expect((caught as LocalCollectionTimeoutError).queryStarted).toBe(true);

    // Hard cancellation still means the worker dies. It must NOT return to the
    // pool, or its late reply would arrive while another request holds it.
    expect(idleLocalReadWorkerIdsForTests()).not.toContain(doomed);

    // The next read is served by some other worker, and the killed one stays
    // out of circulation rather than reappearing once its termination lands.
    const page = await runLocalReadWorker<{ messages: unknown[] }>(
      "readMessagePreviews",
      [{ agent: "pool-reader", limit: 5 }],
      undefined,
    );
    expect(page.messages).toHaveLength(1);
    expect(idleLocalReadWorkerIdsForTests()).not.toContain(doomed);
  }, 120_000);

  test("a pooled worker never answers a request for a different database", async () => {
    // Pooled workers outlive the environment that made them. Bun Workers keep
    // the database selected when their module graph first opens, so rewriting
    // process.env inside a reused worker is not a reliable database switch.
    // Both stores are populated: the old empty-second-store assertion let a
    // stale read of an empty first store pass while proving nothing about the
    // request's dbPath.
    sendMessage({ from: "writer", to: "pool-reader", content: "first-store" });
    const first = await runLocalReadWorker<{ messages: Array<{ preview: string }> }>(
      "readMessagePreviews",
      [{ agent: "pool-reader", limit: 5 }],
      undefined,
    );
    expect(first.messages).toHaveLength(1);
    const firstWorkerIds = idleLocalReadWorkerIdsForTests();
    expect(firstWorkerIds.length).toBeGreaterThan(0);

    const second = createDisposableStore("local-read-runner-second");
    const restoreSecond = enterHermeticTestEnv({
      CONVERSATIONS_DB_PATH: second.dbPath,
      CONVERSATIONS_EXPORT_DIR: `${second.dbPath}.exports`,
    });
    try {
      closeDb();
      getDb();
      sendMessage({ from: "writer", to: "pool-reader", content: "second-store" });
      const page = await runLocalReadWorker<{ messages: Array<{ preview: string }> }>(
        "readMessagePreviews",
        [{ agent: "pool-reader", limit: 5 }],
        undefined,
      );
      expect(page.messages).toHaveLength(1);
      expect(page.messages[0]?.preview).toBe("second-store");
      expect(idleLocalReadWorkerIdsForTests().some((id) => !firstWorkerIds.includes(id))).toBe(true);
    } finally {
      closeDb();
      restoreSecond();
      second.cleanup();
    }
  }, 120_000);
});
