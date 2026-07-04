import { spawnSync } from "node:child_process";
import { automationRecords, canonicalRouteField, firstRouteField, hasTruthyField, routeFieldValues, tagsFromValue, taskEventRecords } from "./fields.js";
import { splitList } from "./parse.js";
import type { TodosTaskRouteOptions } from "./types.js";

/** Non-author reviewer gating for PR approval/merge routes. */

const PR_AUTHOR_FIELDS = [
  "github_author",
  "githubAuthor",
  "github_pr_author",
  "githubPrAuthor",
  "pr_author",
  "prAuthor",
  "pull_request_author",
  "pullRequestAuthor",
  "author_login",
  "authorLogin",
];

const PR_REVIEWER_FIELDS = [
  "github_reviewer",
  "githubReviewer",
  "github_review_actor",
  "githubReviewActor",
  "github_review_login",
  "githubReviewLogin",
  "github_actor",
  "githubActor",
  "reviewer_login",
  "reviewerLogin",
  "review_actor",
  "reviewActor",
  "merge_actor",
  "mergeActor",
];

const PR_REVIEWER_POOL_FIELDS = [
  "github_reviewer_pool",
  "githubReviewerPool",
  "github_review_pool",
  "githubReviewPool",
  "github_reviewers",
  "githubReviewers",
  "reviewer_pool",
  "reviewerPool",
  "reviewers",
];

const PR_REVIEW_REQUIRED_FIELDS = [
  "github_review_required",
  "githubReviewRequired",
  "pr_review_required",
  "prReviewRequired",
  "review_required",
  "reviewRequired",
  "requires_non_author_review",
  "requiresNonAuthorReview",
  "branch_protection_review_required",
  "branchProtectionReviewRequired",
];

export interface PrReviewRoutingDecision {
  required: boolean;
  allowed: boolean;
  reason?: string;
  author?: string;
  reviewers: string[];
  selectedReviewer?: string;
  signals: string[];
}

function githubLogin(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const login = value.trim().replace(/^@/, "");
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login) ? login : undefined;
}

function githubLogins(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const logins: string[] = [];
  for (const value of values) {
    const login = githubLogin(value);
    if (!login) continue;
    const key = login.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    logins.push(login);
  }
  return logins;
}

function routeEvidenceText(records: Record<string, unknown>[]): string {
  const fields = [
    "title",
    "task_title",
    "taskTitle",
    "description",
    "body",
    "reason",
    "message",
    "fingerprint",
    "reviewDecision",
    "review_decision",
    "mergeStateStatus",
    "merge_state_status",
  ];
  const values: string[] = [];
  for (const record of records) {
    for (const field of fields) values.push(...routeTextFieldValues(record, field));
    values.push(...tagsFromValue(record.tags ?? record.task_tags ?? record.taskTags));
  }
  return values.join("\n");
}

function textValuesFromUnknown(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((entry) => textValuesFromUnknown(entry));
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  return [];
}

function routeTextFieldValues(record: Record<string, unknown>, field: string): string[] {
  const expected = canonicalRouteField(field);
  const values: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (canonicalRouteField(key) === expected) values.push(...textValuesFromUnknown(value));
  }
  return values;
}

/** A GitHub PR reference resolvable to `owner/repo#number`. */
export interface PrReference {
  owner: string;
  repo: string;
  number: number;
}

/** Resolves a PR author login from a concrete `owner/repo#number` reference. */
export type PrAuthorResolver = (ref: PrReference) => string | undefined;

/** Extracts a concrete owner/repo/number PR reference from route evidence text. */
export function prReferenceFrom(text: string): PrReference | undefined {
  // Canonical PR URL: https://github.com/<owner>/<repo>/pull/<n>
  const url = /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)/i.exec(text);
  if (url) return { owner: url[1], repo: url[2], number: Number(url[3]) };
  // Shorthand handle: github-pr:<owner>/<repo>#<n>
  const short = /github-pr:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)/i.exec(text);
  if (short) return { owner: short[1], repo: short[2], number: Number(short[3]) };
  return undefined;
}

/** Derives the PR author via `gh pr view`; returns undefined when gh is
 * unavailable, unauthenticated, or the PR cannot be resolved (fail closed). */
function ghAuthorResolver(ref: PrReference): string | undefined {
  const result = spawnSync(
    "gh",
    ["pr", "view", String(ref.number), "--repo", `${ref.owner}/${ref.repo}`, "--json", "author", "-q", ".author.login"],
    { encoding: "utf8", timeout: 20_000 },
  );
  if (result.error || result.status !== 0) return undefined;
  return githubLogin((result.stdout ?? "").trim());
}

function authorFromPrText(text: string): string | undefined {
  const patterns = [
    /\bauthor\s+(?:is\s+also|is|=|:)\s+@?([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/i,
    /\bPR\s*#?\d+\s+author\s+(?:is\s+also|is|=|:)\s+@?([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/i,
    /\bgithub\s+author\s+(?:is\s+also|is|=|:)\s+@?([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const login = githubLogin(match?.[1]);
    if (login) return login;
  }
  return undefined;
}

function reviewersFromPrText(text: string): string[] {
  const reviewers: string[] = [];
  const patterns = [
    /\bgithub\s+reviewer\s+pool\s*(?:is|=|:)\s*([^\r\n]+)/gi,
    /\bgithub\s+reviewers?\s*(?:are|is|=|:)\s*([^\r\n]+)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) reviewers.push(...(splitList(match[1]) ?? []));
  }
  return githubLogins(reviewers);
}

export function prReviewRoutingDecision(
  data: Record<string, unknown>,
  metadata: Record<string, unknown>,
  opts: TodosTaskRouteOptions,
  resolveAuthor: PrAuthorResolver = ghAuthorResolver,
): PrReviewRoutingDecision {
  const records = [...taskEventRecords(data, metadata), ...automationRecords(data, metadata)];
  const text = routeEvidenceText(records);
  const signals: string[] = [];
  const hasPrReference = /github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/i.test(text) ||
    /\bgithub-pr:[^\s]+#\d+/i.test(text) ||
    /\bpull request\b/i.test(text) ||
    /\bpr\s*#?\d+\b/i.test(text);
  const reviewRequiredByField = hasTruthyField(records, PR_REVIEW_REQUIRED_FIELDS);
  const reviewRequiredByText = /reviewdecision\s*[:=]\s*review_required/i.test(text) ||
    /\breview_required\b/i.test(text) ||
    /\breview required\b/i.test(text) ||
    /\brequires?\s+\d+\s+approving review/i.test(text) ||
    /\bbranch protection\b[\s\S]{0,160}\bapproving review/i.test(text);
  const mergeBlockedByText = /mergestatestatus\s*[:=]\s*blocked/i.test(text) ||
    /\bmerge state status\b[\s:=]+blocked/i.test(text);
  const approvalIntent = /\b(approve|approval|merge|review)\b/i.test(text);
  if (reviewRequiredByField) signals.push("review-required-field");
  if (reviewRequiredByText) signals.push("review-required-text");
  if (mergeBlockedByText) signals.push("merge-blocked-text");
  if (approvalIntent && hasPrReference) signals.push("pr-approval-intent");

  const required = hasPrReference && (reviewRequiredByField || reviewRequiredByText || mergeBlockedByText || approvalIntent);
  if (!required) return { required: false, allowed: true, reviewers: [], signals };

  const reviewers = githubLogins([
    opts.githubReviewer,
    ...(splitList(opts.githubReviewerPool) ?? []),
    ...PR_REVIEWER_FIELDS.flatMap((field) => routeFieldValues(records, field)),
    ...PR_REVIEWER_POOL_FIELDS.flatMap((field) => routeFieldValues(records, field)),
    ...reviewersFromPrText(text),
  ]);
  let author = githubLogin(firstRouteField(records, PR_AUTHOR_FIELDS)) ?? authorFromPrText(text);
  // When metadata/text carry no author but the task references a concrete
  // owner/repo#number PR, derive the author from GitHub so a resolvable PR is
  // not blocked purely for lack of pre-baked author evidence. Fails closed:
  // an unresolvable reference leaves author undefined and the route is skipped.
  if (!author) {
    const ref = prReferenceFrom(text);
    if (ref) {
      const derived = githubLogin(resolveAuthor(ref));
      if (derived) {
        author = derived;
        signals.push("author-derived-gh");
      }
    }
  }
  const selectedReviewer = author
    ? reviewers.find((reviewer) => reviewer.toLowerCase() !== author.toLowerCase())
    : undefined;
  if (!author) {
    return {
      required: true,
      allowed: false,
      reason: "PR approval/merge route requires PR author evidence before selecting a non-author GitHub reviewer",
      reviewers,
      signals,
    };
  }
  if (!reviewers.length) {
    return {
      required: true,
      allowed: false,
      reason: "PR approval/merge route requires --github-reviewer, --github-reviewer-pool, or task metadata github_reviewer/github_reviewer_pool with a login different from the PR author",
      author,
      reviewers,
      signals,
    };
  }
  if (!selectedReviewer) {
    return {
      required: true,
      allowed: false,
      reason: `PR approval/merge route reviewer candidates match PR author ${author}; self-review is not routable`,
      author,
      reviewers,
      signals,
    };
  }
  return {
    required: true,
    allowed: true,
    author,
    reviewers,
    selectedReviewer,
    signals,
  };
}
