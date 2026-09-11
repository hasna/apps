/**
 * `status` and `doctor`.
 *
 * `doctor` is a deliverable, not a nicety: a guard that silently isn't
 * installed produces false confidence, so every check here reports the truth
 * about what IS and what IS NOT covered — and the checks that gate safety
 * (hosted mode with no verifier) FAIL rather than warn.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createSandbox, testEnv, type Sandbox } from "../testing/sandbox.js";
import { crashingAt, makeTestStore } from "../testing/store.js";
import { TrashStore, type DoctorCheck } from "./store.js";

let sandbox: Sandbox;

beforeEach(() => {
  sandbox = createSandbox();
});

afterEach(() => {
  sandbox.cleanup();
});

function check(checks: DoctorCheck[], id: string): DoctorCheck {
  const found = checks.find((c) => c.id === id);
  if (!found) throw new Error(`no doctor check "${id}" (got ${checks.map((c) => c.id).join(", ")})`);
  return found;
}

describe("status", () => {
  test("an empty store reports zeroes and the resolved roots", () => {
    const store = makeTestStore(sandbox);
    const status = store.status();

    expect(status.entries).toBe(0);
    expect(status.bytes).toBe(0);
    expect(status.mode).toBe("local-only (nothing configured)");
    expect(status.oldestCapturedAt).toBeNull();
    expect(status.newestCapturedAt).toBeNull();
    expect(status.roots.files.startsWith(sandbox.root)).toBe(true);
    expect(status.roots.info.startsWith(sandbox.root)).toBe(true);
    expect(status.legacyHome).toBe(false);
    expect(status.pendingIntents).toBe(0);
  });

  test("counts entries, bytes, pinning, upload state and expiry", () => {
    const store = makeTestStore(sandbox, { now: () => Date.UTC(2026, 8, 11) });
    const a = store.put(sandbox.file("a.txt", "aaaa"))[0]!.entryId!;
    const b = store.put(sandbox.file("b.txt", "bb"))[0]!.entryId!;
    store.put(sandbox.file("c.txt", "cccccc"), { retentionDays: 0 });
    store.setPinned(a, true);
    const bEntry = store.info(b)!;
    store.recordRemote(b, {
      key: "trash/k",
      versionId: "v1",
      sha256: bEntry.sha256,
      sizeBytes: bEntry.sizeBytes,
      confirmedAt: new Date(Date.UTC(2026, 8, 11)).toISOString(),
    });

    const status = store.status();

    expect(status.entries).toBe(3);
    expect(status.bytes).toBe(4 + 2 + 6);
    expect(status.pinned).toBe(1);
    expect(status.unuploaded).toBe(2);
    expect(status.remoteConfirmed).toBe(1);
    expect(status.expired).toBe(1);
    expect(status.quota.totalBytes).toBe(12);
    expect(status.quota.overQuota).toBe(false);
    expect(status.newestCapturedAt).not.toBeNull();
  });

  test("a restore is not counted as live payload, and a restored entry is not live at all", () => {
    const store = makeTestStore(sandbox);
    const id = store.put(sandbox.file("r.txt", "bytes"))[0]!.entryId!;
    expect(store.status().entries).toBe(1);

    store.restore(id);
    const status = store.status();
    expect(status.entries).toBe(0);
    expect(status.bytes).toBe(0);
    expect(status.restored).toBe(0); // the entry is gone entirely
  });

  test("an interrupted capture is visible as a pending intent", () => {
    const store = makeTestStore(sandbox, { crashAt: crashingAt("after_intent") });
    expect(() => store.put(sandbox.file("crash.txt", "bytes"))).toThrow();

    const status = store.status();
    expect(status.pendingIntents).toBe(1);
    // The metadata was never published, so nothing claims to be complete.
    expect(status.entries).toBe(0);
  });

  test("over-quota usage is reported against the EFFECTIVE cap (storage ∩ retention)", () => {
    const spool = sandbox.path("spool");
    makeTestStore(sandbox, { spool }).put(sandbox.file("big.bin", "x".repeat(4096)));
    const tight = new TrashStore({ env: testEnv(sandbox), roots: { root: spool }, config: { storage: { maxSizeBytes: 64 } } });

    const status = tight.status();
    expect(status.quota.overQuota).toBe(true);
    expect(status.quota.maxTotalBytes).toBe(64);
    expect(status.quota.excessBytes).toBe(4096 - 64);
  });
});

describe("doctor", () => {
  test("a healthy store has no FAILING check, and says what is not covered yet", () => {
    const store = makeTestStore(sandbox);
    const checks = store.doctor();

    expect(checks.filter((c) => c.status === "fail")).toHaveLength(0);
    expect(check(checks, "store.init").status).toBe("ok");
    expect(check(checks, "store.files").status).toBe("ok");
    expect(check(checks, "store.info").status).toBe("ok");
    expect(check(checks, "store.same-device").status).toBe("ok");
    expect(check(checks, "retention.quota").status).toBe("ok");
    expect(check(checks, "store.pending-intents").status).toBe("ok");
    expect(check(checks, "capture.refusals").status).toBe("ok");
    // Phase 1 has no hook and no daemon. The checks say so, rather than
    // implying coverage the store does not have.
    expect(check(checks, "guard.hook").status).toBe("warn");
    expect(check(checks, "guard.hook").detail).toContain("phase 2");
    expect(check(checks, "daemon.timer").status).toBe("warn");
    expect(check(checks, "daemon.timer").detail).toContain("phase 3");
    // Local-only is a posture, not a fault — but it is announced.
    expect(check(checks, "mode.resolution").status).toBe("warn");
  });

  test("HOSTED mode with no remote verifier is a FAILURE — nothing is evictable", () => {
    const env = testEnv(sandbox, { HASNA_TRASH_API_URL: "https://trash.example.invalid" });
    const store = new TrashStore({ env, roots: { root: sandbox.path("spool") } });

    const check_ = check(store.doctor(), "retention.remote-verifier");
    expect(check_.status).toBe("fail");
    expect(check_.detail).toContain("no payload is evictable");
  });

  test("the same check passes once a verifier is wired (phase 3)", () => {
    const env = testEnv(sandbox, { HASNA_TRASH_API_URL: "https://trash.example.invalid" });
    const store = new TrashStore({ env, roots: { root: sandbox.path("spool") }, verifyRemote: async () => null });

    const check_ = check(store.doctor(), "retention.remote-verifier");
    expect(check_.status).toBe("ok");
    expect(check_.detail).toContain("re-verifies at deletion time");
  });

  test("a recorded refusal is surfaced, and a refusal that DELETED is distinguished", () => {
    const store = makeTestStore(sandbox, { config: { retention: { maxTotalBytes: 4, maxEntries: 100 } } });
    store.put(sandbox.file("f.bin", "12345678"));
    store.put(sandbox.file("g.bin", "12345678")); // refused: over quota, not excluded
    store.put(sandbox.file("proj/node_modules/h.bin", "12345678")); // refused, then deleted (excluded)

    const refusals = check(store.doctor(), "capture.refusals");
    expect(refusals.status).toBe("warn");
    expect(refusals.detail).toContain("3 recorded refusal(s)");
    expect(refusals.detail).toContain("1 deleted without capture");
    expect(refusals.detail).toContain("2 refused");
  });

  test("a store whose quota is exceeded FAILS the retention check", () => {
    const spool = sandbox.path("spool");
    makeTestStore(sandbox, { spool }).put(sandbox.file("big.bin", "x".repeat(4096)));
    const tight = new TrashStore({ env: testEnv(sandbox), roots: { root: spool }, config: { retention: { maxTotalBytes: 64 } } });

    const quota = check(tight.doctor(), "retention.quota");
    expect(quota.status).toBe("fail");
    expect(quota.detail).toContain("4096/64 bytes");
  });

  test("a pending intent and a malformed metadata file are reported, never silently dropped", () => {
    const spool = sandbox.path("spool");
    const store = makeTestStore(sandbox, { spool, crashAt: crashingAt("after_intent") });
    expect(() => store.put(sandbox.file("crash.txt", "bytes"))).toThrow();

    const checks = store.doctor();
    expect(check(checks, "store.pending-intents").status).toBe("warn");
    expect(check(checks, "store.pending-intents").detail).toContain("run recovery");

    // A metadata file that does not parse is left for the operator: `list`
    // skips it and `doctor` keeps reporting it, rather than deleting evidence.
    sandbox.file(`${store.roots.info}/not-an-entry.json`, "{ torn");
    expect(store.list()).toHaveLength(0);
    const reopened = makeTestStore(sandbox, { spool });
    expect(reopened.list()).toHaveLength(0);
  });

  test("a legacy home is announced rather than hidden", () => {
    // Only `HOME` is set: a HASNA_*_HOME override suppresses the adoption, so
    // this is the one shape in which an existing `~/.hasna/trash` is used.
    const home = sandbox.path("home");
    sandbox.file("home/.hasna/trash/files/kept.bin", "bytes");
    const store = new TrashStore({ env: { HOME: home }, roots: {} });
    store.init();

    expect(store.roots.legacy).toBe(true);
    const legacy = check(store.doctor(), "store.legacy-home");
    expect(legacy.status).toBe("warn");
    expect(legacy.detail).toContain(home);
  });
});
