import { automationRecords, firstRouteField, hasTruthyField, recordFieldValues, routeFieldValues, tagsFromValue, taskEventRecords } from "./fields.js";
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
    for (const field of fields) values.push(...recordFieldValues(record, field));
    values.push(...tagsFromValue(record.tags ?? record.task_tags ?? record.taskTags));
  }
  return values.join("\n");
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

export function prReviewRoutingDecision(
  data: Record<string, unknown>,
  metadata: Record<string, unknown>,
  opts: TodosTaskRouteOptions,
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

  const author = githubLogin(firstRouteField(records, PR_AUTHOR_FIELDS)) ?? authorFromPrText(text);
  const reviewers = githubLogins([
    opts.githubReviewer,
    ...(splitList(opts.githubReviewerPool) ?? []),
    ...PR_REVIEWER_FIELDS.flatMap((field) => routeFieldValues(records, field)),
    ...PR_REVIEWER_POOL_FIELDS.flatMap((field) => routeFieldValues(records, field)),
  ]);
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
