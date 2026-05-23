import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask, completeTask } from "../db/tasks.js";
import {
  RELEASE_NOTES_SCHEMA,
  parseConventionalCommit,
  mapCommitTypeToCategory,
  buildReleaseNotes,
  formatReleaseNotesMarkdown,
  updateChangelog,
  getCompletedTasksForRelease,
  CHANGELOG_CATEGORIES,
} from "./release-notes.js";

let tempDir: string;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
  tempDir = mkdtempSync(join(tmpdir(), "release-notes-"));
  writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "test-pkg", version: "1.2.3" }));
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  rmSync(tempDir, { recursive: true, force: true });
});

describe("parseConventionalCommit", () => {
  it("parses scoped feat commits", () => {
    const parsed = parseConventionalCommit("feat(cli): add release-notes command");
    expect(parsed.type).toBe("feat");
    expect(parsed.scope).toBe("cli");
    expect(parsed.description).toBe("add release-notes command");
    expect(parsed.breaking).toBe(false);
  });

  it("detects breaking changes", () => {
    const parsed = parseConventionalCommit("feat!: drop legacy API");
    expect(parsed.breaking).toBe(true);
    expect(mapCommitTypeToCategory(parsed.type, parsed.breaking)).toBe("Changed");
  });

  it("maps fix to Fixed category", () => {
    const parsed = parseConventionalCommit("fix: handle missing tag");
    expect(mapCommitTypeToCategory(parsed.type, parsed.breaking)).toBe("Fixed");
  });
});

describe("getCompletedTasksForRelease", () => {
  it("returns completed tasks with evidence metadata", () => {
    const task = createTask({ title: "Ship feature" });
    completeTask(task.id, undefined, undefined, {
      commit_hash: "abc1234567890",
      notes: "All tests pass",
    });

    const tasks = getCompletedTasksForRelease({});
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe("Ship feature");
    expect(tasks[0]?.commit_hash).toBe("abc1234567890");
    expect(tasks[0]?.notes).toBe("All tests pass");
  });
});

describe("buildReleaseNotes", () => {
  it("builds report from completed tasks when git is unavailable", () => {
    const task = createTask({ title: "OPE-00001: Local changelog" });
    completeTask(task.id, undefined, undefined, { notes: "Done" });

    const report = buildReleaseNotes({
      cwd: tempDir,
      include_commits: false,
      version: "1.2.3",
    });

    expect(report.schema_version).toBe(RELEASE_NOTES_SCHEMA);
    expect(report.version).toBe("1.2.3");
    expect(report.tasks).toHaveLength(1);
    expect(report.sections.Tasks.some((line) => line.includes("Local changelog"))).toBe(true);
  });

  it("includes git commits when run inside a git repository", () => {
    const report = buildReleaseNotes({
      cwd: process.cwd(),
      include_tasks: false,
      since: "HEAD~3",
      version: "9.9.9",
    });

    if (report.commits.length > 0) {
      expect(report.sources.commits).toBeGreaterThan(0);
      const totalSectionItems = CHANGELOG_CATEGORIES.reduce(
        (sum, cat) => sum + report.sections[cat].length,
        0,
      );
      expect(totalSectionItems).toBeGreaterThan(0);
    }
  });
});

describe("formatReleaseNotesMarkdown", () => {
  it("formats Keep a Changelog section", () => {
    const report = buildReleaseNotes({
      cwd: tempDir,
      include_commits: false,
      version: "0.1.0",
    });
    report.sections.Added.push("- Example entry");

    const md = formatReleaseNotesMarkdown(report);
    expect(md).toContain("## [0.1.0]");
    expect(md).toContain("### Added");
    expect(md).toContain("- Example entry");
  });
});

describe("updateChangelog", () => {
  it("prepends a section to CHANGELOG.md", () => {
    const changelogPath = join(tempDir, "CHANGELOG.md");
    writeFileSync(changelogPath, "# Changelog\n\n## [0.1.0] - 2026-01-01\n\n### Added\n- Old entry\n");

    const report = buildReleaseNotes({ cwd: tempDir, include_commits: false, version: "0.2.0" });
    report.sections.Added.push("- New release entry");

    const result = updateChangelog({ path: changelogPath, report });
    expect(result.written).toBe(true);
    expect(existsSync(changelogPath)).toBe(true);

    const content = readFileSync(changelogPath, "utf8");
    expect(content.indexOf("## [0.2.0]")).toBeLessThan(content.indexOf("## [0.1.0]"));
    expect(content).toContain("- New release entry");
  });

  it("supports dry_run without writing", () => {
    const changelogPath = join(tempDir, "CHANGELOG.md");
    writeFileSync(changelogPath, "# Changelog\n");

    const report = buildReleaseNotes({ cwd: tempDir, include_commits: false, version: "0.3.0" });
    const before = readFileSync(changelogPath, "utf8");
    const result = updateChangelog({ path: changelogPath, report, dry_run: true });

    expect(result.written).toBe(false);
    expect(readFileSync(changelogPath, "utf8")).toBe(before);
    expect(result.preview).toContain("## [0.3.0]");
  });
});
