/**
 * Regression tests for the "wedged index" silent-failure class.
 *
 * Observed on station01 2026-07-30: `search find <term> -k content` returned an
 * empty result set with exit 0 for 48 days while `search index status` reported
 * the root as `indexing` — a crash-set sentinel wearing an in-progress label.
 *
 * Two defects combined:
 *   1. indexRoot() commits status='indexing' outside the transaction that later
 *      sets 'ready', so a killed process (SIGKILL/OOM/reboot) leaves the row at
 *      'indexing' forever — the catch block only runs for thrown errors.
 *   2. refreshStaleRoots() skipped every root at status 'indexing', so the
 *      crash-set sentinel permanently disabled the only self-healing path.
 *
 * The queries then failed *silently*: empty results, exit 0, no error field.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Database } from "bun:sqlite";
import { getIndexDbForTesting } from "../../db/index-db.js";
import {
  addRoot,
  getRoot,
  indexRoot,
  hasReadyRoot,
  refreshStaleRoots,
  rootHealth,
  isRootUnhealthy,
  heartbeatRootLock,
  INDEXING_STALL_MS,
} from "./indexer.js";
import { scanRoot } from "./walker.js";
import { findLocal } from "./find.js";
import { getConfigDir } from "../config.js";

let root: string;
let db: Database;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "search-wedged-"));
  db = getIndexDbForTesting();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, content = "x") {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

/**
 * Simulate a process killed mid-index: status stays 'indexing' and the
 * start marker is old (or absent, for rows written by pre-fix versions).
 */
function wedgeRoot(id: string, opts: { startedAt?: string | null } = {}) {
  const startedAt =
    opts.startedAt === undefined
      ? new Date(Date.now() - INDEXING_STALL_MS - 60_000).toISOString()
      : opts.startedAt;
  db.prepare("UPDATE index_roots SET status = 'indexing', indexing_started_at = ? WHERE id = ?").run(
    startedAt,
    id,
  );
}

describe("wedged index: health reporting", () => {
  test("a crashed run reports health 'wedged', not 'indexing'", () => {
    write("a.ts", "const alumia = 1;");
    const r = addRoot(root, {}, db);
    indexRoot(r.id, {}, db);
    wedgeRoot(r.id);

    const wedged = getRoot(r.id, db)!;
    expect(wedged.status).toBe("indexing");
    // The raw status is a sentinel; health is the honest answer.
    expect(rootHealth(wedged)).toBe("wedged");
  });

  test("a root with no start marker at all is wedged (pre-fix rows)", () => {
    write("a.ts", "const x = 1;");
    const r = addRoot(root, {}, db);
    indexRoot(r.id, {}, db);
    wedgeRoot(r.id, { startedAt: null });

    expect(rootHealth(getRoot(r.id, db)!)).toBe("wedged");
  });

  test("a genuinely running index reports health 'indexing'", () => {
    write("a.ts", "const x = 1;");
    const r = addRoot(root, {}, db);
    indexRoot(r.id, {}, db);
    wedgeRoot(r.id, { startedAt: new Date().toISOString() });

    expect(rootHealth(getRoot(r.id, db)!)).toBe("indexing");
  });

  test("a fresh run whose lock holder is dead is wedged immediately", () => {
    // Without this, a process killed seconds after starting looks 'indexing'
    // until the 30-minute stall threshold elapses. A dead pid in the lock is
    // proof the run ended, so detection should not have to wait.
    write("a.ts", "const x = 1;");
    const r = addRoot(root, {}, db);
    indexRoot(r.id, {}, db);
    wedgeRoot(r.id, { startedAt: new Date().toISOString() });

    const lockDir = join(getConfigDir(), "locks");
    mkdirSync(lockDir, { recursive: true });
    const lockFile = join(lockDir, `index-${r.id.replace(/[^a-zA-Z0-9_.-]/g, "_")}.lock`);
    // A pid that cannot be running: kernel pids start at 1.
    writeFileSync(lockFile, JSON.stringify({ pid: 2147483646, createdAt: new Date().toISOString() }));

    try {
      expect(rootHealth(getRoot(r.id, db)!)).toBe("wedged");
    } finally {
      rmSync(lockFile, { force: true });
    }
  });

  test("a fresh run whose lock holder is alive stays 'indexing'", () => {
    write("a.ts", "const x = 1;");
    const r = addRoot(root, {}, db);
    indexRoot(r.id, {}, db);
    wedgeRoot(r.id, { startedAt: new Date().toISOString() });

    const lockDir = join(getConfigDir(), "locks");
    mkdirSync(lockDir, { recursive: true });
    const lockFile = join(lockDir, `index-${r.id.replace(/[^a-zA-Z0-9_.-]/g, "_")}.lock`);
    writeFileSync(lockFile, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));

    try {
      expect(rootHealth(getRoot(r.id, db)!)).toBe("indexing");
    } finally {
      rmSync(lockFile, { force: true });
    }
  });

  /**
   * Run `fn` with the lock directory redirected to a temp dir, holding a lock
   * for `rootId` that names `pid`. Isolated so these cases never write into the
   * operator's real ~/.hasna/search/locks.
   */
  function withLockHolder(rootId: string, pid: number, fn: () => void) {
    const dir = mkdtempSync(join(tmpdir(), "search-lockdir-"));
    const previous = process.env["HASNA_SEARCH_DIR"];
    process.env["HASNA_SEARCH_DIR"] = dir;
    try {
      const lockDir = join(dir, "locks");
      mkdirSync(lockDir, { recursive: true });
      writeFileSync(
        join(lockDir, `index-${rootId.replace(/[^a-zA-Z0-9_.-]/g, "_")}.lock`),
        JSON.stringify({ pid, createdAt: new Date().toISOString() }),
      );
      fn();
    } finally {
      if (previous === undefined) delete process.env["HASNA_SEARCH_DIR"];
      else process.env["HASNA_SEARCH_DIR"] = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("a live lock holder outranks a NULL start marker (mixed-version writers)", () => {
    // The installed 0.0.14 never writes indexing_started_at, but it does take a
    // lock. Treating a null marker as proof of death therefore calls a healthy,
    // actively-running index dead — and the remedy we print (`search index
    // update`) is exactly what triggers it.
    write("a.ts", "const x = 1;");
    const r = addRoot(root, {}, db);
    indexRoot(r.id, {}, db);
    wedgeRoot(r.id, { startedAt: null });

    withLockHolder(r.id, process.pid, () => {
      expect(rootHealth(getRoot(r.id, db)!)).toBe("indexing");
    });
  });

  test("a live lock holder outranks an expired stall threshold", () => {
    // A pass that legitimately outruns INDEXING_STALL_MS is still alive.
    write("a.ts", "const x = 1;");
    const r = addRoot(root, {}, db);
    indexRoot(r.id, {}, db);
    wedgeRoot(r.id);

    withLockHolder(r.id, process.pid, () => {
      expect(rootHealth(getRoot(r.id, db)!)).toBe("indexing");
    });
  });

  /** Hold a lock for `rootId` naming `pid`, with its mtime aged by `ageMs`. */
  function withAgedLock(rootId: string, pid: number, ageMs: number, fn: () => void) {
    const dir = mkdtempSync(join(tmpdir(), "search-lockdir-"));
    const previous = process.env["HASNA_SEARCH_DIR"];
    process.env["HASNA_SEARCH_DIR"] = dir;
    try {
      const lockDir = join(dir, "locks");
      mkdirSync(lockDir, { recursive: true });
      const lockFile = join(lockDir, `index-${rootId.replace(/[^a-zA-Z0-9_.-]/g, "_")}.lock`);
      writeFileSync(lockFile, JSON.stringify({ pid, createdAt: new Date().toISOString() }));
      const when = new Date(Date.now() - ageMs);
      utimesSync(lockFile, when, when);
      fn();
    } finally {
      if (previous === undefined) delete process.env["HASNA_SEARCH_DIR"];
      else process.env["HASNA_SEARCH_DIR"] = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("PID REUSE: a running pid in a STALE lock is not trusted", () => {
    // station01 shape: pid_max 4194304, the live lock names pid 3654782 written
    // 2026-07-08, and the allocator has already wrapped past pid_max since. A
    // running pid therefore proves nothing on its own — an unrelated process
    // can inherit the number. Trusting it unbounded restores this branch's own
    // headline failure (a wedged index reporting healthy, exit 0) with no time
    // limit at all, where the marker-based path capped it at 30 minutes.
    write("a.ts", "const x = 1;");
    const r = addRoot(root, {}, db);
    indexRoot(r.id, {}, db);
    wedgeRoot(r.id, { startedAt: null });

    withAgedLock(r.id, process.pid, 48 * 24 * 60 * 60_000, () => {
      expect(rootHealth(getRoot(r.id, db)!)).toBe("wedged");
      expect(isRootUnhealthy(getRoot(r.id, db)!)).toBe(true);
    });
  });

  test("a running pid in a FRESH lock is still trusted", () => {
    // Positive control for the bound above: a real, heartbeating run must not
    // be misread as wedged.
    write("a.ts", "const x = 1;");
    const r = addRoot(root, {}, db);
    indexRoot(r.id, {}, db);
    wedgeRoot(r.id, { startedAt: null });

    withAgedLock(r.id, process.pid, 0, () => {
      expect(rootHealth(getRoot(r.id, db)!)).toBe("indexing");
    });
  });

  test("a never-indexed root reports 'pending' and a failed one 'error'", () => {
    const r = addRoot(root, {}, db);
    expect(rootHealth(getRoot(r.id, db)!)).toBe("pending");

    db.prepare("UPDATE index_roots SET status = 'error', error = 'boom' WHERE id = ?").run(r.id);
    expect(rootHealth(getRoot(r.id, db)!)).toBe("error");
  });
});

describe("wedged index: recovery", () => {
  test("refreshStaleRoots recovers a root wedged at 'indexing'", () => {
    write("a.ts", "const alumia = 1;");
    const r = addRoot(root, {}, db);
    indexRoot(r.id, {}, db);
    wedgeRoot(r.id);

    expect(hasReadyRoot(db)).toBe(false);

    const stats = refreshStaleRoots(5, db);

    expect(stats.length).toBe(1);
    expect(getRoot(r.id, db)!.status).toBe("ready");
    expect(hasReadyRoot(db)).toBe(true);
  });

  test("a wedged root is recovered even when its last index looks fresh", () => {
    // The 48-day wedge was only visible because lastIndexedAt was ancient. A
    // root wedged right after a successful pass must still recover, otherwise
    // every query fails until the staleness window elapses.
    write("a.ts", "const x = 1;");
    const r = addRoot(root, {}, db);
    indexRoot(r.id, {}, db);
    db.prepare("UPDATE index_roots SET last_indexed_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      r.id,
    );
    wedgeRoot(r.id);

    expect(refreshStaleRoots(60, db).length).toBe(1);
    expect(getRoot(r.id, db)!.status).toBe("ready");
  });

  test("a genuinely running index is NOT stolen by the recovery path", () => {
    write("a.ts", "const x = 1;");
    const r = addRoot(root, {}, db);
    indexRoot(r.id, {}, db);
    db.prepare("UPDATE index_roots SET last_indexed_at = ? WHERE id = ?").run(
      new Date(Date.now() - 60 * 60_000).toISOString(),
      r.id,
    );
    wedgeRoot(r.id, { startedAt: new Date().toISOString() });

    expect(refreshStaleRoots(5, db).length).toBe(0);
    expect(getRoot(r.id, db)!.status).toBe("indexing");
  });

  test("a root held by a LIVE lock is never stolen, even with no start marker", () => {
    // Removing the unconditional `status === 'indexing'` skip means the only
    // thing standing between recovery and a running index is this check. If it
    // regresses, acquireRootLock unlinks the live holder's lock (any pass
    // outlasting INDEX_LOCK_STALE_MS has a "stale" lock, since the mtime is
    // never refreshed) and two indexers run concurrently.
    write("a.ts", "const x = 1;");
    const r = addRoot(root, {}, db);
    indexRoot(r.id, {}, db);
    db.prepare("UPDATE index_roots SET last_indexed_at = ? WHERE id = ?").run(
      new Date(Date.now() - 60 * 60_000).toISOString(),
      r.id,
    );
    wedgeRoot(r.id, { startedAt: null });

    const dir = mkdtempSync(join(tmpdir(), "search-lockdir-"));
    const previous = process.env["HASNA_SEARCH_DIR"];
    process.env["HASNA_SEARCH_DIR"] = dir;
    try {
      const lockDir = join(dir, "locks");
      mkdirSync(lockDir, { recursive: true });
      writeFileSync(
        join(lockDir, `index-${r.id.replace(/[^a-zA-Z0-9_.-]/g, "_")}.lock`),
        JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
      );

      expect(refreshStaleRoots(5, db).length).toBe(0);
      expect(getRoot(r.id, db)!.status).toBe("indexing");
    } finally {
      if (previous === undefined) delete process.env["HASNA_SEARCH_DIR"];
      else process.env["HASNA_SEARCH_DIR"] = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("PID REUSE: the station01 shape is recovered, not skipped forever", () => {
    // Stale lock + reused-but-running pid + null marker. Before the freshness
    // bound this classified 'indexing' and refreshStaleRoots recovered nothing.
    write("a.ts", "const x = 1;");
    const r = addRoot(root, {}, db);
    indexRoot(r.id, {}, db);
    wedgeRoot(r.id, { startedAt: null });

    const dir = mkdtempSync(join(tmpdir(), "search-lockdir-"));
    const previous = process.env["HASNA_SEARCH_DIR"];
    process.env["HASNA_SEARCH_DIR"] = dir;
    try {
      const lockDir = join(dir, "locks");
      mkdirSync(lockDir, { recursive: true });
      const lockFile = join(lockDir, `index-${r.id.replace(/[^a-zA-Z0-9_.-]/g, "_")}.lock`);
      writeFileSync(lockFile, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      const when = new Date(Date.now() - 48 * 24 * 60 * 60_000);
      utimesSync(lockFile, when, when);

      expect(refreshStaleRoots(5, db).length).toBe(1);
      expect(getRoot(r.id, db)!.status).toBe("ready");
    } finally {
      if (previous === undefined) delete process.env["HASNA_SEARCH_DIR"];
      else process.env["HASNA_SEARCH_DIR"] = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("HEARTBEAT: the lock mtime is refreshed while a run is in progress", () => {
    // The freshness bound above is only safe because a real run keeps its lock
    // warm. This is also what closes the pre-existing lock-theft window:
    // acquireRootLock steals any lock older than INDEX_LOCK_STALE_MS, and
    // before this the mtime never moved for the whole duration of a pass.
    const dir = mkdtempSync(join(tmpdir(), "search-lockdir-"));
    const previous = process.env["HASNA_SEARCH_DIR"];
    process.env["HASNA_SEARCH_DIR"] = dir;
    try {
      const lockDir = join(dir, "locks");
      mkdirSync(lockDir, { recursive: true });
      const lockFile = join(lockDir, "index-hb.lock");
      writeFileSync(lockFile, JSON.stringify({ pid: process.pid }));
      const stale = new Date(Date.now() - 60 * 60_000);
      utimesSync(lockFile, stale, stale);
      const before = statSync(lockFile).mtimeMs;

      heartbeatRootLock("hb", true);

      expect(statSync(lockFile).mtimeMs).toBeGreaterThan(before);
      expect(Date.now() - statSync(lockFile).mtimeMs).toBeLessThan(10_000);
    } finally {
      if (previous === undefined) delete process.env["HASNA_SEARCH_DIR"];
      else process.env["HASNA_SEARCH_DIR"] = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("HEARTBEAT: scanRoot reports progress so a long walk keeps the lock warm", () => {
    // The walk is the one phase that cannot heartbeat from the caller's loop.
    write("deep/nested/a.ts", "const x = 1;");
    let ticks = 0;
    scanRoot(root, [], () => {
      ticks++;
    });
    expect(ticks).toBeGreaterThan(0);
  });

  test("a successful index clears the start marker", () => {
    write("a.ts", "const x = 1;");
    const r = addRoot(root, {}, db);
    indexRoot(r.id, {}, db);
    expect(getRoot(r.id, db)!.indexingStartedAt).toBeNull();
  });
});

describe("wedged index: queries must fail loudly, never silently empty", () => {
  test("findLocal reports an error when the only root is wedged", () => {
    write("a.ts", "const alumia = 1;");
    const r = addRoot(root, {}, db);
    indexRoot(r.id, {}, db);
    // Content is genuinely present before the wedge.
    expect(findLocal("alumia", { kind: "content", refresh: false }, db).total).toBeGreaterThan(0);

    wedgeRoot(r.id);

    const response = findLocal("alumia", { kind: "content", refresh: false }, db);
    expect(response.indexed).toBe(false);
    expect(response.total).toBe(0);
    // The whole point: an empty result set must be accompanied by a reason.
    expect(response.error).toBeTruthy();
    expect(response.error).toContain("wedged");
  });

  test("findLocal reports an error when there are no roots at all", () => {
    const response = findLocal("alumia", { kind: "content", refresh: false }, db);
    expect(response.indexed).toBe(false);
    expect(response.error).toBeTruthy();
  });

  test("DOCUMENTED LIMITATION: a wedged sibling root goes unreported when another is ready", () => {
    // The gate is hasReadyRoot() — ANY ready root satisfies it — and the query
    // itself never filters by root health. So a wedged root serves whatever it
    // captured before it died, and anything written since is simply absent,
    // with no error and exit 0. That is the real fleet scenario: the station01
    // root last indexed 48 days ago, so 48 days of files are invisible.
    //
    // This test exists so the limitation is stated in code rather than
    // contradicted by a comment promising it cannot happen. Tracked
    // separately; deliberately NOT fixed here.
    const other = mkdtempSync(join(tmpdir(), "search-wedged-other-"));
    try {
      const healthy = addRoot(root, { name: "healthy" }, db);
      write("unrelated.ts", "const y = 2;");
      indexRoot(healthy.id, {}, db);

      const wedged = addRoot(other, { name: "wedged" }, db);
      indexRoot(wedged.id, {}, db);
      // Written after the wedged root's last successful pass — never indexed.
      writeFileSync(join(other, "added-after.ts"), "const uniqueToWedgedRoot = 1;");
      wedgeRoot(wedged.id);

      const response = findLocal("uniqueToWedgedRoot", { kind: "content", refresh: false }, db);
      expect(response.indexed).toBe(true);
      expect(response.total).toBe(0);
      expect(response.error).toBeUndefined();

      // ...but the degradation MUST still be visible somewhere on this
      // response. Emitting rootHealth only inside the error return meant it was
      // undefined in exactly the partially-degraded case the doc comment
      // pointed at it for — the same failure class the comment exists to
      // prevent, inside the comment written to prevent it.
      expect(response.rootHealth).toBeDefined();
      expect(response.rootHealth?.find((r) => r.name === "wedged")?.health).toBe("wedged");
      expect(response.rootHealth?.find((r) => r.name === "healthy")?.health).toBe("ready");
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  test("a healthy index returns no error", () => {
    write("a.ts", "const alumia = 1;");
    const r = addRoot(root, {}, db);
    indexRoot(r.id, {}, db);

    const response = findLocal("alumia", { kind: "content", refresh: false }, db);
    expect(response.indexed).toBe(true);
    expect(response.error).toBeUndefined();
    expect(response.total).toBeGreaterThan(0);
  });
});
