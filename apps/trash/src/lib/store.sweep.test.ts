/**
 * The retention sweep, end to end.
 *
 * The planner's rules are pinned in `retention.test.ts`; what is pinned here is
 * that the STORE honours them — that the invariant survives contact with a
 * filesystem, that a deletion re-verifies the remote copy at the moment it
 * runs, and that nothing on this path is reachable from `put`.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { createSandbox, testEnv, type Sandbox } from "../testing/sandbox.js";
import { makeTestStore } from "../testing/store.js";
import { TrashStore } from "./store.js";
import type { RemoteVerification } from "./store.js";

let sandbox: Sandbox;

beforeEach(() => {
  sandbox = createSandbox();
});

afterEach(() => {
  sandbox.cleanup();
});

/** A clock the test advances, so "expired" is a fact and not a 30-day wait. */
function clock() {
  let now = Date.UTC(2026, 8, 11, 12, 0, 0);
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** A verifier that confirms the remote copy — the happy path for an eviction. */
function confirmingVerifier(overrides: Partial<RemoteVerification> = {}) {
  return async (entry: { sha256: string; sizeBytes: number; remote: { key: string } | null }): Promise<RemoteVerification> => ({
    key: entry.remote?.key ?? "trash/x/y/z",
    versionId: "v1",
    sha256: entry.sha256,
    sizeBytes: entry.sizeBytes,
    ...overrides,
  });
}

/** Capture with retentionDays 0, register a remote confirmation, then expire it. */
function stagedRemoteConfirmedExpired(
  store: TrashStore,
  time: { now: () => number; advance: (ms: number) => void },
  name = "old.txt",
): string {
  const id = store.put(sandbox.file(name, "old bytes"), { retentionDays: 0 })[0]!.entryId!;
  const entry = store.info(id)!;
  store.recordRemote(id, {
    key: "trash/x/y/z",
    versionId: "v1",
    sha256: entry.sha256,
    sizeBytes: entry.sizeBytes,
    confirmedAt: new Date(time.now()).toISOString(),
  });
  time.advance(1000);
  return id;
}

describe("sweep — posture", () => {
  test("an un-flagged sweep is a dry run: it plans, and touches nothing", async () => {
    const time = clock();
    const store = makeTestStore(sandbox, { now: time.now, verifyRemote: confirmingVerifier() });
    const id = stagedRemoteConfirmedExpired(store, time);

    const report = await store.sweep();

    expect(report.applied).toBe(false);
    expect(report.deleted).toHaveLength(0);
    expect(report.plan.steps.filter((step) => step.kind === "delete_payload")).toHaveLength(1);
    expect(existsSync(store.payloadPath(id))).toBe(true);
    expect(store.info(id)).not.toBeNull();
  });

  test("--apply with a live re-confirmation deletes the payload and its metadata", async () => {
    const time = clock();
    const store = makeTestStore(sandbox, { now: time.now, verifyRemote: confirmingVerifier() });
    const id = stagedRemoteConfirmedExpired(store, time);
    const entry = store.info(id)!;

    const report = await store.sweep({ apply: true });

    expect(report.applied).toBe(true);
    expect(report.deleted.map((d) => d.id)).toEqual([id]);
    expect(report.deleted[0]!.bytes).toBe(entry.sizeBytes);
    expect(existsSync(store.payloadPath(id))).toBe(false);
    expect(store.info(id)).toBeNull();
    expect(report.verified[0]!.fresh).toBe(true);
  });

  test("an instance that turns BOTH dryRun and requireExplicitApply off applies on its own", async () => {
    // The unattended-daemon posture: only an operator who has deliberately
    // configured away both guards gets a sweep that acts unasked.
    const time = clock();
    const store = makeTestStore(sandbox, {
      now: time.now,
      verifyRemote: confirmingVerifier(),
      config: { retention: { dryRun: false, requireExplicitApply: false } },
    });
    const id = stagedRemoteConfirmedExpired(store, time);

    const report = await store.sweep();

    expect(report.applied).toBe(true);
    expect(report.deleted.map((d) => d.id)).toEqual([id]);
  });

  test("the sweep is never reachable from put — a capture does not expire anything", () => {
    // KDE bug 205854 locked cleanup to the write path and bug 414519 followed:
    // a 444 GB trash that filled the home partition. There is no call to
    // `sweep` (or to the planner) anywhere in the capture path.
    const source = readFileSync(`${import.meta.dir}/store.ts`, "utf8");
    const putBody = source.slice(source.indexOf("private putOne("), source.indexOf("private publishCapture("));
    expect(putBody).not.toContain("sweep");
    expect(putBody).not.toContain("planRetention");
  });
});

describe("sweep — the remote confirmation is re-verified at deletion time", () => {
  test("a remote copy whose digest no longer matches keeps the local payload", async () => {
    const time = clock();
    const store = makeTestStore(sandbox, {
      now: time.now,
      verifyRemote: confirmingVerifier({ sha256: "b".repeat(64) }),
    });
    const id = stagedRemoteConfirmedExpired(store, time);

    const report = await store.sweep({ apply: true });

    expect(report.deleted).toHaveLength(0);
    expect(report.kept.some((k) => k.basis === "verify_mismatch")).toBe(true);
    expect(existsSync(store.payloadPath(id))).toBe(true);
    expect(store.info(id)).not.toBeNull();
    // The record says the verification failed, and why.
    expect(report.verified[0]!.fresh).toBe(false);
    expect(report.verified[0]!.detail).toContain("does not match");
  });

  test("a remote copy that cannot be confirmed keeps the local payload", async () => {
    const time = clock();
    const store = makeTestStore(sandbox, { now: time.now, verifyRemote: async () => null });
    const id = stagedRemoteConfirmedExpired(store, time);

    const report = await store.sweep({ apply: true });

    expect(report.deleted).toHaveLength(0);
    expect(report.kept.some((k) => k.basis === "unverified")).toBe(true);
    expect(existsSync(store.payloadPath(id))).toBe(true);
  });

  test("a verifier that throws keeps the local payload", async () => {
    const time = clock();
    const store = makeTestStore(sandbox, {
      now: time.now,
      verifyRemote: async () => {
        throw new Error("the bucket is unreachable");
      },
    });
    const id = stagedRemoteConfirmedExpired(store, time);

    const report = await store.sweep({ apply: true });

    expect(report.deleted).toHaveLength(0);
    expect(report.kept.some((k) => k.basis === "verify_failed")).toBe(true);
    expect(existsSync(store.payloadPath(id))).toBe(true);
  });

  test("with NO verifier configured, nothing is evicted even with --apply", async () => {
    const time = clock();
    const store = makeTestStore(sandbox, { now: time.now });
    stagedRemoteConfirmedExpired(store, time);

    const report = await store.sweep({ apply: true });

    expect(report.deleted).toHaveLength(0);
    expect(report.plan.steps.some((step) => step.basis === "no_verifier")).toBe(true);
  });

  test("an entry whose remote identity moved under it is kept", async () => {
    const time = clock();
    const store = makeTestStore(sandbox, {
      now: time.now,
      verifyRemote: confirmingVerifier({ versionId: "v2" }),
    });
    const id = stagedRemoteConfirmedExpired(store, time);

    const report = await store.sweep({ apply: true });

    expect(report.deleted).toHaveLength(0);
    expect(report.kept.some((k) => k.basis === "verify_identity_changed")).toBe(true);
    expect(existsSync(store.payloadPath(id))).toBe(true);
  });

  test("the retention clock is capturedAt: touching the metadata does not extend it", async () => {
    const time = clock();
    const store = makeTestStore(sandbox, { now: time.now, verifyRemote: confirmingVerifier() });
    const id = stagedRemoteConfirmedExpired(store, time);
    // An mtime-keyed reaper would read this as "recently touched".
    const future = new Date(time.now() + 10 * 86_400_000);
    utimesSync(store.infoPath(id), future, future);

    const report = await store.sweep({ apply: true });

    expect(report.deleted.map((d) => d.id)).toEqual([id]);
  });
});

describe("sweep — what is never deleted", () => {
  test("a pinned entry survives a sweep that would otherwise expire it", async () => {
    const time = clock();
    const store = makeTestStore(sandbox, { now: time.now, verifyRemote: confirmingVerifier() });
    const id = stagedRemoteConfirmedExpired(store, time, "pinned.txt");
    store.setPinned(id, true);

    const report = await store.sweep({ apply: true });

    expect(report.deleted).toHaveLength(0);
    expect(report.kept.some((k) => k.basis === "pinned")).toBe(true);
    expect(existsSync(store.payloadPath(id))).toBe(true);
  });

  test("an un-uploaded entry in a local-only instance is protected by the floor", async () => {
    const time = clock();
    const store = makeTestStore(sandbox, { now: time.now });
    const id = store.put(sandbox.file("local.txt", "never uploaded"), { retentionDays: 0 })[0]!.entryId!;
    time.advance(1000);

    const report = await store.sweep({ apply: true });

    expect(report.deleted).toHaveLength(0);
    expect(report.plan.steps.find((step) => step.entry.id === id)!.basis).toBe("unuploaded_floor");
    expect(existsSync(store.payloadPath(id))).toBe(true);
    expect(store.info(id)).not.toBeNull();
  });

  test("an un-uploaded entry past retention outside the floor DOES expire in a local-only instance", async () => {
    const time = clock();
    const store = makeTestStore(sandbox, { now: time.now, config: { retention: { minUnuploadedKeep: 0 } } });
    const id = store.put(sandbox.file("local.txt", "expire me"), { retentionDays: 0 })[0]!.entryId!;
    time.advance(1000);

    const report = await store.sweep({ apply: true });

    expect(report.deleted.map((d) => d.id)).toEqual([id]);
    expect(report.deleted[0]!.basis).toBe("local_only_expired");
    expect(existsSync(store.payloadPath(id))).toBe(false);
  });

  test("in a HOSTED instance the same entry is uploaded, never deleted", async () => {
    const time = clock();
    const spool = sandbox.path("spool");
    const env = testEnv(sandbox, { HASNA_TRASH_API_URL: "https://trash.example.invalid" });
    const uploaded: string[] = [];

    // Captured under a roomy quota, then swept by an instance whose quota is
    // tighter than the store — that is what `plan.blocked` describes.
    const captured = makeTestStore(sandbox, { spool, env, now: time.now });
    const id = captured.put(sandbox.file("hosted.txt", "expire me"), { retentionDays: 0 })[0]!.entryId!;
    time.advance(1000);

    const tight = new TrashStore({
      env,
      roots: { root: spool },
      now: time.now,
      config: {
        retention: { minUnuploadedKeep: 0, maxTotalBytes: 1, maxEntries: 100 },
        capture: { minFreeBytes: 1024 },
      },
      upload: async (entry) => {
        uploaded.push(entry.id);
        return {
          key: `trash/x/y/${entry.id}`,
          versionId: "v1",
          sha256: entry.sha256,
          sizeBytes: entry.sizeBytes,
          confirmedAt: new Date(time.now()).toISOString(),
        };
      },
    });

    const report = await tight.sweep({ apply: true });

    expect(report.deleted).toHaveLength(0);
    expect(report.blocked?.reason).toBe("quota_exceeded");
    expect(uploaded).toContain(id);
    expect(report.uploads.some((u) => u.id === id && u.confirmed)).toBe(true);
    expect(existsSync(tight.payloadPath(id))).toBe(true);
    expect(tight.info(id)!.remote).not.toBeNull();
  });

  test("a local-only sweep never touches a remote-confirmed entry without a verifier", async () => {
    // Fail closed in the other direction too: the local arm may expire
    // un-uploaded bytes, but an entry WITH a remote confirmation is not the
    // local arm's business — the verifier is what authorizes that one.
    const time = clock();
    const store = makeTestStore(sandbox, { now: time.now, config: { retention: { minUnuploadedKeep: 0 } } });
    const id = stagedRemoteConfirmedExpired(store, time);

    const report = await store.sweep({ apply: true });

    expect(report.deleted).toHaveLength(0);
    expect(existsSync(store.payloadPath(id))).toBe(true);
  });
});

describe("sweep — the quota gate on new captures", () => {
  test("over quota with only un-uploaded entries, a NEW capture is refused and the path stays", () => {
    const store = makeTestStore(sandbox, { config: { retention: { maxTotalBytes: 8, maxEntries: 100 } } });
    const first = sandbox.file("first.txt", "12345678");
    expect(store.put(first)[0]!.status).toBe("captured");

    const second = sandbox.file("second.txt", "abcdefgh");
    const outcome = store.put(second)[0]!;

    expect(outcome.status).toBe("refused");
    expect(outcome.refusals[0]!.reason).toBe("quota_exceeded");
    expect(existsSync(second)).toBe(true);
    expect(store.refusals().map((r) => r.reason)).toContain("quota_exceeded");
  });

  test("an over-quota refusal inside an excluded tree still deletes (the self-lock case §6 names)", () => {
    const store = makeTestStore(sandbox, { config: { retention: { maxTotalBytes: 8, maxEntries: 100 } } });
    store.put(sandbox.file("first.txt", "12345678"))[0]!;

    const build = sandbox.file("proj/node_modules/cache.bin", "abcdefgh");
    const outcome = store.put(build)[0]!;

    // If the trash could refuse a delete because its OWN disk is full, the
    // machine would deadlock: the one thing that frees space could not run.
    expect(outcome.status).toBe("deleted_without_capture");
    expect(existsSync(build)).toBe(false);
    expect(store.refusals()[0]!.deleted).toBe(true);
  });
});

describe("sweep — the lock", () => {
  test("a stale lock from a dead sweeper does not block a live one forever", async () => {
    const time = clock();
    const store = makeTestStore(sandbox, { now: time.now, verifyRemote: confirmingVerifier() });
    store.init();
    writeFileSync(
      store.roots.lock,
      `${JSON.stringify({ token: "dead", pid: 999999, acquiredAt: "2020-01-01T00:00:00.000Z" })}\n`,
    );
    const old = new Date(Date.now() - 10 * 60_000);
    utimesSync(store.roots.lock, old, old);

    const report = await store.sweep({ apply: true });

    expect(report.applied).toBe(true);
    // The takeover is not silent, and it is not permanent.
    expect(existsSync(store.roots.lock)).toBe(false);
  });
});
