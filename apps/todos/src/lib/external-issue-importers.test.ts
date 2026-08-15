import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import { createTask } from "../db/tasks.js";
import { importExternalIssues } from "./external-issue-importers.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("external issue importers", () => {
  test("dry-runs GitHub, Linear, Jira, and URL issue records without network access", () => {
    const result = importExternalIssues({
      json: [
        {
          number: 42,
          title: "Parser regression",
          body: "Stack trace includes token parser failure",
          labels: [{ name: "priority:high" }, { name: "parser" }],
          state: "open",
          html_url: "https://github.com/hasna/todos/issues/42",
        },
        {
          id: "lin-1",
          identifier: "ENG-12",
          title: "Linear work item",
          description: "Imported from an export file",
          url: "https://linear.app/acme/issue/ENG-12/linear-work-item",
          labels: { nodes: [{ name: "ops" }] },
          priorityLabel: "critical",
          state: { name: "Todo" },
        },
        {
          id: "10001",
          key: "OPS-7",
          fields: {
            summary: "Jira work item",
            description: "Jira description",
            labels: ["infra"],
            status: { name: "Backlog" },
            priority: { name: "Low" },
          },
          self: "https://example.atlassian.net/rest/api/3/issue/10001",
        },
      ],
      default_priority: "medium",
    });

    expect(result).toMatchObject({
      schema_version: 1,
      local_only: true,
      network_used: false,
      dry_run: true,
    });
    expect(result.issues.map((issue) => issue.provider)).toEqual(["github", "linear", "jira"]);
    expect(result.issues.map((issue) => issue.priority)).toEqual(["high", "critical", "low"]);
    expect(result.created_tasks).toEqual([]);
  });

  test("applies local tasks, records inbox links, and dedupes repeated source imports", () => {
    const db = getDatabase();
    const project = createProject({ name: "External Issues", path: "/tmp/external-issues" }, db);
    const input = {
      provider: "github" as const,
      text: JSON.stringify({
        number: 42,
        title: "Parser regression",
        body: "Failure in parser",
        labels: ["bug", "priority:high"],
        state: "open",
        html_url: "https://github.com/hasna/todos/issues/42",
      }),
      project_id: project.id,
      apply: true,
    };

    const first = importExternalIssues(input, db);
    expect(first.created_tasks).toHaveLength(1);
    expect(first.inbox_items).toHaveLength(1);
    expect(first.created_tasks[0]!.title).toContain("Parser regression");
    expect(first.created_tasks[0]!.metadata["source_url"]).toBe("https://github.com/hasna/todos/issues/42");
    expect(first.created_tasks[0]!.tags).toEqual(expect.arrayContaining(["external-issue", "github", "bug"]));

    const second = importExternalIssues(input, db);
    expect(second.created_tasks).toHaveLength(0);
    expect(second.existing_matches).toHaveLength(1);
    expect(second.existing_matches[0]!.task.id).toBe(first.created_tasks[0]!.id);
  });

  test("reports duplicate candidates for imported plain URL issues", () => {
    const db = getDatabase();
    createTask({
      title: "Existing outage report",
      description: "Same upstream issue",
      metadata: { source_url: "https://tracker.example/issues/55" },
    }, db);

    const result = importExternalIssues({
      source_url: "https://tracker.example/issues/55",
      text: "Title: Existing outage report\nURL: https://tracker.example/issues/55\nBody: Same upstream issue",
      apply: true,
      dedupe: false,
    }, db);

    expect(result.created_tasks).toHaveLength(1);
    expect(result.duplicate_candidates.length).toBeGreaterThanOrEqual(1);
    expect(result.duplicate_candidates[0]!.reasons.length).toBeGreaterThan(0);
  });
});
