import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import { createTask } from "../db/tasks.js";
import {
  ISSUE_IMPORT_SCHEMA,
  detectIssueExportSource,
  parseIssueExport,
  previewIssueImport,
  importIssues,
  formatIssueImportPreviewText,
} from "./issue-importers.js";

let db: Database;
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "todos-issue-import-"));
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  rmSync(tempDir, { recursive: true, force: true });
});

const githubExport = [
  {
    number: 42,
    title: "Fix login redirect",
    body: "Users are sent to /login twice",
    state: "OPEN",
    labels: [{ name: "bug" }, { name: "priority:high" }],
    url: "https://github.com/acme/app/issues/42",
  },
  {
    number: 43,
    title: "Add dark mode",
    body: "Theme toggle for dashboard",
    state: "OPEN",
    labels: [{ name: "enhancement" }],
    url: "https://github.com/acme/app/issues/43",
  },
];

const linearExport = {
  issues: [
    {
      identifier: "ENG-101",
      title: "Refactor auth middleware",
      description: "Split session and token paths",
      priority: 2,
      url: "https://linear.app/acme/issue/ENG-101",
      state: { name: "Todo" },
      labels: [{ name: "backend" }],
    },
  ],
};

const jiraExport = {
  issues: [
    {
      key: "APP-7",
      fields: {
        summary: "Crash on startup",
        description: "Null pointer in bootstrap",
        status: { name: "To Do" },
        priority: { name: "High" },
        labels: ["regression"],
      },
    },
  ],
};

describe("detectIssueExportSource", () => {
  it("detects github, linear, and jira exports", () => {
    expect(detectIssueExportSource(githubExport)).toBe("github");
    expect(detectIssueExportSource(linearExport)).toBe("linear");
    expect(detectIssueExportSource(jiraExport)).toBe("jira");
  });
});

describe("parseIssueExport", () => {
  it("normalizes github issues with refs and priorities", () => {
    const issues = parseIssueExport(githubExport, "github");
    expect(issues).toHaveLength(2);
    expect(issues[0]?.external_ref).toBe("github:acme/app#42");
    expect(issues[0]?.title).toBe("[GH#42] Fix login redirect");
    expect(issues[0]?.priority).toBe("high");
    expect(issues[0]?.tags).toContain("github-import");
  });

  it("normalizes linear issues", () => {
    const issues = parseIssueExport(linearExport, "linear");
    expect(issues[0]?.external_ref).toBe("linear:ENG-101");
    expect(issues[0]?.priority).toBe("high");
    expect(issues[0]?.title).toContain("Refactor auth middleware");
  });

  it("normalizes jira issues", () => {
    const issues = parseIssueExport(jiraExport, "jira");
    expect(issues[0]?.external_ref).toBe("jira:APP-7");
    expect(issues[0]?.priority).toBe("high");
    expect(issues[0]?.title).toBe("[APP-7] Crash on startup");
  });
});

describe("previewIssueImport", () => {
  it("builds preview from file path", () => {
    const file = join(tempDir, "github.json");
    writeFileSync(file, JSON.stringify(githubExport));
    const project = createProject({ name: "Import", path: "/tmp/import" }, db);

    const preview = previewIssueImport({ file_path: file, project_id: project.id }, db);
    expect(preview.schema_version).toBe(ISSUE_IMPORT_SCHEMA);
    expect(preview.source).toBe("github");
    expect(preview.issue_count).toBe(2);
    expect(preview.new_count).toBe(2);
    expect(formatIssueImportPreviewText(preview)).toContain("github:acme/app#42");
  });

  it("flags duplicates by external_ref", () => {
    const project = createProject({ name: "Dedupe", path: "/tmp/dedupe" }, db);
    createTask(
      {
        title: "[GH#42] Fix login redirect",
        project_id: project.id,
        metadata: { external_ref: "github:acme/app#42" },
      },
      db,
    );

    const preview = previewIssueImport({ json: JSON.stringify(githubExport), project_id: project.id }, db);
    expect(preview.duplicate_count).toBe(1);
    expect(preview.new_count).toBe(1);
    expect(preview.issues[0]?.duplicate_of).not.toBeNull();
    expect(preview.issues[1]?.duplicate_of).toBeNull();
  });
});

describe("importIssues", () => {
  it("dry-run does not create tasks", () => {
    const result = importIssues({ json: JSON.stringify(githubExport) }, { dry_run: true }, db);
    expect(result.dry_run).toBe(true);
    expect(result.created).toHaveLength(0);
  });

  it("creates tasks and skips duplicates on re-import", () => {
    const project = createProject({ name: "Batch", path: "/tmp/batch" }, db);
    const first = importIssues({ json: JSON.stringify(githubExport), project_id: project.id }, {}, db);
    expect(first.created).toHaveLength(2);
    expect(first.skipped_duplicates).toHaveLength(0);

    const second = importIssues({ json: JSON.stringify(githubExport), project_id: project.id }, {}, db);
    expect(second.created).toHaveLength(0);
    expect(second.skipped_duplicates).toHaveLength(2);
  });

  it("force creates duplicates when requested", () => {
    const project = createProject({ name: "Force", path: "/tmp/force" }, db);
    importIssues({ json: JSON.stringify(linearExport), project_id: project.id }, {}, db);
    const forced = importIssues({ json: JSON.stringify(linearExport), project_id: project.id }, { force: true }, db);
    expect(forced.created).toHaveLength(1);
  });
});
