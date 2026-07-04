import { describe, expect, test } from "bun:test";
import { prReferenceFromText, prReviewRoutingDecision, type PrReviewRoutingDeps } from "./pr-review.js";
import type { TodosTaskRouteOptions } from "./types.js";

// The pr-queue producer stamps every merge-queue task with a PR URL + fingerprint
// but empty metadata (no author line). These tests pin the admission-time author
// self-derivation that unjams the merge queue while preserving self-review
// protection and fail-closed behavior when the author cannot be resolved.

const MERGE_QUEUE_DESCRIPTION = [
  "Fingerprint: github-pr:hasna/codewith#113",
  "Repository: /home/hasna/workspace/hasna/opensource/open-codewith",
  "PR: https://github.com/hasna/codewith/pull/113",
  "Base: main",
  "Head: fix/background-agent-daemon-context",
  "",
  "Start a durable goal. Inspect GitHub PR state, checks, branch freshness, review status, and conflicts. Merge only when validation and policy allow it.",
].join("\n");

function mergeQueueTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Review and safely merge hasna/codewith#113: Fix background agent cwd context snapshots",
    description: MERGE_QUEUE_DESCRIPTION,
    tags: ["auto:route", "area:repoops", "github-pr", "pr-merge-queue"],
    metadata: {},
    ...overrides,
  };
}

const REVIEWER_POOL_OPTS: TodosTaskRouteOptions = { githubReviewerPool: "review-bot-a,review-bot-b" };

describe("prReferenceFromText", () => {
  test("extracts owner/repo + number from a canonical PR URL", () => {
    expect(prReferenceFromText("see https://github.com/hasna/loops/pull/42 for details")).toEqual({
      repo: "hasna/loops",
      number: 42,
    });
  });

  test("extracts owner/repo + number from a github-pr fingerprint", () => {
    expect(prReferenceFromText("Fingerprint: github-pr:hasna/knowledge#10")).toEqual({
      repo: "hasna/knowledge",
      number: 10,
    });
  });

  test("returns undefined when no resolvable reference is present", () => {
    expect(prReferenceFromText("Review and merge the pull request please")).toBeUndefined();
  });
});

describe("prReviewRoutingDecision admission-time author derivation", () => {
  test("derives the PR author from the fingerprint reference and admits the route", () => {
    const calls: Array<{ repo: string; number: number }> = [];
    const deps: PrReviewRoutingDeps = {
      lookupPrAuthor: (reference) => {
        calls.push(reference);
        return "octo-author";
      },
    };

    const decision = prReviewRoutingDecision(mergeQueueTask(), {}, REVIEWER_POOL_OPTS, deps);

    // Author is resolved via the injected lookup (not from empty task metadata).
    expect(decision.required).toBe(true);
    expect(decision.allowed).toBe(true);
    expect(decision.author).toBe("octo-author");
    expect(decision.authorSource).toBe("github-api");
    expect(decision.selectedReviewer).toBe("review-bot-a");
    expect(decision.signals).toContain("author-derived-github-api");
    // Exactly one lookup per candidate, resolved from the fingerprint reference.
    expect(calls).toEqual([{ repo: "hasna/codewith", number: 113 }]);
  });

  test("prefers task-evidence author and does not call the lookup when author is present", () => {
    let called = false;
    const deps: PrReviewRoutingDeps = {
      lookupPrAuthor: () => {
        called = true;
        return "should-not-be-used";
      },
    };

    const decision = prReviewRoutingDecision(
      mergeQueueTask({ metadata: { github_author: "andrei-hasna" } }),
      {},
      REVIEWER_POOL_OPTS,
      deps,
    );

    expect(decision.allowed).toBe(true);
    expect(decision.author).toBe("andrei-hasna");
    expect(decision.authorSource).toBe("evidence");
    expect(called).toBe(false);
  });

  test("blocks self-review when the derived author is the sole reviewer candidate", () => {
    const deps: PrReviewRoutingDeps = { lookupPrAuthor: () => "solo-dev" };

    const decision = prReviewRoutingDecision(
      mergeQueueTask(),
      {},
      { githubReviewerPool: "solo-dev" },
      deps,
    );

    expect(decision.required).toBe(true);
    expect(decision.allowed).toBe(false);
    expect(decision.author).toBe("solo-dev");
    expect(decision.reason).toContain("self-review is not routable");
  });

  test("fails closed when the GitHub lookup is unreachable (returns no login)", () => {
    let called = false;
    const deps: PrReviewRoutingDeps = {
      lookupPrAuthor: () => {
        called = true;
        return undefined; // simulates gh non-zero exit / DNS failure / empty output
      },
    };

    const decision = prReviewRoutingDecision(mergeQueueTask(), {}, REVIEWER_POOL_OPTS, deps);

    expect(called).toBe(true);
    expect(decision.required).toBe(true);
    expect(decision.allowed).toBe(false);
    expect(decision.author).toBeUndefined();
    expect(decision.reason).toContain("requires PR author evidence");
    expect(decision.signals).toContain("author-lookup-unresolved");
  });

  test("fails closed without any lookup when the task carries no resolvable reference", () => {
    let called = false;
    const deps: PrReviewRoutingDeps = {
      lookupPrAuthor: () => {
        called = true;
        return "unexpected";
      },
    };

    const decision = prReviewRoutingDecision(
      {
        title: "Review and merge the pull request",
        description: "Please approve and merge this pull request when ready.",
        tags: ["auto:route", "pr-merge-queue"],
        metadata: {},
      },
      {},
      REVIEWER_POOL_OPTS,
      deps,
    );

    // No repo+number reference -> no lookup attempted -> genuine fail-closed.
    expect(called).toBe(false);
    expect(decision.required).toBe(true);
    expect(decision.allowed).toBe(false);
    expect(decision.author).toBeUndefined();
    expect(decision.reason).toContain("requires PR author evidence");
  });

  test("ignores the derived author when the required signal is absent (no over-triggering)", () => {
    let called = false;
    const deps: PrReviewRoutingDeps = {
      lookupPrAuthor: () => {
        called = true;
        return "octo-author";
      },
    };

    // A PR reference with no approval/merge/review intent must not become required,
    // and must not incur a lookup.
    const decision = prReviewRoutingDecision(
      {
        title: "Investigate flaky test",
        description: "Context lives at https://github.com/hasna/loops/pull/42 but no action needed.",
        tags: ["auto:route"],
        metadata: {},
      },
      {},
      REVIEWER_POOL_OPTS,
      deps,
    );

    expect(decision.required).toBe(false);
    expect(decision.allowed).toBe(true);
    expect(called).toBe(false);
  });
});
