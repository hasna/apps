import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { getDb, closeDb } from "../db/database.js";
import { upsertRepo, listIssues, countIssues, listIssueNumbers } from "../db/repos.js";
import { getIssueSyncState } from "./issue-sync-state.js";
import {
  issueSyncDigestFromResults,
  syncAllGithubIssues,
  syncGithubIssues,
  syncRemoteIssues,
  type GithubIssueClient,
  type GraphqlIssue,
  type IssuePageRequest,
  type RawIssuePage,
} from "./github-issues.js";

/**
 * Issue ingest tests: storage, per-remote fan-out, and the durable watermark
 * guard fixtures (issue visibility brief sections 3.1.1 W/C and 3.1.2). The
 * pure page guards live in `github-issues.test.ts`; this file is about what
 * actually lands in the index and what moves the watermark.
 */

beforeEach(() => {
  closeDb();
  process.env["HASNA_REPOS_DB_PATH"] = ":memory:";
  getDb(":memory:");
});

afterAll(() => {
  closeDb();
  delete process.env["HASNA_REPOS_DB_PATH"];
});

function ghIssue(number: number, overrides: Partial<GraphqlIssue> = {}): GraphqlIssue {
  return {
    number,
    title: `Issue #${number}`,
    state: "OPEN",
    stateReason: null,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-02T00:00:00Z",
    closedAt: null,
    url: `https://github.com/hasna/apps/issues/${number}`,
    author: { login: "andrei-hasna" },
    ...overrides,
  };
}

function pageOf(init: {
  nodes?: unknown[];
  hasNextPage?: boolean;
  endCursor?: string | null;
  errors?: string[];
  transport_failure?: string | null;
} = {}): RawIssuePage {
  const nodes = init.nodes ?? [];
  return {
    data: {
      repository: {
        issues: {
          totalCount: nodes.length,
          pageInfo: {
            hasNextPage: init.hasNextPage ?? false,
            endCursor: init.endCursor === undefined ? "cursor-1" : init.endCursor,
          },
          nodes,
        },
      },
    },
    errors: init.errors ?? [],
    transport_failure: init.transport_failure ?? null,
    requested_after: null,
  };
}

/** Answers from a fixed page list (last page repeats) or a per-request function. */
function stubClient(
  pages: RawIssuePage[] | ((repo: string, request: IssuePageRequest) => RawIssuePage),
) {
  const requests: Array<{ repo: string; request: IssuePageRequest }> = [];
  const client: GithubIssueClient & { requests: Array<{ repo: string; request: IssuePageRequest }> } = {
    requests,
    fetchIssuePage(repo: string, request: IssuePageRequest) {
      requests.push({ repo, request });
      if (typeof pages === "function") return pages(repo, request);
      const forRepo = requests.filter((entry) => entry.repo === repo).length - 1;
      return pages[Math.min(forRepo, pages.length - 1)]!;
    },
  };
  return client;
}

const noSleep = () => {};

/**
 * A first clean run: one sealed page whose max updatedAt is 2026-09-10T12:00:00Z,
 * leaving the 11:00:00Z watermark (max − 1h).
 */
function seedWatermark(remote = "github.com/hasna/apps") {
  const client = stubClient([pageOf({ nodes: [ghIssue(1, { updatedAt: "2026-09-10T12:00:00Z" })] })]);
  const result = syncRemoteIssues(remote, "hasna/apps", { client, retryAttempts: 1, sleep: noSleep });
  return { client, result };
}

describe("issue ingest storage", () => {
  it("stores issue rows with state reason and maps a null author to unknown", () => {
    upsertRepo({ path: "/w/apps", name: "apps", org: "hasna", remote_url: "github.com/hasna/apps" });
    const client = stubClient([pageOf({
      nodes: [ghIssue(7, {
        state: "CLOSED",
        stateReason: "NOT_PLANNED",
        closedAt: "2026-09-05T00:00:00Z",
        author: null,
      })],
    })]);

    const result = syncRemoteIssues("github.com/hasna/apps", "hasna/apps", { client });

    expect(result.sealed).toBe(true);
    expect(result.synced).toBe(1);
    expect(result.new_issues).toBe(1);
    expect(result.baseline).toBe(true);

    const row = listIssues({})[0]!;
    expect(row.number).toBe(7);
    expect(row.state).toBe("closed");
    expect(row.state_reason).toBe("NOT_PLANNED");
    expect(row.author).toBe("unknown");
    expect(row.closed_at).toBe("2026-09-05T00:00:00Z");
    expect(row.updated_at).toBe("2026-09-02T00:00:00Z");
    // Identity is resolved from the issue's own URL, not the checkout name.
    expect(row.org).toBe("hasna");
    expect(row.repo).toBe("apps");
  });

  it("writes every checkout of a remote from one fetch", () => {
    for (const path of ["/w/primary", "/w/worktrees/a", "/w/worktrees/b"]) {
      upsertRepo({ path, name: path.split("/").pop()!, org: "hasna", remote_url: "github.com/hasna/apps" });
    }
    const client = stubClient([pageOf({ nodes: [ghIssue(1), ghIssue(2)] })]);

    const result = syncRemoteIssues("github.com/hasna/apps", "hasna/apps", { client });

    expect(result.checkouts).toBe(3);
    expect(result.rows_written).toBe(6);
    expect(countIssues({ duplicates: true })).toBe(6);
    // The listing surface de-duplicates: one row per issue, not per checkout.
    expect(countIssues()).toBe(2);
    expect(client.requests).toHaveLength(1);
  });

  it("syncGithubIssues resolves a local repo record and refuses one without a remote", () => {
    const repo = upsertRepo({ path: "/w/apps", name: "apps", org: "hasna", remote_url: "github.com/hasna/apps" });
    upsertRepo({ path: "/w/local", name: "local" });
    const client = stubClient([pageOf({ nodes: [ghIssue(1)] })]);

    expect(syncGithubIssues(repo.id, { client }).synced).toBe(1);
    expect(() => syncGithubIssues("local", { client })).toThrow("has no remote URL");
  });
});

describe("watermark discipline (rules W/C)", () => {
  it("(d) a complete two-page traversal advances to max(updatedAt) − overlap", () => {
    upsertRepo({ path: "/w/apps", name: "apps", org: "hasna", remote_url: "github.com/hasna/apps" });
    const client = stubClient([
      pageOf({ nodes: [ghIssue(1, { updatedAt: "2026-09-10T10:00:00Z" })], hasNextPage: true, endCursor: "c1" }),
      pageOf({ nodes: [ghIssue(2, { updatedAt: "2026-09-10T12:00:00Z" })] }),
    ]);

    const result = syncRemoteIssues("github.com/hasna/apps", "hasna/apps", { client, retryAttempts: 1, sleep: noSleep });

    expect(result.sealed).toBe(true);
    expect(result.watermark_advanced).toBe(true);
    expect(result.watermark).toBe("2026-09-10T11:00:00Z");
    expect(result.max_updated_at).toBe("2026-09-10T12:00:00Z");

    const state = getIssueSyncState("github.com/hasna/apps")!;
    expect(state.watermark_updated_at).toBe("2026-09-10T11:00:00Z");
    expect(state.last_outcome).toBe("complete");
    expect(state.first_complete_at).not.toBeNull();
  });

  it("(d) the next run pins the inclusive watermark as since and upserts idempotently", () => {
    const repo = upsertRepo({ path: "/w/apps", name: "apps", org: "hasna", remote_url: "github.com/hasna/apps" });
    seedWatermark();

    // The boundary issue is returned again (GitHub's `since` is inclusive at
    // or after), plus one genuinely new issue.
    const client = stubClient([pageOf({
      nodes: [
        ghIssue(1, { updatedAt: "2026-09-10T12:00:00Z" }),
        ghIssue(2, { updatedAt: "2026-09-10T13:00:00Z", title: "Newer issue" }),
      ],
    })]);
    const second = syncRemoteIssues("github.com/hasna/apps", "hasna/apps", { client, retryAttempts: 1, sleep: noSleep });

    expect(client.requests[0]!.request.since).toBe("2026-09-10T11:00:00Z");
    expect(second.sealed).toBe(true);
    expect(second.baseline).toBe(false);
    expect(second.new_issues).toBe(1);
    expect(second.rows_written).toBe(2);
    // The overlap re-read is idempotent: still one row per issue.
    expect(listIssueNumbers(repo.id)).toEqual([1, 2]);
    expect(countIssues()).toBe(2);
    expect(listIssues({ orderBy: "updated" })[0]!.title).toBe("Newer issue");
  });

  it("(c) a truncated traversal does not advance the watermark", () => {
    upsertRepo({ path: "/w/apps", name: "apps", org: "hasna", remote_url: "github.com/hasna/apps" });
    const client = stubClient([
      pageOf({ nodes: [ghIssue(1), ghIssue(2)], hasNextPage: true, endCursor: "c1" }),
    ]);

    const result = syncRemoteIssues("github.com/hasna/apps", "hasna/apps", {
      client, limit: 1, pageSize: 1, retryAttempts: 1, sleep: noSleep,
    });

    expect(result.truncated).toBe(true);
    expect(result.sealed).toBe(false);
    expect(result.watermark_advanced).toBe(false);
    expect(result.watermark).toBeNull();
    expect(result.incomplete).toHaveLength(1);
    expect(result.incomplete[0]!.reason).toBe("truncated");

    const state = getIssueSyncState("github.com/hasna/apps")!;
    expect(state.watermark_updated_at).toBeNull();
    expect(state.last_outcome).toBe("truncated");
    // A later run has no boundary to slide: it must re-read from the start.
    const retryClient = stubClient([pageOf({ nodes: [] })]);
    syncRemoteIssues("github.com/hasna/apps", "hasna/apps", { client: retryClient, retryAttempts: 1, sleep: noSleep });
    expect(retryClient.requests[0]!.request.since).toBeNull();
  });

  it("(a) an error-carrying page after a good run leaves the watermark unchanged", () => {
    upsertRepo({ path: "/w/apps", name: "apps", org: "hasna", remote_url: "github.com/hasna/apps" });
    seedWatermark();

    const client = stubClient([pageOf({ nodes: [ghIssue(9)], errors: ["Something went wrong"] })]);
    const result = syncRemoteIssues("github.com/hasna/apps", "hasna/apps", { client, retryAttempts: 3, retryBackoffMs: 0, sleep: noSleep });

    expect(result.sealed).toBe(false);
    expect(result.watermark_advanced).toBe(false);
    expect(result.watermark).toBe("2026-09-10T11:00:00Z");
    expect(result.rate_limited).toBe(false);
    expect(result.nodes_seen).toBe(1);
    expect(result.incomplete[0]).toMatchObject({ repo: "hasna/apps", reason: "page_transient" });

    const state = getIssueSyncState("github.com/hasna/apps")!;
    expect(state.watermark_updated_at).toBe("2026-09-10T11:00:00Z");
    expect(state.last_outcome).toBe("incomplete");
    // The failed page wrote nothing, so the index still holds only issue 1.
    expect(countIssues()).toBe(1);
  });

  it("(b) a null hole does not advance the watermark", () => {
    upsertRepo({ path: "/w/apps", name: "apps", org: "hasna", remote_url: "github.com/hasna/apps" });
    seedWatermark();

    const client = stubClient([pageOf({ nodes: [ghIssue(2), null, ghIssue(3)] })]);
    const result = syncRemoteIssues("github.com/hasna/apps", "hasna/apps", { client, retryAttempts: 1, sleep: noSleep });

    expect(result.sealed).toBe(false);
    expect(result.nodes_seen).toBe(3);
    expect(result.nodes_dropped).toBe(1);
    expect(result.incomplete[0]!.reason).toBe("nodes_dropped");
    expect(getIssueSyncState("github.com/hasna/apps")!.watermark_updated_at).toBe("2026-09-10T11:00:00Z");
    expect(countIssues()).toBe(1);
  });

  it("(W7) never lowers the watermark and records an anomaly", () => {
    upsertRepo({ path: "/w/apps", name: "apps", org: "hasna", remote_url: "github.com/hasna/apps" });
    seedWatermark();

    const client = stubClient([pageOf({ nodes: [ghIssue(3, { updatedAt: "2026-09-01T00:00:00Z" })] })]);
    const result = syncRemoteIssues("github.com/hasna/apps", "hasna/apps", { client, retryAttempts: 1, sleep: noSleep });

    expect(result.sealed).toBe(true);
    expect(result.watermark_advanced).toBe(false);
    expect(result.watermark).toBe("2026-09-10T11:00:00Z");
    expect(result.anomalies).toHaveLength(1);
    expect(result.anomalies[0]).toContain("not lowered");
    // The older row is still stored and readable.
    expect(listIssues({}).map((row) => row.number)).toContain(3);
  });

  it("an empty-but-valid connection seals, records a baseline, and sets no watermark", () => {
    upsertRepo({ path: "/w/apps", name: "apps", org: "hasna", remote_url: "github.com/hasna/apps" });
    const client = stubClient([pageOf({ nodes: [] })]);

    const result = syncRemoteIssues("github.com/hasna/apps", "hasna/apps", { client });

    expect(result.sealed).toBe(true);
    expect(result.baseline).toBe(true);
    expect(result.watermark).toBeNull();
    const state = getIssueSyncState("github.com/hasna/apps")!;
    expect(state.last_outcome).toBe("complete");
    expect(state.watermark_updated_at).toBeNull();
  });
});

describe("truthful reporting (rule R2)", () => {
  it("(e) a baseline first run never claims 0 new; a later quiet run may", () => {
    upsertRepo({ path: "/w/apps", name: "apps", org: "hasna", remote_url: "github.com/hasna/apps" });
    const first = stubClient([pageOf({ nodes: [ghIssue(1)] })]);
    const baselineRun = syncRemoteIssues("github.com/hasna/apps", "hasna/apps", { client: first });

    expect(baselineRun.baseline).toBe(true);
    const baselineDigest = issueSyncDigestFromResults([baselineRun]);
    expect(baselineDigest.reportable).toBe(true);
    expect(baselineDigest.line).not.toContain("0 new");
    expect(baselineDigest.line).toContain("baseline");

    // Second run: complete, nothing new — the one case that may say "0 new".
    const second = stubClient([pageOf({ nodes: [ghIssue(1)] })]);
    const quietRun = syncRemoteIssues("github.com/hasna/apps", "hasna/apps", { client: second });
    expect(quietRun.baseline).toBe(false);
    const quietDigest = issueSyncDigestFromResults([quietRun]);
    expect(quietDigest.reportable).toBe(true);
    expect(quietDigest.line).toContain("0 new");
  });

  it("(e) a degraded run reports incomplete[] and cannot render as 0 new", () => {
    upsertRepo({ path: "/w/apps", name: "apps", org: "hasna", remote_url: "github.com/hasna/apps" });
    const client = stubClient([pageOf({ errors: ["boom"] })]);

    const result = syncRemoteIssues("github.com/hasna/apps", "hasna/apps", { client, retryAttempts: 1, sleep: noSleep });
    const digest = issueSyncDigestFromResults([result]);

    expect(digest.reportable).toBe(false);
    expect(digest.line).not.toContain("0 new");
    expect(digest.line).toContain("degraded");
    expect(result.incomplete[0]!.repo).toBe("hasna/apps");
  });
});

describe("syncAllGithubIssues fan-out", () => {
  it("does one pass per distinct remote, not one per checkout", () => {
    for (const path of ["/w/a", "/w/b", "/w/c"]) {
      upsertRepo({ path, name: path.slice(3), org: "hasna", remote_url: "github.com/hasna/apps" });
    }
    upsertRepo({ path: "/w/other", name: "other", org: "hasna", remote_url: "github.com/hasna/other" });
    const client = stubClient([pageOf({ nodes: [] })]);

    const result = syncAllGithubIssues({ org: "hasna", client, retryAttempts: 1, sleep: noSleep });

    expect(result.errors).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.repos_seen).toBe(4);
    expect(result.remotes_seen).toBe(2);
    expect(result.repos_checked).toBe(2);
    expect(client.requests.map((entry) => entry.repo)).toEqual(["hasna/apps", "hasna/other"]);
    expect(result.sealed).toBe(true);
  });

  it("skips a gone repository and continues, like the PR fan-out", () => {
    upsertRepo({ path: "/w/apps", name: "apps", org: "hasna", remote_url: "github.com/hasna/apps" });
    upsertRepo({ path: "/w/gone", name: "gone", org: "hasna", remote_url: "github.com/hasna/gone" });
    const client = stubClient((repo) => repo === "hasna/gone"
      ? pageOf({ errors: ["Could not resolve to a Repository with the name 'hasna/gone'."] })
      : pageOf({ nodes: [ghIssue(1)] }));

    const result = syncAllGithubIssues({ org: "hasna", client, retryAttempts: 1, sleep: noSleep });

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toContain("hasna/gone");
    expect(result.errors).toEqual([]);
    expect(result.repos_synced).toBe(1);
    expect(result.total_synced).toBe(1);
    // One remote was skipped, so the fleet run is not "sealed".
    expect(result.sealed).toBe(false);
  });

  it("stops the fleet run on a rate limit and reports it", () => {
    upsertRepo({ path: "/w/apps", name: "apps", org: "hasna", remote_url: "github.com/hasna/apps" });
    upsertRepo({ path: "/w/other", name: "other", org: "hasna", remote_url: "github.com/hasna/other" });
    const client = stubClient((repo) => repo === "hasna/apps"
      ? pageOf({ errors: ["API rate limit exceeded for user ID 1."], hasNextPage: true, endCursor: "c1" })
      : pageOf({ nodes: [] }));

    const result = syncAllGithubIssues({ org: "hasna", client, retryAttempts: 3, retryBackoffMs: 0, sleep: noSleep });

    expect(result.stopped_early).toBe(true);
    expect(result.repos_checked).toBe(1);
    expect(result.results[0]!.rate_limited).toBe(true);
    expect(result.sealed).toBe(false);
    expect(issueSyncDigestFromResults(result.results).reportable).toBe(false);
  });

  it("caps the fleet with maxRepos and reports the run as truncated", () => {
    upsertRepo({ path: "/w/apps", name: "apps", org: "hasna", remote_url: "github.com/hasna/apps" });
    upsertRepo({ path: "/w/other", name: "other", org: "hasna", remote_url: "github.com/hasna/other" });
    const client = stubClient([pageOf({ nodes: [] })]);

    const result = syncAllGithubIssues({ org: "hasna", maxRepos: 1, client, retryAttempts: 1, sleep: noSleep });

    expect(result.truncated).toBe(true);
    expect(result.remotes_seen).toBe(2);
    expect(result.repos_checked).toBe(1);
    expect(issueSyncDigestFromResults(result.results, result.truncated).reportable).toBe(false);
  });

  it("checks nothing when no remote is indexed", () => {
    upsertRepo({ path: "/w/local", name: "local" });
    const result = syncAllGithubIssues({ org: "hasna", client: stubClient([pageOf({ nodes: [] })]) });

    expect(result.repos_checked).toBe(0);
    expect(result.sealed).toBe(false);
    expect(issueSyncDigestFromResults(result.results, result.truncated).reportable).toBe(false);
  });
});
