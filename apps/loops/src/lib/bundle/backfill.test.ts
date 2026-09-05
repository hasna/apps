/**
 * The revision-1 backfill core: cohort classification, naming, the skip
 * vocabulary, and the write shape of a backfilled revision 1.
 *
 * Runs against the sqlite mirror of the Postgres store through the shared
 * `LoopStorageContract`, with the same in-memory artifact store the API tests
 * use — so every assertion here is about the contract-level behavior the
 * hosted `backfill-revisions` job shares, not about one backend.
 */
import { describe, expect, test } from "bun:test";
import { SqliteLoopStorage } from "../storage/sqlite.js";
import { Store } from "../store.js";
import type { Loop, LoopTarget } from "../../types.js";
import { BundleArtifactStorage, memoryObjectStore } from "./artifact-storage.js";
import {
  REVISION_BACKFILL_COHORT_ORDER,
  attemptRevisionBackfill,
  classifyRevisionBackfillCohort,
  collectRevisionBackfillCandidates,
  runRevisionBackfill,
  type RevisionBackfillContext,
} from "./backfill.js";

const FIXED_NOW = new Date("2026-09-05T04:00:00.000Z");

interface MemoryArtifacts {
  artifacts: BundleArtifactStorage;
  /** Every key in the in-memory object store. */
  keys: () => string[];
  get: (key: string) => Promise<Uint8Array | undefined>;
}

function makeStorage(): { store: Store; storage: SqliteLoopStorage } {
  const store = new Store(":memory:");
  return { store, storage: new SqliteLoopStorage(store) };
}

function makeArtifacts(): MemoryArtifacts {
  // env: {} so an ambient HASNA_LOOPS_ARTIFACTS_BUCKET cannot flip storageKind
  // mid-test; every put lands in the in-memory store.
  const objectStore = memoryObjectStore();
  return {
    artifacts: new BundleArtifactStorage({ store: objectStore, env: {} }),
    keys: () => objectStore.keys(),
    get: (key) => objectStore.get(key),
  };
}

function context(
  storage: SqliteLoopStorage,
  mem: MemoryArtifacts,
  overrides: Partial<RevisionBackfillContext> = {},
): RevisionBackfillContext {
  return {
    storage,
    artifacts: mem.artifacts,
    tenantId: "t_test",
    dryRun: false,
    author: "test-author",
    reason: "backfill-revisions test",
    sourceStation: "station-test",
    sourceAgent: "test-cli",
    now: () => FIXED_NOW,
    ...overrides,
  };
}

async function createLoop(storage: SqliteLoopStorage, name: string, target: LoopTarget): Promise<Loop> {
  return storage.createLoop({
    name,
    schedule: { type: "once", at: "2026-09-06T00:00:00.000Z" },
    target,
  });
}

const command = (command: string): LoopTarget =>
  ({ type: "command", command, shell: /\s/.test(command.trim()) });
const agent = (prompt: string): LoopTarget => ({ type: "agent", provider: "claude", prompt });
const workflow = (workflowId: string): LoopTarget => ({ type: "workflow", workflowId });

describe("classifyRevisionBackfillCohort", () => {
  test("flags every legacy script-dir spelling as scriptBacked", async () => {
    const { store, storage } = makeStorage();
    try {
      for (const needle of [
        "~/.hasna/loops/scripts/backup.sh",
        "~/.hasna/loops/scripts/backup.sh --full",
        "bash $HOME/.hasna/loops/scripts/backup.sh",
        "${HOME}/.hasna/loops/scripts/backup.sh",
        "<home>/.hasna/loops/scripts/backup.sh",
        "/Users/station03/.hasna/loops/scripts/backup.sh",
        "/.hasna/loops/scripts/backup.sh",
      ]) {
        const loop = await createLoop(storage, "scripted", command(needle));
        expect(classifyRevisionBackfillCohort(loop)).toBe("scriptBacked");
      }
    } finally {
      store.close();
    }
  });

  test("sorts the four cohorts in P3 order", async () => {
    expect(REVISION_BACKFILL_COHORT_ORDER).toEqual(["scriptBacked", "command", "agent", "workflow"]);
    const { store, storage } = makeStorage();
    try {
      // Sequential creation so the array order is the creation order, which
      // this test sets to the cohort order it asserts below.
      const loops: Loop[] = [];
      loops.push(await createLoop(storage, "a-script", command("~/.hasna/loops/scripts/x.sh")));
      loops.push(await createLoop(storage, "b-cmd", command("echo ok")));
      loops.push(await createLoop(storage, "c-agent", agent("do the thing")));
      loops.push(await createLoop(storage, "d-flow", workflow("w_flow")));
      expect(loops.map((loop) => classifyRevisionBackfillCohort(loop))).toEqual([
        "scriptBacked",
        "command",
        "agent",
        "workflow",
      ]);
    } finally {
      store.close();
    }
  });
});

describe("attemptRevisionBackfill", () => {
  test("creates revision 1 with the loop's current definition and the derived bundle name", async () => {
    const { store, storage } = makeStorage();
    try {
      const mem = makeArtifacts();
      const loop = await createLoop(storage, "nightly-export", command("echo ok"));
      const attempt = await attemptRevisionBackfill(loop, context(storage, mem));
      expect(attempt.outcome).toBe("created");
      expect(attempt).toMatchObject({
        loopId: loop.id,
        cohort: "command",
        bundleName: "nightly-export",
        version: 1,
        carriesPrompt: false,
      });
      expect(attempt.bundleDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(attempt.archiveSha256).toMatch(/^[0-9a-f]{64}$/);

      const revision = await storage.latestLoopRevision(loop.id);
      expect(revision).toBeDefined();
      expect(revision!.version).toBe(1);
      expect(revision!.bundleName).toBe("nightly-export");
      expect(revision!.author).toBe("test-author");
      expect(revision!.reason).toContain("backfill-revisions");
      expect(revision!.carriesPrompt).toBe(false);
      expect(revision!.storageKind).toBe("db");
      expect(revision!.storageKey).toBe("loops/t_test/nightly-export/1/bundle.tar.zst");
      expect((revision!.loopJson as { name: string }).name).toBe("nightly-export");
      expect((revision!.loopJson as { target: { command: string } }).target.command).toBe("echo ok");
      expect((revision!.manifest as { source: { station: string; agent: string } }).source).toMatchObject({
        station: "station-test",
        agent: "test-cli",
      });

      const row = await storage.getLoop(loop.id);
      expect(row!.bundleName).toBe("nightly-export");

      // Objects: manifest + archive for version 1, and the mutable latest pointer.
      const keys = mem.keys().sort();
      expect(keys).toEqual([
        "loops/t_test/nightly-export/1/bundle.tar.zst",
        "loops/t_test/nightly-export/1/manifest.json",
        "loops/t_test/nightly-export/latest.json",
      ]);
      const latest = JSON.parse(new TextDecoder().decode((await mem.get("loops/t_test/nightly-export/latest.json"))!));
      expect(latest).toEqual({
        version: 1,
        bundleDigest: revision!.bundleDigest,
        archiveSha256: revision!.archiveSha256,
        updatedAt: FIXED_NOW.toISOString(),
      });

      // The archive round-trips to the loop.json the row records.
      const archive = await mem.get("loops/t_test/nightly-export/1/bundle.tar.zst");
      const untarred = new TextDecoder().decode(Bun.zstdDecompressSync(archive!));
      expect(untarred).toContain('"name": "nightly-export"');
      expect(untarred).toContain('"command": "echo ok"');
    } finally {
      store.close();
    }
  });

  test("keeps an agent prompt and marks the revision carriesPrompt", async () => {
    const { store, storage } = makeStorage();
    try {
      const mem = makeArtifacts();
      const loop = await createLoop(storage, "triage", agent("summarise the inbox"));
      const attempt = await attemptRevisionBackfill(loop, context(storage, mem));
      expect(attempt).toMatchObject({ outcome: "created", carriesPrompt: true });
      const revision = await storage.latestLoopRevision(loop.id);
      expect(revision!.carriesPrompt).toBe(true);
      expect((revision!.loopJson as { target: { prompt: string } }).target.prompt).toBe("summarise the inbox");
    } finally {
      store.close();
    }
  });

  test("dry-run classifies, names and digests but writes nothing anywhere", async () => {
    const { store, storage } = makeStorage();
    try {
      const mem = makeArtifacts();
      const loop = await createLoop(storage, "dry-runner", command("echo ok"));
      const attempt = await attemptRevisionBackfill(loop, context(storage, mem, { dryRun: true }));
      expect(attempt.outcome).toBe("wouldCreate");
      expect(attempt.bundleName).toBe("dry-runner");
      expect(attempt.bundleDigest).toMatch(/^sha256:/);
      expect(attempt.version).toBeUndefined();
      expect(await storage.latestLoopRevision(loop.id)).toBeUndefined();
      expect((await storage.getLoop(loop.id))!.bundleName).toBeUndefined();
      expect(mem.keys()).toEqual([]);
    } finally {
      store.close();
    }
  });

  test("rerun after a creation is a no-op skip: no second version, nothing rewritten", async () => {
    const { store, storage } = makeStorage();
    try {
      const mem = makeArtifacts();
      const loop = await createLoop(storage, "one-shot", command("echo ok"));
      const first = await attemptRevisionBackfill(loop, context(storage, mem));
      expect(first.outcome).toBe("created");
      const keysAfterFirst = mem.keys().length;
      const second = await attemptRevisionBackfill(loop, context(storage, mem));
      expect(second.outcome).toBe("skipped");
      expect(second.skipReason).toBe("alreadyBackfilled");
      expect((await storage.latestLoopRevision(loop.id))!.version).toBe(1);
      expect(mem.keys().length).toBe(keysAfterFirst);
    } finally {
      store.close();
    }
  });

  test("a loop that already has a pushed revision is skipped, never appended to", async () => {
    const { store, storage } = makeStorage();
    try {
      const mem = makeArtifacts();
      const loop = await createLoop(storage, "pushed-loop", command("echo ok"));
      await storage.createLoopRevision({
        loopId: loop.id,
        bundleName: "pushed-loop",
        bundleDigest: "sha256:" + "0".repeat(64),
        archiveSha256: "1".repeat(64),
        archiveBytes: 12,
        storageKind: "db",
        storageKey: "loops/t_test/pushed-loop/1/bundle.tar.zst",
        manifest: {},
        loopJson: { schema: "hasna.loop.bundle.v1" },
        carriesPrompt: false,
        author: "someone-else",
      });
      const attempt = await attemptRevisionBackfill(loop, context(storage, mem));
      expect(attempt.outcome).toBe("skipped");
      expect(attempt.skipReason).toBe("alreadyBackfilled");
      const revision = await storage.latestLoopRevision(loop.id);
      expect(revision!.version).toBe(1);
      expect(revision!.author).toBe("someone-else");
      expect(mem.keys()).toEqual([]);
    } finally {
      store.close();
    }
  });

  test("a loop whose name is not bundle-safe is skipped and reported, never renamed", async () => {
    const { store, storage } = makeStorage();
    try {
      const mem = makeArtifacts();
      const loop = await createLoop(storage, "Nightly Export Job", command("echo ok"));
      const attempt = await attemptRevisionBackfill(loop, context(storage, mem));
      expect(attempt.outcome).toBe("skipped");
      expect(attempt.skipReason).toBe("nameUnsafe");
      expect(attempt.detail).toContain("bundle name");
      expect(await storage.latestLoopRevision(loop.id)).toBeUndefined();
      expect(mem.keys()).toEqual([]);
    } finally {
      store.close();
    }
  });

  test("a loop whose derived name another loop already holds is skipped with the holder named", async () => {
    const { store, storage } = makeStorage();
    try {
      const mem = makeArtifacts();
      const holder = await createLoop(storage, "first-claim", command("echo ok"));
      const rival = await createLoop(storage, "first-claim", command("echo ok"));
      expect(await attemptRevisionBackfill(holder, context(storage, mem))).toMatchObject({
        outcome: "created",
        bundleName: "first-claim",
      });
      const attempt = await attemptRevisionBackfill(rival, context(storage, mem));
      expect(attempt.outcome).toBe("skipped");
      expect(attempt.skipReason).toBe("nameTaken");
      expect(attempt.detail).toContain(holder.id);
      expect(await storage.latestLoopRevision(rival.id)).toBeUndefined();
    } finally {
      store.close();
    }
  });

  test("an explicit bundle_name is kept and never re-derived from an unsafe loop name", async () => {
    const { store, storage } = makeStorage();
    try {
      const mem = makeArtifacts();
      const loop = await createLoop(storage, "All Caps Name", command("echo ok"));
      await storage.setLoopBundleName(loop.id, "all-caps-name");
      const attempt = await attemptRevisionBackfill(loop, context(storage, mem));
      expect(attempt.outcome).toBe("created");
      expect(attempt.bundleName).toBe("all-caps-name");
      expect((await storage.latestLoopRevision(loop.id))!.bundleName).toBe("all-caps-name");
    } finally {
      store.close();
    }
  });

  test("an archived loop is skipped", async () => {
    const { store, storage } = makeStorage();
    try {
      const mem = makeArtifacts();
      const loop = await createLoop(storage, "retired", command("echo ok"));
      await storage.archiveLoop(loop.id);
      const attempt = await attemptRevisionBackfill(loop, context(storage, mem));
      expect(attempt.outcome).toBe("skipped");
      expect(attempt.skipReason).toBe("archived");
      expect(await storage.latestLoopRevision(loop.id)).toBeUndefined();
      expect(mem.keys()).toEqual([]);
    } finally {
      store.close();
    }
  });

  test("a definition that looks like credential material is refused, never published", async () => {
    const { store, storage } = makeStorage();
    try {
      const mem = makeArtifacts();
      const loop = await createLoop(storage, "leaky", agent("use api_token = \"hunter2secretvalue123\" to call the endpoint"));
      const attempt = await attemptRevisionBackfill(loop, context(storage, mem));
      expect(attempt.outcome).toBe("skipped");
      expect(attempt.skipReason).toBe("containsSecret");
      expect(attempt.detail).toContain("credential");
      expect(await storage.latestLoopRevision(loop.id)).toBeUndefined();
      expect(mem.keys()).toEqual([]);
    } finally {
      store.close();
    }
  });

  test("an unclassifiable target is a reported skip, not a crash", async () => {
    const { store, storage } = makeStorage();
    try {
      const mem = makeArtifacts();
      const loop = await createLoop(storage, "odd", command("echo ok"));
      // The row is gone (a loop can never hold an unclassifiable target once
      // validated); only the in-memory snapshot remains, mutated.
      await storage.deleteLoop(loop.id);
      const odd = { ...loop, target: { type: "teleport" } } as unknown as Loop;
      const attempt = await attemptRevisionBackfill(odd, context(storage, mem));
      expect(attempt.outcome).toBe("skipped");
      expect(attempt.skipReason).toBe("unclassifiable");
    } finally {
      store.close();
    }
  });
});

describe("collectRevisionBackfillCandidates + runRevisionBackfill", () => {
  test("pages every loop and orders it by cohort, then name; archived loops are not candidates", async () => {
    const { store, storage } = makeStorage();
    try {
      const loops = await Promise.all([
        createLoop(storage, "z-cmd", command("echo ok")),
        createLoop(storage, "a-script", command("~/.hasna/loops/scripts/x.sh")),
        createLoop(storage, "b-script", command("$HOME/.hasna/loops/scripts/x.sh")),
        createLoop(storage, "m-agent", agent("hello")),
        createLoop(storage, "n-flow", workflow("w_flow")),
      ]);
      await storage.archiveLoop(loops[1].id);
      const candidates = await collectRevisionBackfillCandidates(storage);
      expect(candidates.map((loop) => loop.id)).not.toContain(loops[1].id);
      expect(candidates.map((loop) => loop.name)).toEqual(["b-script", "z-cmd", "m-agent", "n-flow"]);
    } finally {
      store.close();
    }
  });

  test("a full run backfills what it can and reports every skip with a reason", async () => {
    const { store, storage } = makeStorage();
    try {
      const mem = makeArtifacts();
      await Promise.all([
        createLoop(storage, "ok-cmd", command("echo ok")),
        createLoop(storage, "Secret Name", command("echo ok")),
        createLoop(storage, "ok-agent", agent("be helpful")),
        createLoop(storage, "ok-cmd", command("echo ok")), // duplicate of the first
      ]);
      const candidates = await collectRevisionBackfillCandidates(storage);
      const result = await runRevisionBackfill(context(storage, mem), candidates);
      expect(result.created).toBe(2);
      expect(result.wouldCreate).toBe(0);
      expect(result.attempts).toHaveLength(4);
      expect(result.skipped).toEqual({ nameUnsafe: 1, nameTaken: 1 });
      // Cohort-then-name order: "Secret Name" sorts before "ok-cmd".
      expect(result.attempts.map((attempt) => attempt.skipReason ?? attempt.outcome)).toEqual([
        "nameUnsafe",
        "created",
        "nameTaken",
        "created",
      ]);
      expect(mem.keys().filter((key) => key.endsWith("bundle.tar.zst"))).toHaveLength(2);
    } finally {
      store.close();
    }
  });

  test("a dry-run full pass writes nothing and counts wouldCreate", async () => {
    const { store, storage } = makeStorage();
    try {
      const mem = makeArtifacts();
      await createLoop(storage, "ok-cmd", command("echo ok"));
      await createLoop(storage, "other", agent("hi"));
      const candidates = await collectRevisionBackfillCandidates(storage);
      const result = await runRevisionBackfill(context(storage, mem, { dryRun: true }), candidates);
      expect(result.created).toBe(0);
      expect(result.wouldCreate).toBe(2);
      expect(mem.keys()).toEqual([]);
      const rows = await storage.listLoops({ limit: 100 });
      expect(rows.every((loop) => loop.bundleName === undefined)).toBe(true);
    } finally {
      store.close();
    }
  });
});
