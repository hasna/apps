import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { closeDb, getDb } from "../db/database.js";
import {
  DEFAULT_PRUNE_OLDER_THAN_DAYS,
  advanceCommentCursor,
  computeEventFingerprint,
  listWatchState,
  markEventEmitted,
  normalizePrKey,
  pruneWatchState,
  readCommentCursor,
  readLastEmittedFingerprint,
  readWatchState,
  readWatchStateByPr,
  upsertWatchState,
  watchStateKey,
  type WatchStateObservation,
} from "./pr-monitor-state.js";

/**
 * pr-monitor state accessor tests.
 *
 * Covers the accessor contract from the pr-monitor design section 2.3: the
 * pr_key identity, read/upsert of pr_monitor_state rows, the comment cursor
 * (monotonic, deduped by construction), the sha256 event fingerprint and its
 * last-emitted bookkeeping, and the terminal-row prune maintenance mode.
 * Uses an in-memory registry migrated to v15 by getDb, exactly like the
 * database tests.
 */

const PR_URL = "https://github.com/Hasna/Apps/pull/123";
const PR_KEY = "https://github.com/hasna/apps/pull/123";

function observe(opts: {
  owner: string;
  repo: string;
  number: number;
  seenAt: string;
  state?: "open" | "closed" | "merged";
  headSha?: string | null;
  updatedAt?: string | null;
}): WatchStateObservation {
  return {
    prKey: watchStateKey(opts.owner, opts.repo, opts.number),
    ghOwner: opts.owner,
    ghRepo: opts.repo,
    number: opts.number,
    lastSeenAt: opts.seenAt,
    observedState: opts.state ?? "open",
    headSha: opts.headSha ?? null,
    updatedAt: opts.updatedAt ?? null,
  };
}

function seedPullRequest(opts: {
  owner: string;
  repo: string;
  number: number;
  state: string;
}): void {
  const db = getDb();
  const path = `/tmp/pr-monitor-fixture/${opts.owner}/${opts.repo}/${opts.number}`;
  db.query("INSERT INTO repos (path, name) VALUES (?, ?)").run(path, `${opts.repo}-fixture`);
  const repoRow = db.query("SELECT id FROM repos WHERE path = ?").get(path) as { id: number };
  db.query(
    `INSERT INTO pull_requests (repo_id, number, title, state, author, created_at, url, gh_owner, gh_repo)
     VALUES (?, ?, ?, ?, 'fixture', '2026-01-01 00:00:00', ?, ?, ?)`,
  ).run(
    repoRow.id,
    opts.number,
    `PR ${opts.number}`,
    opts.state,
    `https://github.com/${opts.owner}/${opts.repo}/pull/${opts.number}`,
    opts.owner,
    opts.repo,
  );
}

describe("pr-monitor state accessors", () => {
  beforeAll(() => {
    process.env["HASNA_REPOS_DB_PATH"] = ":memory:";
    getDb(":memory:");
  });

  afterAll(() => {
    closeDb();
    delete process.env["HASNA_REPOS_DB_PATH"];
  });

  describe("pr_key identity", () => {
    it("builds the lowercased canonical key from an identity", () => {
      expect(watchStateKey("Hasna", "Apps", 123)).toBe("https://github.com/hasna/apps/pull/123");
    });

    it("normalizes a stored PR url to the same key regardless of casing or trailing junk", () => {
      expect(normalizePrKey(PR_URL)).toBe(PR_KEY);
      expect(normalizePrKey("https://github.com/hasna/apps/pull/123/")).toBe(PR_KEY);
      expect(normalizePrKey("HTTPS://GITHUB.COM/HASNA/APPS/PULL/123")).toBe(PR_KEY);
    });

    it("returns null for unparseable urls instead of inventing a key", () => {
      expect(normalizePrKey("not a url")).toBeNull();
      expect(normalizePrKey(null)).toBeNull();
      expect(normalizePrKey("")).toBeNull();
    });
  });

  describe("read/upsert", () => {
    it("reads null for a PR never watched", () => {
      expect(readWatchState(PR_KEY)).toBeNull();
      expect(readWatchStateByPr("hasna", "apps", 123)).toBeNull();
    });

    it("upserts a first sighting with cursor and fingerprint defaults", () => {
      const row = upsertWatchState(observe({ owner: "hasna", repo: "apps", number: 123, seenAt: "2026-08-18 10:00:00", headSha: "abc" }));
      expect(row.pr_key).toBe(PR_KEY);
      expect(row.gh_owner).toBe("hasna");
      expect(row.gh_repo).toBe("apps");
      expect(row.number).toBe(123);
      // first_seen_at is owned by the column default (datetime('now')), never
      // by the caller: the DB clock is the only honest first-sighting clock.
      expect(row.first_seen_at).toBeTruthy();
      expect(row.last_seen_at).toBe("2026-08-18 10:00:00");
      expect(row.last_observed_state).toBe("open");
      expect(row.last_head_sha).toBe("abc");
      expect(row.last_seen_comment_id).toBe(0);
      expect(row.last_seen_comment_at).toBeNull();
      expect(row.last_classification).toBeNull();
      expect(row.last_emitted_fingerprint).toBeNull();
    });

    it("updates an existing row without moving first_seen_at", () => {
      const first = upsertWatchState(observe({ owner: "hasna", repo: "apps", number: 123, seenAt: "2026-08-18 10:00:00", headSha: "abc" }));
      const updated = upsertWatchState(
        observe({ owner: "hasna", repo: "apps", number: 123, seenAt: "2026-08-18 10:05:00", state: "merged", headSha: "def", updatedAt: "2026-08-18 10:04:00" }),
      );
      expect(updated.first_seen_at).toBe(first.first_seen_at);
      expect(updated.last_seen_at).toBe("2026-08-18 10:05:00");
      expect(updated.last_observed_state).toBe("merged");
      expect(updated.last_head_sha).toBe("def");
      expect(updated.last_updated_at).toBe("2026-08-18 10:04:00");
    });

    it("adopts a row stored under a differently-cased pr_key so the identity unique index never trips", () => {
      // Store under the canonical key first, then simulate a row that reached
      // the registry under a differently-cased spelling of the same url.
      const db = getDb();
      db.query(
        `UPDATE pr_monitor_state SET pr_key = ? WHERE pr_key = ?`,
      ).run("https://github.com/HASNA/APPS/pull/123", PR_KEY);
      expect(readWatchState("https://github.com/HASNA/APPS/pull/123")).not.toBeNull();

      const reobserved = upsertWatchState(observe({ owner: "hasna", repo: "apps", number: 123, seenAt: "2026-08-18 11:00:00" }));
      expect(reobserved.pr_key).toBe(PR_KEY);
      expect(readWatchState(PR_KEY)).not.toBeNull();
      expect(readWatchState("https://github.com/HASNA/APPS/pull/123")).toBeNull();
      // The identity row is unique: one row addresses this PR.
      expect(listWatchState({ owner: "hasna", repo: "apps" })).toHaveLength(1);
    });

    it("reads by identity regardless of key casing", () => {
      const byPr = readWatchStateByPr("hasna", "apps", 123);
      expect(byPr).not.toBeNull();
      expect(byPr?.number).toBe(123);
    });

    it("lists watch rows scoped by owner and repo", () => {
      upsertWatchState(observe({ owner: "hasna", repo: "apps", number: 321, seenAt: "2026-08-18 10:00:00" }));
      const all = listWatchState();
      expect(all.length).toBeGreaterThanOrEqual(2);
      expect(listWatchState({ owner: "hasna", repo: "apps" }).map((row) => row.number).sort()).toEqual([123, 321]);
      expect(listWatchState({ owner: "hasna", repo: "other" })).toHaveLength(0);
    });
  });

  describe("comment cursor", () => {
    it("reads a zero cursor before any comment is seen", () => {
      expect(readCommentCursor(PR_KEY)).toEqual({ lastSeenCommentId: 0, lastSeenCommentAt: null });
    });

    it("advances the cursor and the timestamp", () => {
      advanceCommentCursor(PR_KEY, 42, "2026-08-18 10:10:00");
      expect(readCommentCursor(PR_KEY)).toEqual({ lastSeenCommentId: 42, lastSeenCommentAt: "2026-08-18 10:10:00" });
    });

    it("never moves the cursor backwards (monotonic by construction)", () => {
      advanceCommentCursor(PR_KEY, 7, "2026-08-18 09:00:00");
      expect(readCommentCursor(PR_KEY)).toEqual({ lastSeenCommentId: 42, lastSeenCommentAt: "2026-08-18 10:10:00" });
    });

    it("does not overwrite the timestamp when the id does not move", () => {
      advanceCommentCursor(PR_KEY, 42, "2026-08-18 12:00:00");
      expect(readCommentCursor(PR_KEY)).toEqual({ lastSeenCommentId: 42, lastSeenCommentAt: "2026-08-18 10:10:00" });
    });

    it("is a no-op for a row that does not exist", () => {
      const before = listWatchState().length;
      advanceCommentCursor("https://github.com/nobody/nothing/pull/1", 5, "2026-08-18 10:00:00");
      expect(listWatchState().length).toBe(before);
    });
  });

  describe("fingerprint", () => {
    it("is deterministic for identical inputs", () => {
      const a = computeEventFingerprint(PR_KEY, "CI_FAILING", "abc123", "failing: lint");
      const b = computeEventFingerprint(PR_KEY, "CI_FAILING", "abc123", "failing: lint");
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
    });

    it("changes when class, head sha or detail changes", () => {
      const base = computeEventFingerprint(PR_KEY, "CI_FAILING", "abc123", "failing: lint");
      expect(computeEventFingerprint(PR_KEY, "REVIEW_NEEDED", "abc123", "failing: lint")).not.toBe(base);
      expect(computeEventFingerprint(PR_KEY, "CI_FAILING", "abc124", "failing: lint")).not.toBe(base);
      expect(computeEventFingerprint(PR_KEY, "CI_FAILING", "abc123", "failing: build")).not.toBe(base);
    });

    it("changes when the pr key changes", () => {
      const a = computeEventFingerprint(PR_KEY, "NEW", "abc123", "first sighting");
      const b = computeEventFingerprint("https://github.com/hasna/other/pull/123", "NEW", "abc123", "first sighting");
      expect(a).not.toBe(b);
    });

    it("reads null until marked and round-trips the marked fingerprint", () => {
      expect(readLastEmittedFingerprint(PR_KEY)).toBeNull();
      const fp = computeEventFingerprint(PR_KEY, "CI_FAILING", "abc123", "failing: lint");
      markEventEmitted(PR_KEY, fp, "CI_FAILING", "2026-08-18 10:20:00");
      expect(readLastEmittedFingerprint(PR_KEY)).toBe(fp);
      const row = readWatchState(PR_KEY);
      expect(row?.last_classification).toBe("CI_FAILING");
      expect(row?.last_classification_at).toBe("2026-08-18 10:20:00");
    });
  });

  describe("prune", () => {
    it("prunes rows whose PR is terminal and older than the cutoff", () => {
      seedPullRequest({ owner: "hasna", repo: "apps", number: 900, state: "merged" });
      upsertWatchState(observe({ owner: "hasna", repo: "apps", number: 900, seenAt: "2026-06-01 00:00:00" }));
      const result = pruneWatchState({ now: "2026-08-18 00:00:00" });
      expect(result.pruned).toBe(1);
      expect(readWatchStateByPr("hasna", "apps", 900)).toBeNull();
    });

    it("keeps terminal rows seen within the cutoff", () => {
      seedPullRequest({ owner: "hasna", repo: "apps", number: 901, state: "closed" });
      upsertWatchState(observe({ owner: "hasna", repo: "apps", number: 901, seenAt: "2026-08-01 00:00:00" }));
      const before = listWatchState({ owner: "hasna", repo: "apps" }).length;
      const result = pruneWatchState({ now: "2026-08-18 00:00:00" });
      expect(result.pruned).toBe(0);
      expect(listWatchState({ owner: "hasna", repo: "apps" }).length).toBe(before);
      expect(readWatchStateByPr("hasna", "apps", 901)).not.toBeNull();
    });

    it("keeps open PRs regardless of age", () => {
      seedPullRequest({ owner: "hasna", repo: "apps", number: 902, state: "open" });
      upsertWatchState(observe({ owner: "hasna", repo: "apps", number: 902, seenAt: "2026-01-01 00:00:00" }));
      const result = pruneWatchState({ now: "2026-08-18 00:00:00" });
      expect(result.pruned).toBe(0);
      expect(readWatchStateByPr("hasna", "apps", 902)).not.toBeNull();
    });

    it("prunes orphan rows whose PR row no longer exists", () => {
      upsertWatchState(observe({ owner: "hasna", repo: "ghost", number: 1, seenAt: "2026-05-01 00:00:00" }));
      const result = pruneWatchState({ now: "2026-08-18 00:00:00" });
      expect(result.pruned).toBe(1);
      expect(readWatchStateByPr("hasna", "ghost", 1)).toBeNull();
    });

    it("defaults to 30 days", () => {
      expect(DEFAULT_PRUNE_OLDER_THAN_DAYS).toBe(30);
      seedPullRequest({ owner: "hasna", repo: "apps", number: 903, state: "merged" });
      upsertWatchState(observe({ owner: "hasna", repo: "apps", number: 903, seenAt: "2026-06-01 00:00:00" }));
      const result = pruneWatchState({ now: "2026-08-18 00:00:00" });
      expect(result.pruned).toBe(1);
    });

    it("rejects invalid age bounds", () => {
      expect(() => pruneWatchState({ olderThanDays: -1 })).toThrow();
      expect(() => pruneWatchState({ olderThanDays: Number.NaN })).toThrow();
    });
  });
});
