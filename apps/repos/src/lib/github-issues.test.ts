import { describe, expect, test } from "bun:test";
import {
  DEFAULT_WATERMARK_OVERLAP_MS,
  adjudicateIssuePage,
  fetchIssues,
  fetchStableIssueSnapshot,
  isRateLimitedError,
  isUsableIssueNode,
  issueSyncDigest,
  issueSyncDigestFromResults,
  watermarkCandidate,
  type GithubIssueClient,
  type GraphqlIssue,
  type IssuePageRequest,
  type RawIssuePage,
  type SyncIssuesResult,
} from "./github-issues.js";

/**
 * Guard fixtures for the issue detection reader (issue visibility brief
 * section 3.1.1/3.1.2). These are the adversarial cases the PR path
 * deliberately does NOT handle — see `github.test.ts` "drops the null holes in
 * a partially-resolved page": the PR sync keeps the good nodes and advances,
 * because re-enumeration repairs the hole. The issue reader has no such net,
 * so here the same shape must fail the page and pin the cursor.
 */

function issue(number: number, overrides: Partial<GraphqlIssue> = {}): GraphqlIssue {
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
  totalCount?: number;
  errors?: string[];
  transport_failure?: string | null;
} = {}): RawIssuePage {
  const nodes = init.nodes ?? [];
  return {
    data: {
      repository: {
        issues: {
          totalCount: init.totalCount ?? nodes.length,
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

/** Answers from a fixed page list; the last page repeats once exhausted. */
function stubClient(pages: RawIssuePage[] | ((request: IssuePageRequest) => RawIssuePage)) {
  const requests: IssuePageRequest[] = [];
  const client: GithubIssueClient & { requests: IssuePageRequest[] } = {
    requests,
    fetchIssuePage(_repo: string, request: IssuePageRequest) {
      requests.push(request);
      if (typeof pages === "function") return pages(request);
      return pages[Math.min(requests.length - 1, pages.length - 1)]!;
    },
  };
  return client;
}

/** No test may sleep; retries are asserted by attempt counts, not wall time. */
const noSleep = () => {};

describe("adjudicateIssuePage (rules E/N/C)", () => {
  test("seals a clean page", () => {
    const verdict = adjudicateIssuePage(pageOf({ nodes: [issue(1), issue(2)], hasNextPage: true, endCursor: "c1" }));
    expect(verdict.sealed).toBe(true);
    expect(verdict.nodes.map((node) => node.number)).toEqual([1, 2]);
    expect(verdict.failure).toBeNull();
    expect(verdict.has_next_page).toBe(true);
    expect(verdict.end_cursor).toBe("c1");
  });

  test("E1: any non-empty errors[] fails the page even when every node is present", () => {
    const verdict = adjudicateIssuePage(pageOf({ nodes: [issue(1), issue(2)], errors: ["Something went wrong"] }));
    expect(verdict.sealed).toBe(false);
    expect(verdict.failure).toBe("page_transient");
    // The page's contents are still counted, but a failed page contributes no
    // rows: only sealed pages may write.
    expect(verdict.nodes_seen).toBe(2);
    expect(verdict.nodes).toEqual([]);
  });

  test("E3: a RATE_LIMITED error is classified so the run can stop instead of retrying", () => {
    const verdict = adjudicateIssuePage(pageOf({ errors: ["API rate limit exceeded for user ID 1."] }));
    expect(verdict.failure).toBe("rate_limited");
    expect(verdict.detail).toContain("rate limit");
  });

  test("E3: a gone repository is classified as missing, not transient", () => {
    const verdict = adjudicateIssuePage(pageOf({ errors: ["Could not resolve to a Repository with the name 'hasna/gone'."] }));
    expect(verdict.failure).toBe("missing_repo");
  });

  test("N1: a null hole marks the page incomplete and counts as dropped", () => {
    // Contrast with github.test.ts:12 ("drops the null holes in a
    // partially-resolved page"), where the same shape is filtered silently and
    // the traversal advances. Here the hole is reported, the page fails, and
    // none of the page is written.
    const verdict = adjudicateIssuePage(pageOf({ nodes: [issue(2), null, issue(3)] }));
    expect(verdict.sealed).toBe(false);
    expect(verdict.failure).toBe("nodes_dropped");
    expect(verdict.nodes_seen).toBe(3);
    expect(verdict.nodes_dropped).toBe(1);
    expect(verdict.nodes).toEqual([]);
  });

  test("N3: a half-resolved node is dropped and fails the page", () => {
    const verdict = adjudicateIssuePage(pageOf({
      nodes: [issue(1, { updatedAt: "" }), issue(2, { state: "MERGED" }), issue(3)],
    }));
    expect(verdict.sealed).toBe(false);
    expect(verdict.nodes_seen).toBe(3);
    expect(verdict.nodes_dropped).toBe(2);
    expect(verdict.nodes).toEqual([]);
  });

  test("N3: a null author is storable (only the writer maps it to unknown)", () => {
    const verdict = adjudicateIssuePage(pageOf({ nodes: [issue(1, { author: null })] }));
    expect(verdict.sealed).toBe(true);
  });

  test("C1: a null pageInfo is incomplete, not a silent stop", () => {
    const verdict = adjudicateIssuePage({
      data: { repository: { issues: { totalCount: 1, pageInfo: null, nodes: [issue(1)] } } },
      errors: [],
      transport_failure: null,
      requested_after: null,
    });
    expect(verdict.sealed).toBe(false);
    expect(verdict.failure).toBe("page_info_missing");
  });

  test("C1: hasNextPage true with a null endCursor is incomplete", () => {
    const verdict = adjudicateIssuePage(pageOf({ nodes: [issue(1)], hasNextPage: true, endCursor: null }));
    expect(verdict.sealed).toBe(false);
    expect(verdict.failure).toBe("end_cursor_missing");
  });

  test("a missing or non-array nodes field is incomplete, not an empty page", () => {
    const verdict = adjudicateIssuePage({
      data: { repository: { issues: { totalCount: 0, pageInfo: { hasNextPage: false, endCursor: null } } } },
      errors: [],
      transport_failure: null,
      requested_after: null,
    });
    expect(verdict.failure).toBe("nodes_not_array");
  });

  test("an empty-but-valid connection is a legitimate empty page", () => {
    // Distinct from a null connection: "no issues" must be sealable, while a
    // null repository stays a hard failure.
    const verdict = adjudicateIssuePage(pageOf({ nodes: [], hasNextPage: false }));
    expect(verdict.sealed).toBe(true);
    expect(verdict.nodes_seen).toBe(0);
  });

  test("a null repository with a clean body is reported as missing", () => {
    const verdict = adjudicateIssuePage({ data: { repository: null }, errors: [], transport_failure: null, requested_after: null });
    expect(verdict.failure).toBe("missing_repo");
  });
});

describe("fetchIssues traversal", () => {
  test("(a) an error-carrying response fails the page and never advances the cursor", () => {
    const client = stubClient([pageOf({ nodes: [issue(1)], hasNextPage: true, endCursor: "c1", errors: ["Something went wrong"] })]);
    const result = fetchIssues("hasna/apps", { client, retryAttempts: 3, retryBackoffMs: 0, sleep: noSleep });

    expect(result.sealed).toBe(false);
    expect(result.failure).toBe("page_transient");
    // The cursor never moved: every attempt asked for the page head.
    expect(result.requested_cursors).toEqual([null, null, null]);
    expect(client.requests.every((request) => request.after === null)).toBe(true);
    // Bounded retry of the SAME page, then stop.
    expect(result.pages_fetched).toBe(3);
  });

  test("(b) a null node marks the page incomplete and never advances the cursor", () => {
    const client = stubClient([pageOf({ nodes: [issue(2), null, issue(3)], hasNextPage: true, endCursor: "c1" })]);
    const result = fetchIssues("hasna/apps", { client, retryAttempts: 1, retryBackoffMs: 0, sleep: noSleep });

    expect(result.sealed).toBe(false);
    expect(result.failure).toBe("nodes_dropped");
    expect(result.nodes_seen).toBe(3);
    expect(result.nodes_dropped).toBe(1);
    // Stricter than the PR path's silent filter: the failed page writes nothing.
    expect(result.nodes).toEqual([]);
    expect(result.requested_cursors).toEqual([null]);
  });

  test("(c) a local limit truncates the traversal and seals nothing", () => {
    const client = stubClient([
      pageOf({ nodes: [issue(1), issue(2)], hasNextPage: true, endCursor: "c1" }),
      pageOf({ nodes: [issue(3)], hasNextPage: true, endCursor: "c2" }),
    ]);
    const result = fetchIssues("hasna/apps", { client, limit: 2, pageSize: 2, retryAttempts: 1, sleep: noSleep });

    expect(result.truncated).toBe(true);
    expect(result.sealed).toBe(false);
    expect(result.nodes.map((node) => node.number)).toEqual([1, 2]);
    // It never asked for page two: a truncated traversal stops where it is.
    expect(result.requested_cursors).toEqual([null]);
  });

  test("(d) a clean exhausted two-page traversal seals and reports max updatedAt", () => {
    const client = stubClient([
      pageOf({ nodes: [issue(2, { updatedAt: "2026-09-10T12:00:00Z" })], hasNextPage: true, endCursor: "c1", totalCount: 2 }),
      pageOf({ nodes: [issue(1, { updatedAt: "2026-09-10T10:00:00Z" })], hasNextPage: false, totalCount: 2 }),
    ]);
    const result = fetchIssues("hasna/apps", { client, retryAttempts: 1, sleep: noSleep });

    expect(result.sealed).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.failure).toBeNull();
    expect(result.pages_fetched).toBe(2);
    expect(result.requested_cursors).toEqual([null, "c1"]);
    expect(result.max_updated_at).toBe("2026-09-10T12:00:00Z");
    expect(watermarkCandidate(result.max_updated_at!, DEFAULT_WATERMARK_OVERLAP_MS)).toBe("2026-09-10T11:00:00Z");
  });

  test("(d) excludes the cursor from a page that fails and does not continue past it", () => {
    const client = stubClient([
      pageOf({ nodes: [issue(1)], hasNextPage: true, endCursor: "c1" }),
      pageOf({ nodes: [issue(2)], hasNextPage: true, endCursor: "c2", errors: ["boom"] }),
    ]);
    const result = fetchIssues("hasna/apps", { client, retryAttempts: 1, sleep: noSleep });

    expect(result.sealed).toBe(false);
    expect(result.requested_cursors).toEqual([null, "c1"]);
    // The failed page's endCursor "c2" is never requested.
    expect(client.requests.map((request) => request.after)).toEqual([null, "c1"]);
  });

  test("a transient failure is retried and a clean retry seals the page", () => {
    let attempt = 0;
    const client = stubClient(() => {
      attempt++;
      if (attempt === 1) return pageOf({ transport_failure: "GitHub CLI request failed exit=1" });
      return pageOf({ nodes: [issue(7)] });
    });
    const result = fetchIssues("hasna/apps", { client, retryAttempts: 3, retryBackoffMs: 0, sleep: noSleep });

    expect(result.sealed).toBe(true);
    expect(result.pages_fetched).toBe(2);
    expect(result.nodes.map((node) => node.number)).toEqual([7]);
  });

  test("a rate limit stops the traversal without retrying", () => {
    const client = stubClient([pageOf({ errors: ["API rate limit exceeded"], hasNextPage: true, endCursor: "c1" })]);
    const result = fetchIssues("hasna/apps", { client, retryAttempts: 3, retryBackoffMs: 0, sleep: noSleep });

    expect(result.rate_limited).toBe(true);
    expect(result.failure).toBe("rate_limited");
    expect(result.pages_fetched).toBe(1);
    expect(client.requests).toHaveLength(1);
  });

  test("a gone repository throws instead of being reported as an empty page", () => {
    const client = stubClient([pageOf({ errors: ["Could not resolve to a Repository with the name 'hasna/gone'."] })]);
    expect(() => fetchIssues("hasna/gone", { client, retryAttempts: 3, retryBackoffMs: 0, sleep: noSleep }))
      .toThrow("GitHub repository is unavailable");
    // Not retried: a missing repo cannot be repaired by asking again.
    expect(client.requests).toHaveLength(1);
  });

  test("pins the since boundary on every page and never slides it", () => {
    const client = stubClient([
      pageOf({ nodes: [issue(1)], hasNextPage: true, endCursor: "c1" }),
      pageOf({ nodes: [issue(2)] }),
    ]);
    fetchIssues("hasna/apps", { client, since: "2026-09-10T11:00:00Z", retryAttempts: 1, sleep: noSleep });

    expect(client.requests.map((request) => request.since)).toEqual(["2026-09-10T11:00:00Z", "2026-09-10T11:00:00Z"]);
  });
});



describe("whole-traversal mutation guards", () => {
  test("refuses an insertion that changes totalCount between pages", () => {
    const client = stubClient([
      pageOf({ nodes: [issue(4), issue(3)], hasNextPage: true, endCursor: "c1", totalCount: 4 }),
      pageOf({ nodes: [issue(2), issue(1)], totalCount: 5 }),
    ]);
    const result = fetchIssues("hasna/apps", { client, retryAttempts: 1, sleep: noSleep });

    expect(result.sealed).toBe(false);
    expect(result.failure).toBe("total_count_changed");
    expect(result.detail).toContain("4 -> 5");
  });

  test("refuses a deletion that changes totalCount between pages", () => {
    const client = stubClient([
      pageOf({ nodes: [issue(4), issue(3)], hasNextPage: true, endCursor: "c1", totalCount: 4 }),
      pageOf({ nodes: [issue(1)], totalCount: 3 }),
    ]);
    const result = fetchIssues("hasna/apps", { client, retryAttempts: 1, sleep: noSleep });

    expect(result.sealed).toBe(false);
    expect(result.failure).toBe("total_count_changed");
  });

  test("refuses duplicate identities and non-monotonic UPDATED_AT order", () => {
    const duplicate = fetchIssues("hasna/apps", {
      client: stubClient([
        pageOf({ nodes: [issue(2)], hasNextPage: true, endCursor: "c1", totalCount: 2 }),
        pageOf({ nodes: [issue(2)], totalCount: 2 }),
      ]),
      retryAttempts: 1,
      sleep: noSleep,
    });
    expect(duplicate.failure).toBe("duplicate_identity");

    const reordered = fetchIssues("hasna/apps", {
      client: stubClient([
        pageOf({ nodes: [issue(1, { updatedAt: "2026-09-01T00:00:00Z" })], hasNextPage: true, endCursor: "c1", totalCount: 2 }),
        pageOf({ nodes: [issue(2, { updatedAt: "2026-09-02T00:00:00Z" })], totalCount: 2 }),
      ]),
      retryAttempts: 1,
      sleep: noSleep,
    });
    expect(reordered.failure).toBe("order_invalid");
  });

  test("refuses balanced insert/delete mutation across complete passes", () => {
    const older = (number: number, hour: number) => issue(number, { updatedAt: `2026-09-02T0${hour}:00:00Z` });
    const client = stubClient([
      pageOf({ nodes: [older(1, 4), older(2, 3)], hasNextPage: true, endCursor: "c1", totalCount: 4 }),
      pageOf({ nodes: [older(3, 2), older(4, 1)], totalCount: 4 }),
      pageOf({ nodes: [older(5, 5), older(2, 3)], hasNextPage: true, endCursor: "c1", totalCount: 4 }),
      pageOf({ nodes: [older(3, 2), older(4, 1)], totalCount: 4 }),
    ]);
    const result = fetchStableIssueSnapshot("hasna/apps", { client, pageSize: 2, retryAttempts: 1, sleep: noSleep });

    expect(result.sealed).toBe(false);
    expect(result.failure).toBe("snapshot_changed");
    expect(result.pages_fetched).toBe(4);
  });

  test("refuses same-total reorder between complete passes", () => {
    const tied = (number: number) => issue(number, { updatedAt: "2026-09-02T00:00:00Z" });
    const client = stubClient([
      pageOf({ nodes: [tied(1)], hasNextPage: true, endCursor: "c1", totalCount: 2 }),
      pageOf({ nodes: [tied(2)], totalCount: 2 }),
      pageOf({ nodes: [tied(2)], hasNextPage: true, endCursor: "c1", totalCount: 2 }),
      pageOf({ nodes: [tied(1)], totalCount: 2 }),
    ]);
    const result = fetchStableIssueSnapshot("hasna/apps", { client, pageSize: 1, retryAttempts: 1, sleep: noSleep });

    expect(result.sealed).toBe(false);
    expect(result.failure).toBe("snapshot_changed");
  });
});

describe("node and error classification", () => {
  test("isUsableIssueNode requires exactly the NOT NULL + watermark fields", () => {
    expect(isUsableIssueNode(issue(1))).toBe(true);
    expect(isUsableIssueNode(issue(1, { author: null }))).toBe(true);
    expect(isUsableIssueNode(null)).toBe(false);
    expect(isUsableIssueNode({})).toBe(false);
    expect(isUsableIssueNode(issue(1, { number: -1 }))).toBe(false);
    expect(isUsableIssueNode(issue(1, { title: undefined as unknown as string }))).toBe(false);
    expect(isUsableIssueNode(issue(1, { createdAt: "" }))).toBe(false);
    expect(isUsableIssueNode(issue(1, { state: "OPENED" }))).toBe(false);
    expect(isUsableIssueNode(issue(1, { updatedAt: "" }))).toBe(false);
  });

  test("isRateLimitedError recognises rate-limit and abuse responses", () => {
    expect(isRateLimitedError("API rate limit exceeded for user ID 1.")).toBe(true);
    expect(isRateLimitedError("You have triggered an abuse detection mechanism")).toBe(true);
    expect(isRateLimitedError("GitHub CLI request failed exit=403")).toBe(true);
    expect(isRateLimitedError("Something went wrong")).toBe(false);
  });

  test("watermarkCandidate is max(updatedAt) minus the overlap, in GitHub time", () => {
    expect(watermarkCandidate("2026-09-10T12:00:00Z", 60 * 60 * 1000)).toBe("2026-09-10T11:00:00Z");
    expect(watermarkCandidate("2026-09-10T12:00:00Z", 0)).toBe("2026-09-10T12:00:00Z");
    expect(watermarkCandidate("not a date", 1000)).toBeNull();
  });
});

describe("issueSyncDigest (rule R2: 0 new must be falsifiable)", () => {
  const base = {
    sealed: true,
    truncated: false,
    baseline: false,
    new_issues: 0,
    synced: 7,
    pages_fetched: 1,
    nodes_dropped: 0,
    incomplete: [],
  };

  test("(e) 0 new is emitted only when the run is sealed and untruncated", () => {
    const clean = issueSyncDigest(base);
    expect(clean.reportable).toBe(true);
    expect(clean.line).toContain("0 new");
  });

  test("(e) a failed page renders degraded and never as 0 new", () => {
    const failed = issueSyncDigest({
      ...base,
      sealed: false,
      incomplete: [{ repo: "hasna/apps", reason: "page_transient", detail: "boom" }],
    });
    expect(failed.reportable).toBe(false);
    expect(failed.line).not.toContain("0 new");
    expect(failed.line).toContain("degraded");
    expect(failed.line).toContain("hasna/apps");
    expect(failed.degraded_reasons).toEqual(["hasna/apps: page_transient"]);
  });

  test("(e) a truncated traversal renders degraded and never as 0 new", () => {
    const truncated = issueSyncDigest({ ...base, sealed: false, truncated: true });
    expect(truncated.reportable).toBe(false);
    expect(truncated.line).not.toContain("0 new");
  });

  test("(e) a baseline run makes no new-issue claim", () => {
    const baseline = issueSyncDigest({ ...base, baseline: true, synced: 123 });
    expect(baseline.reportable).toBe(true);
    expect(baseline.line).not.toContain("0 new");
    expect(baseline.line).toContain("baseline");
  });

  test("a sealed run with new issues reports the count", () => {
    expect(issueSyncDigest({ ...base, new_issues: 3 }).line).toContain("3 new");
  });

  test("aggregating results: any baseline or incomplete repo degrades the claim", () => {
    const result = (overrides: Partial<SyncIssuesResult>): SyncIssuesResult => ({
      repo_name: "hasna/apps",
      remote: "github.com/hasna/apps",
      checkouts: 1,
      synced: 1,
      rows_written: 1,
      rows_deleted: 0,
      new_issues: 0,
      pages_fetched: 1,
      nodes_seen: 1,
      nodes_dropped: 0,
      sealed: true,
      truncated: false,
      incomplete: [],
      errors: [],
      baseline: false,
      watermark_advanced: false,
      watermark: null,
      max_updated_at: null,
      rate_limited: false,
      anomalies: [],
      ...overrides,
    });

    expect(issueSyncDigestFromResults([result({})]).reportable).toBe(true);
    expect(issueSyncDigestFromResults([result({})]).line).toContain("0 new");

    const withBaseline = issueSyncDigestFromResults([result({}), result({ repo_name: "hasna/other", baseline: true })]);
    expect(withBaseline.reportable).toBe(true);
    expect(withBaseline.line).not.toContain("0 new");

    const withFailure = issueSyncDigestFromResults([result({
      sealed: false,
      incomplete: [{ repo: "hasna/apps", reason: "nodes_dropped", detail: "1 node(s) dropped" }],
    })]);
    expect(withFailure.reportable).toBe(false);
    expect(withFailure.line).not.toContain("0 new");

    expect(issueSyncDigestFromResults([result({})], true).reportable).toBe(false);
    expect(issueSyncDigestFromResults([]).reportable).toBe(false);
  });
});
