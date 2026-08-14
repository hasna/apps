import { describe, expect, test } from "bun:test";
import {
  prFingerprintFromTask,
  prReferenceFrom,
  prReviewRoutingDecision,
  type PrAuthorResolver,
  type PrReference,
  type PrStateResolver,
} from "./pr-review.js";
import type { TodosTaskRouteOptions } from "./types.js";

function opts(overrides: Partial<TodosTaskRouteOptions> = {}): TodosTaskRouteOptions {
  return overrides as TodosTaskRouteOptions;
}

// Keep author-derivation tests hermetic: never fall back to the real `gh` state
// probe. The freshness gate has its own dedicated tests below.
const noState: PrStateResolver = () => undefined;

const REVIEW_REQUIRED = "reviewDecision=REVIEW_REQUIRED\nmergeStateStatus=BLOCKED";

describe("prReferenceFrom", () => {
  test("parses canonical PR URLs", () => {
    expect(prReferenceFrom("see https://github.com/hasna/example/pull/7 please")).toEqual({
      owner: "hasna",
      repo: "example",
      number: 7,
    });
  });

  test("parses github-pr shorthand handles", () => {
    expect(prReferenceFrom("blocked github-pr:hasna/loops#42 now")).toEqual({
      owner: "hasna",
      repo: "loops",
      number: 42,
    });
  });

  test("returns undefined for prose without a concrete reference", () => {
    expect(prReferenceFrom("this pull request needs review")).toBeUndefined();
  });
});

describe("prReviewRoutingDecision author derivation", () => {
  test("derives the PR author via gh when metadata carries none", () => {
    const seen: PrReference[] = [];
    const resolve: PrAuthorResolver = (ref) => {
      seen.push(ref);
      return "alice-author";
    };
    const data = { description: `Approve https://github.com/hasna/example/pull/7\n${REVIEW_REQUIRED}` };
    const decision = prReviewRoutingDecision(data, {}, opts({ githubReviewer: "reviewer-bob" }), resolve, noState);
    expect(decision.required).toBe(true);
    expect(decision.allowed).toBe(true);
    expect(decision.author).toBe("alice-author");
    expect(decision.selectedReviewer).toBe("reviewer-bob");
    expect(decision.signals).toContain("author-derived-gh");
    expect(seen).toEqual([{ owner: "hasna", repo: "example", number: 7 }]);
  });

  test("passes the parsed owner/repo/number from github-pr shorthand to the resolver", () => {
    let received: PrReference | undefined;
    const resolve: PrAuthorResolver = (ref) => {
      received = ref;
      return "carol";
    };
    const data = { description: `github-pr:hasna/example#42 ${REVIEW_REQUIRED}` };
    const decision = prReviewRoutingDecision(data, {}, opts({ githubReviewer: "dave" }), resolve, noState);
    expect(decision.allowed).toBe(true);
    expect(decision.author).toBe("carol");
    expect(received).toEqual({ owner: "hasna", repo: "example", number: 42 });
  });

  test("keeps self-review protection when the derived author is the only reviewer", () => {
    const resolve: PrAuthorResolver = () => "alice-author";
    const data = { description: `https://github.com/hasna/example/pull/7\n${REVIEW_REQUIRED}` };
    const decision = prReviewRoutingDecision(data, {}, opts({ githubReviewer: "alice-author" }), resolve, noState);
    expect(decision.required).toBe(true);
    expect(decision.allowed).toBe(false);
    expect(decision.author).toBe("alice-author");
    expect(decision.reason).toContain("self-review");
    // A reviewer-selection skip is NOT a freshness skip: the drain must not close
    // the task (the PR is still open and actionable once a reviewer is supplied).
    expect(decision.freshnessSkip).toBeFalsy();
  });

  test("fails closed when the reference cannot be resolved to an author", () => {
    const resolve: PrAuthorResolver = () => undefined;
    const data = { description: `https://github.com/hasna/example/pull/7\n${REVIEW_REQUIRED}` };
    const decision = prReviewRoutingDecision(data, {}, opts({ githubReviewer: "reviewer-bob" }), resolve, noState);
    expect(decision.required).toBe(true);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("requires PR author evidence");
    expect(decision.signals).not.toContain("author-derived-gh");
  });

  test("does not invoke the resolver when no concrete PR reference exists", () => {
    let called = false;
    const resolve: PrAuthorResolver = () => {
      called = true;
      return "nobody";
    };
    const data = { description: `this pull request is blocked\n${REVIEW_REQUIRED}` };
    const decision = prReviewRoutingDecision(data, {}, opts({ githubReviewer: "reviewer-bob" }), resolve, noState);
    expect(decision.required).toBe(true);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("requires PR author evidence");
    expect(called).toBe(false);
  });

  test("prefers explicit author metadata over gh derivation", () => {
    let called = false;
    const resolve: PrAuthorResolver = () => {
      called = true;
      return "derived-should-not-win";
    };
    const data = {
      github_author: "explicit-author",
      description: `https://github.com/hasna/example/pull/7\n${REVIEW_REQUIRED}`,
    };
    const decision = prReviewRoutingDecision(data, {}, opts({ githubReviewer: "reviewer-bob" }), resolve, noState);
    expect(decision.allowed).toBe(true);
    expect(decision.author).toBe("explicit-author");
    expect(decision.selectedReviewer).toBe("reviewer-bob");
    expect(called).toBe(false);
  });

  // Bot-authored PRs (dependabot etc.) must derive a valid author instead of
  // hard-failing on the `app/x` / `x[bot]` login format.
  test("normalizes an app/<slug> bot author into <slug>[bot]", () => {
    const resolve: PrAuthorResolver = () => "app/dependabot";
    const data = { description: `https://github.com/hasna/example/pull/7\n${REVIEW_REQUIRED}` };
    const decision = prReviewRoutingDecision(data, {}, opts({ githubReviewer: "reviewer-bob" }), resolve, noState);
    expect(decision.author).toBe("dependabot[bot]");
    expect(decision.allowed).toBe(true);
    expect(decision.selectedReviewer).toBe("reviewer-bob");
  });

  test("accepts an explicit <slug>[bot] author from metadata", () => {
    const data = {
      github_author: "dependabot[bot]",
      description: `https://github.com/hasna/example/pull/7\n${REVIEW_REQUIRED}`,
    };
    const decision = prReviewRoutingDecision(data, {}, opts({ githubReviewer: "reviewer-bob" }), () => undefined, noState);
    expect(decision.author).toBe("dependabot[bot]");
    expect(decision.allowed).toBe(true);
  });
});

describe("prReviewRoutingDecision freshness gate", () => {
  const MERGE_INTENT = "please merge https://github.com/hasna/example/pull/7";

  test("skips a merge/review route when metadata reports the PR already merged", () => {
    const data = { pr_state: "MERGED", description: `${MERGE_INTENT}\n${REVIEW_REQUIRED}` };
    const decision = prReviewRoutingDecision(data, {}, opts({ githubReviewer: "reviewer-bob" }), () => "alice", noState);
    expect(decision.required).toBe(true);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("already merged");
    expect(decision.signals).toContain("pr-not-open");
    // The drain keys its task-closing on these markers, so pin them.
    expect(decision.freshnessSkip).toBe(true);
    expect(decision.prState).toBe("MERGED");
  });

  test("skips when the live gh state resolver reports CLOSED (no baked-in state)", () => {
    const state: PrStateResolver = () => ({ state: "CLOSED" });
    const data = { description: `${MERGE_INTENT}\n${REVIEW_REQUIRED}` };
    const decision = prReviewRoutingDecision(data, {}, opts({ githubReviewer: "reviewer-bob" }), () => "alice", state);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("already closed");
  });

  test("routes normally when the PR is still open", () => {
    const data = { pr_state: "OPEN", description: `${MERGE_INTENT}\n${REVIEW_REQUIRED}` };
    const state: PrStateResolver = () => {
      throw new Error("state resolver should not be called when pr_state is baked in");
    };
    const decision = prReviewRoutingDecision(data, {}, opts({ githubReviewer: "reviewer-bob" }), () => "alice", state);
    expect(decision.allowed).toBe(true);
    expect(decision.author).toBe("alice");
    expect(decision.selectedReviewer).toBe("reviewer-bob");
  });

  test("does not probe gh state when a concrete PR reference is absent", () => {
    let probed = false;
    const state: PrStateResolver = () => {
      probed = true;
      return { state: "MERGED" };
    };
    const data = { description: `this pull request needs review\n${REVIEW_REQUIRED}` };
    prReviewRoutingDecision(data, {}, opts({ githubReviewer: "reviewer-bob" }), () => "alice", state);
    expect(probed).toBe(false);
  });
});

describe("prFingerprintFromTask", () => {
  test("derives owner/repo#number from a canonical PR URL in the description", () => {
    expect(prFingerprintFromTask({ description: "tracking https://github.com/hasna/example/pull/7" }, {})).toBe(
      "hasna/example#7",
    );
  });

  test("derives from a github-pr shorthand handle", () => {
    expect(prFingerprintFromTask({ body: "blocked github-pr:hasna/loops#42" }, {})).toBe("hasna/loops#42");
  });

  test("prefers an explicit PR fingerprint field over free text", () => {
    const fp = prFingerprintFromTask(
      { github_pr: "hasna/loops#99", description: "mentions https://github.com/other/repo/pull/1" },
      {},
    );
    expect(fp).toBe("hasna/loops#99");
  });

  test("lowercases owner/repo so checkouts with different casing collapse", () => {
    expect(prFingerprintFromTask({ description: "https://github.com/Hasna/Example/pull/7" }, {})).toBe(
      "hasna/example#7",
    );
  });

  test("returns undefined for tasks with no concrete PR reference", () => {
    expect(prFingerprintFromTask({ description: "fix the flaky retry helper" }, {})).toBeUndefined();
    expect(prFingerprintFromTask({ description: "this pull request needs review" }, {})).toBeUndefined();
  });
});
