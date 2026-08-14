import { describe, it, expect } from "bun:test";
import { parseGitHubUrl, issueToTask } from "./github.js";
import type { GitHubIssue } from "./github.js";

describe("parseGitHubUrl", () => {
  it("should parse a standard GitHub issue URL", () => {
    const result = parseGitHubUrl("https://github.com/owner/repo/issues/123");
    expect(result).toEqual({ owner: "owner", repo: "repo", number: 123 });
  });

  it("should parse a URL without protocol prefix", () => {
    const result = parseGitHubUrl("github.com/myorg/myrepo/issues/4567");
    expect(result).toEqual({ owner: "myorg", repo: "myrepo", number: 4567 });
  });

  it("should parse a URL with www prefix", () => {
    const result = parseGitHubUrl("https://www.github.com/me/proj/issues/1");
    expect(result).toEqual({ owner: "me", repo: "proj", number: 1 });
  });

  it("should handle hyphens and dots in owner/repo", () => {
    const result = parseGitHubUrl("https://github.com/my-org/my.repo/issues/99");
    expect(result).toEqual({ owner: "my-org", repo: "my.repo", number: 99 });
  });

  it("should return null for non-GitHub URLs", () => {
    expect(parseGitHubUrl("https://gitlab.com/owner/repo/issues/123")).toBeNull();
  });

  it("should return null for PR URLs", () => {
    expect(parseGitHubUrl("https://github.com/owner/repo/pull/123")).toBeNull();
  });

  it("should return null for malformed URLs", () => {
    expect(parseGitHubUrl("not-a-url")).toBeNull();
    expect(parseGitHubUrl("")).toBeNull();
  });

  it("should reject URLs with shell metacharacters in owner/repo", () => {
    expect(parseGitHubUrl("https://github.com/own;er/repo/issues/1")).toBeNull();
    expect(parseGitHubUrl("https://github.com/owner/re`po/issues/1")).toBeNull();
  });

  it("should parse multi-digit issue numbers", () => {
    const result = parseGitHubUrl("https://github.com/a/b/issues/99999");
    expect(result).toEqual({ owner: "a", repo: "b", number: 99999 });
  });
});

describe("issueToTask", () => {
  const baseIssue: GitHubIssue = {
    number: 42,
    title: "Fix login bug",
    body: "Users cannot log in with SSO.",
    labels: ["bug", "high"],
    state: "open",
    assignee: "alice",
    url: "https://github.com/owner/repo/issues/42",
  };

  it("should convert an issue to a task input", () => {
    const result = issueToTask(baseIssue);
    expect(result.title).toBe("[GH#42] Fix login bug");
    expect(result.description).toBe("Users cannot log in with SSO.");
    expect(result.tags).toEqual(["bug", "high"]);
    expect(result.metadata).toEqual({ github_url: baseIssue.url, github_number: 42, github_state: "open" });
  });

  it("should map priority from labels", () => {
    const critical = issueToTask({ ...baseIssue, labels: ["critical"] });
    expect(critical.priority).toBe("critical");

    const urgentHigh = issueToTask({ ...baseIssue, labels: ["urgent"] });
    expect(urgentHigh.priority).toBe("high");

    const low = issueToTask({ ...baseIssue, labels: ["low"] });
    expect(low.priority).toBe("low");
  });

  it("should default to medium priority for unknown labels", () => {
    const result = issueToTask({ ...baseIssue, labels: ["documentation"] });
    expect(result.priority).toBe("medium");
  });

  it("should cap tags at 10", () => {
    const issue = { ...baseIssue, labels: Array.from({ length: 15 }, (_, i) => `label-${i}`) };
    const result = issueToTask(issue);
    expect(result.tags).toHaveLength(10);
  });

  it("should truncate body to 4000 chars", () => {
    const longBody = "x".repeat(5000);
    const result = issueToTask({ ...baseIssue, body: longBody });
    expect(result.description!.length).toBe(4000);
  });

  it("should pass through optional fields", () => {
    const result = issueToTask(baseIssue, { project_id: "proj-1", task_list_id: "list-1", agent_id: "agent-1" });
    expect(result.project_id).toBe("proj-1");
    expect(result.task_list_id).toBe("list-1");
    expect(result.agent_id).toBe("agent-1");
  });

  it("should handle null body", () => {
    const result = issueToTask({ ...baseIssue, body: null });
    expect(result.description).toBeUndefined();
  });
});
