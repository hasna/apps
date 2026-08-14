import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { listTasks } from "../db/tasks.js";
import { getTaskDependencies } from "../db/task-graph.js";
import { previewNaturalLanguageIntake } from "./natural-language-intake.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("local natural-language intake", () => {
  test("previews task creation deterministically without mutating local tasks", () => {
    const db = getDatabase();
    const preview = previewNaturalLanguageIntake({
      text: [
        "Project: Agent CLI",
        "- [ ] Add task fix parser priority high @codex #cli due tomorrow",
        "- [ ] Write docs p3 #docs",
      ].join("\n"),
      reference_date: "2026-01-02T12:00:00.000Z",
    }, db);

    expect(preview.dry_run).toBe(true);
    expect(preview.detected_project_name).toBe("Agent CLI");
    expect(preview.tasks).toHaveLength(2);
    expect(preview.tasks[0]).toMatchObject({
      title: "fix parser",
      priority: "high",
      assigned_to: "codex",
      tags: ["cli"],
      depends_on: [],
      acceptance_criteria: [],
    });
    expect(preview.tasks[0]!.due_at).toBe("2026-01-03T12:00:00.000Z");
    expect(preview.tasks[1]!.priority).toBe("low");
    expect(listTasks({}, db)).toHaveLength(0);
  });

  test("applies parsed tasks only when explicitly requested", () => {
    const db = getDatabase();
    const applied = previewNaturalLanguageIntake({
      text: "Add task build local intake preview priority critical #intake",
      apply: true,
    }, db);

    expect(applied.dry_run).toBe(false);
    expect(applied.created_tasks).toHaveLength(1);
    expect(applied.created_tasks[0]!.title).toBe("build local intake preview");
    expect(applied.created_tasks[0]!.priority).toBe("critical");
    expect(listTasks({}, db)).toHaveLength(1);
  });

  test("previews and applies projects plans dependencies and acceptance criteria", () => {
    const db = getDatabase();
    const preview = previewNaturalLanguageIntake({
      text: [
        "Project: Agent CLI",
        "Plan: Parser Launch",
        "Task: build parser scaffold priority high #parser",
        "Task: test parser depends on build parser scaffold acceptance: Handles bullets | Keeps secrets redacted",
        "Acceptance criteria: Dry-run does not mutate local state",
      ].join("\n"),
      reference_date: "2026-01-02T12:00:00.000Z",
    }, db);

    expect(preview.dry_run).toBe(true);
    expect(preview.project).toMatchObject({ name: "Agent CLI" });
    expect(preview.plan).toMatchObject({ name: "Parser Launch" });
    expect(preview.dependencies).toEqual([{
      task_title: "test parser",
      depends_on_title: "build parser scaffold",
      resolved: true,
    }]);
    expect(preview.tasks[1]!.acceptance_criteria).toEqual([
      "Handles bullets",
      "Keeps secrets redacted",
      "Dry-run does not mutate local state",
    ]);
    expect(listTasks({}, db)).toHaveLength(0);

    const applied = previewNaturalLanguageIntake({ text: preview.source_text, apply: true }, db);
    expect(applied.created_project).toMatchObject({ name: "Agent CLI" });
    expect(applied.created_plan).toMatchObject({ name: "Parser Launch" });
    expect(applied.created_tasks).toHaveLength(2);
    expect(applied.created_tasks[1]!.metadata.acceptance_criteria).toEqual([
      "Handles bullets",
      "Keeps secrets redacted",
      "Dry-run does not mutate local state",
    ]);
    expect(getTaskDependencies(applied.created_tasks[1]!.id, db)).toEqual([{
      task_id: applied.created_tasks[1]!.id,
      depends_on: applied.created_tasks[0]!.id,
      external_project_id: null,
      external_task_id: null,
    }]);
  });
});
