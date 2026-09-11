/**
 * The retention invariant, asserted where it is decidable: the planner is pure,
 * so every rule §6 states can be pinned without a filesystem.
 *
 *   bytes may be deleted IFF a matching remote copy is confirmed (re-verified
 *   live at deletion), or the instance is local-only and past retentionDays
 *   with an explicit apply — and never below `minUnuploadedKeep`, and never
 *   for a `pinned` entry.
 */

import { describe, expect, test } from "bun:test";
import { planRetention } from "./retention.js";
import { mergeTrashConfig, type TrashConfigPatch } from "./config.js";
import { fixtureId, makeEntryWith } from "../testing/store.js";
import type { RemoteConfirmation } from "./entry.js";

const DAY = 86_400_000;
const now = Date.UTC(2026, 8, 11, 12, 0, 0);
const longAgo = new Date(now - 60 * DAY).toISOString();
const recent = new Date(now - 1 * DAY).toISOString();

function config(patch: TrashConfigPatch = {}) {
  return mergeTrashConfig(patch);
}

function confirmation(overrides: Partial<RemoteConfirmation> = {}): RemoteConfirmation {
  return {
    key: "trash/machine/2026-07-13/entry/sha",
    versionId: "v1",
    sha256: "a".repeat(64),
    sizeBytes: 100,
    confirmedAt: new Date(now - 2 * DAY).toISOString(),
    ...overrides,
  };
}

const fx = fixtureId;

const plan = (entries: Parameters<typeof planRetention>[0]["entries"], patch: TrashConfigPatch = {}, mode: "local" | "hosted" = "hosted", hasVerifier = true) =>
  planRetention({
    entries,
    config: mergeTrashConfig(patch),
    mode,
    now,
    hasVerifier,
  });

function bases(result: ReturnType<typeof planRetention>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const step of result.steps) out[step.entry.id] = `${step.kind}:${step.basis}`;
  return out;
}

describe("planRetention — the clock", () => {
  test("a remote-confirmed entry past retentionDays is selected for deletion, and re-verified live", () => {
    const entry = makeEntryWith(confirmation(), "staged", { id: fx("e1"), capturedAt: longAgo });
    const result = plan([entry]);
    expect(bases(result)[fx("e1")]).toBe("delete_payload:remote_confirmed_expired");
    expect(result.expiredRemoteConfirmed).toBe(1);
    expect(result.steps[0]!.detail).toContain("re-verified live");
  });

  test("a remote-confirmed entry INSIDE retention is not selected", () => {
    const entry = makeEntryWith(confirmation(), "staged", { id: fx("e1"), capturedAt: recent });
    const result = plan([entry]);
    expect(result.steps).toHaveLength(1);
    expect(bases(result)[fx("e1")]).toBe("keep:not_expired");
    expect(result.expiredRemoteConfirmed).toBe(0);
  });

  test("no verifier ⇒ nothing is selected, even past retention with a stored confirmation", () => {
    // A stored "remote-confirmed" boolean is a historical fact. Without a live
    // re-check the local payload may be the only copy left, so it stays.
    const entry = makeEntryWith(confirmation(), "staged", { id: fx("e1"), capturedAt: longAgo });
    const result = plan([entry], {}, "hosted", false);
    expect(bases(result)[fx("e1")]).toBe("skip:no_verifier");
    expect(result.expiredRemoteConfirmed).toBe(0);
  });

  test("the retention clock is capturedAt, never the metadata file's mtime", () => {
    // An entry captured 60 days ago whose metadata was touched a minute ago is
    // still expired. An mtime-keyed reaper would silently extend retention
    // forever (§12).
    const stale = makeEntryWith(confirmation(), "staged", { id: fx("e1"), capturedAt: longAgo });
    const touched = { ...stale, updatedAt: new Date(now).toISOString() };
    expect(bases(plan([touched]))[fx("e1")]).toBe("delete_payload:remote_confirmed_expired");
  });

  test("pinned entries are never selected, in any arm", () => {
    const pinnedRemote = makeEntryWith(confirmation(), "staged", { id: fx("p1"), capturedAt: longAgo, pinned: true });
    const pinnedLocal = makeEntryWith(null, "staged", { id: fx("p2"), capturedAt: longAgo, pinned: true });
    const result = plan([pinnedRemote, pinnedLocal], {}, "local");
    expect(result.steps.filter((s) => s.kind === "delete_payload")).toHaveLength(0);
    expect(bases(result)[fx("p1")]).toBe("keep:pinned");
    expect(result.pinned).toBeGreaterThan(0);
  });

  test("an entry under restore is never selected", () => {
    const entry = makeEntryWith(confirmation(), "restoring", { id: fx("e1"), capturedAt: longAgo });
    const result = plan([entry]);
    expect(result.steps).toHaveLength(0);
  });

  test("a restored entry is not counted against the quota or selected", () => {
    const entry = makeEntryWith(confirmation(), "restored", { id: fx("e1"), capturedAt: longAgo, sizeBytes: 999 });
    const result = plan([entry]);
    expect(result.quota.entries).toBe(0);
    expect(result.quota.totalBytes).toBe(0);
  });
});

describe("planRetention — the local-only arm", () => {
  test("in LOCAL mode an expired, never-uploaded entry may expire — that is the only arm that can", () => {
    const entry = makeEntryWith(null, "staged", { id: fx("e1"), capturedAt: longAgo });
    const result = plan([entry], { retention: { minUnuploadedKeep: 0 } }, "local");
    expect(bases(result)[fx("e1")]).toBe("delete_payload:local_only_expired");
    expect(result.expiredLocalOnly).toBe(1);
  });

  test("in HOSTED mode an expired, never-uploaded entry is NOT expired — it is left for the upload", () => {
    const entry = makeEntryWith(null, "staged", { id: fx("e1"), capturedAt: longAgo });
    const result = plan([entry], {}, "hosted");
    expect(result.steps.filter((s) => s.kind === "delete_payload")).toHaveLength(0);
    expect(result.unuploaded).toBe(1);
  });

  test("minUnuploadedKeep is a hard floor, not a heuristic", () => {
    const entries = [1, 2, 3].map((i) =>
      makeEntryWith(null, "staged", { id: fx(`e${i}`), capturedAt: longAgo, sizeBytes: 10 }),
    );
    const result = plan(entries, { retention: { minUnuploadedKeep: 3 } }, "local");
    expect(result.steps.filter((s) => s.kind === "delete_payload")).toHaveLength(0);
    expect(result.steps.every((s) => s.basis === "unuploaded_floor")).toBe(true);
    expect(result.notes.join(" ")).toContain("minUnuploadedKeep=3");
  });

  test("the floor lets the excess above it expire, and stops there", () => {
    const entries = [1, 2, 3, 4, 5].map((i) =>
      makeEntryWith(null, "staged", { id: fx(`e${i}`), capturedAt: new Date(now - (60 - i) * DAY).toISOString(), sizeBytes: 10 }),
    );
    const result = plan(entries, { retention: { minUnuploadedKeep: 2 } }, "local");
    const deletions = result.steps.filter((s) => s.kind === "delete_payload");
    expect(deletions).toHaveLength(3); // 5 - 2
    // Oldest first: the ones that stay are the newest.
    expect(deletions.map((s) => s.entry.id)).toEqual(["e1", "e2", "e3"].map(fx));
    expect(result.steps.filter((s) => s.basis === "unuploaded_floor").map((s) => s.entry.id)).toEqual(["e4", "e5"].map(fx));
  });
});

describe("planRetention — quota", () => {
  const SMALL = { retention: { maxTotalBytes: 100, maxEntries: 10 } };

  test("over quota with remote-confirmed entries: oldest first, expired ones before unexpired ones", () => {
    const entries = [
      makeEntryWith(confirmation(), "staged", { id: fx("new"), capturedAt: recent, sizeBytes: 60 }),
      makeEntryWith(confirmation(), "staged", { id: fx("old"), capturedAt: longAgo, sizeBytes: 60 }),
    ];
    const result = plan(entries, SMALL);
    const deletions = result.steps.filter((s) => s.kind === "delete_payload");
    // `old` is both expired and older, so it is taken first; with 120 > 100 the
    // plan needs one deletion and one is enough.
    expect(deletions.map((s) => s.entry.id)).toEqual(["old"].map(fx));
    expect(bases(result)[fx("old")]).toBe("delete_payload:remote_confirmed_expired");
    // Not needed for the quota, and inside its window: kept, and the plan says
    // so rather than omitting the entry.
    expect(bases(result)[fx("new")]).toBe("keep:not_expired");
  });

  test("over quota with only UN-UPLOADED entries: they are retried, never deleted, and the plan blocks", () => {
    const entries = [
      makeEntryWith(null, "staged", { id: fx("u1"), capturedAt: longAgo, sizeBytes: 60 }),
      makeEntryWith(null, "staged", { id: fx("u2"), capturedAt: recent, sizeBytes: 60 }),
    ];
    const result = plan(entries, SMALL);
    expect(result.steps.filter((s) => s.kind === "delete_payload")).toHaveLength(0);
    expect(result.steps.filter((s) => s.kind === "retry_upload")).toHaveLength(2);
    expect(result.blocked?.reason).toBe("quota_exceeded");
    expect(result.blocked?.detail).toContain("new captures are refused");
  });

  test("under quota, an expired remote-confirmed entry is still expired (the clock is independent of the quota)", () => {
    const entry = makeEntryWith(confirmation(), "staged", { id: fx("e1"), capturedAt: longAgo, sizeBytes: 10 });
    const result = plan([entry]);
    expect(result.quota.overQuota).toBe(false);
    expect(bases(result)[fx("e1")]).toBe("delete_payload:remote_confirmed_expired");
  });

  test("entry COUNT over quota is enforced the same way as bytes", () => {
    const entries = [1, 2, 3].map((i) => makeEntryWith(confirmation(), "staged", { id: fx(`e${i}`), capturedAt: recent, sizeBytes: 1 }));
    const result = plan(entries, { retention: { maxEntries: 2, maxTotalBytes: 1_000_000 } });
    expect(result.quota.overEntries).toBe(true);
    expect(result.steps.filter((s) => s.kind === "delete_payload")).toHaveLength(1);
  });

  test("one decision per entry — the plan never lists an entry twice", () => {
    const entries = [1, 2, 3].map((i) =>
      makeEntryWith(confirmation(), "staged", { id: fx(`e${i}`), capturedAt: longAgo, sizeBytes: 60 }),
    );
    const result = plan(entries, { retention: { maxTotalBytes: 60, maxEntries: 10 } });
    const ids = result.steps.map((s) => s.entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("planRetention — the plan never deletes what it cannot verify", () => {
  test("every delete_payload step names a remote confirmation or the local-only arm", () => {
    const entries = [
      makeEntryWith(confirmation(), "staged", { id: fx("remote"), capturedAt: longAgo }),
      makeEntryWith(null, "staged", { id: fx("local"), capturedAt: longAgo }),
      makeEntryWith(confirmation(), "staged", { id: fx("pinned"), capturedAt: longAgo, pinned: true }),
    ];
    const result = plan(entries, { retention: { minUnuploadedKeep: 0 } }, "local");
    for (const step of result.steps) {
      if (step.kind !== "delete_payload") continue;
      const eligible = step.entry.remote !== null || step.basis === "local_only_expired";
      expect(eligible).toBe(true);
    }
  });

  test("a config with no verifier and no local arm plans zero deletions", () => {
    const entries = [1, 2, 3].map((i) => makeEntryWith(null, "staged", { id: fx(`e${i}`), capturedAt: longAgo, sizeBytes: 500 }));
    const result = planRetention({
      entries,
      config: config({ retention: { maxTotalBytes: 100 } }),
      mode: "hosted",
      now,
      hasVerifier: false,
    });
    expect(result.steps.filter((s) => s.kind === "delete_payload")).toHaveLength(0);
    expect(result.blocked).not.toBeNull();
  });
});
