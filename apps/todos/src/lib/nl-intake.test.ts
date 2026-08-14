import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import {
  NL_INTAKE_SCHEMA,
  parseNaturalLanguageTask,
  previewNlIntake,
  createNlIntake,
  formatNlIntakePreviewText,
} from "./nl-intake.js";

let db: Database;
const FIXED_NOW = new Date("2026-05-23T10:00:00.000Z");

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("parseNaturalLanguageTask", () => {
  it("extracts priority, due date, tags, and title", () => {
    const { parsed, explain } = parseNaturalLanguageTask(
      "Add high priority task to fix login bug due tomorrow #auth tags: backend, urgent",
      { now: FIXED_NOW },
    );

    expect(parsed.title).toBe("Fix login bug");
    expect(parsed.priority).toBe("high");
    expect(parsed.due_at).toBeDefined();
    expect(parsed.tags).toEqual(expect.arrayContaining(["auth", "backend", "urgent"]));
    expect(explain.some((e) => e.field === "priority")).toBe(true);
    expect(explain.some((e) => e.field === "due_at")).toBe(true);
  });

  it("extracts recurrence and assignee", () => {
    const { parsed } = parseNaturalLanguageTask(
      "Remind me to review metrics every week assign to ops-agent",
      { now: FIXED_NOW },
    );

    expect(parsed.title).toBe("Review metrics");
    expect(parsed.recurrence_rule).toBe("every week");
    expect(parsed.assigned_to).toBe("ops-agent");
  });

  it("parses ISO due dates", () => {
    const { parsed } = parseNaturalLanguageTask(
      "Ship release due 2026-06-01",
      { now: FIXED_NOW },
    );
    expect(parsed.due_at).toContain("2026-06-01");
    expect(parsed.title).toBe("Ship release");
  });
});

describe("previewNlIntake", () => {
  it("returns dry-run preview with inbox intake metadata", () => {
    const preview = previewNlIntake({
      text: "Create task: update docs low priority due next week",
    }, db);

    expect(preview.schema_version).toBe(NL_INTAKE_SCHEMA);
    expect(preview.dry_run).toBe(true);
    expect(preview.intake.create_task_input.title).toBe("Update docs");
    expect(preview.intake.create_task_input.priority).toBe("low");
    expect(preview.intake.create_task_input.due_at).toBeDefined();
    expect(preview.intake.create_task_input.metadata?.nl_intake).toBe(true);
    expect(preview.intake.suggested_tags).toContain("nl-intake");
  });

  it("formats preview text with explain section", () => {
    const preview = previewNlIntake({ text: "Fix checkout bug high priority" }, db);
    const text = formatNlIntakePreviewText(preview);
    expect(text).toContain("Dry run: yes");
    expect(text).toContain("Parsed from text");
    expect(text).toContain("Inbox intake preview");
  });
});

describe("createNlIntake", () => {
  it("dry-run does not create a task", () => {
    const result = createNlIntake(
      { text: "Implement NL intake feature" },
      { dry_run: true },
      db,
    );
    expect(result.task).toBeNull();
    expect(result.dry_run).toBe(true);
  });

  it("creates a task with parsed schedule fields", () => {
    const project = createProject({ name: "NL", path: "/tmp/nl-intake" }, db);
    const result = createNlIntake({
      text: "Add task to wire MCP tools critical priority due tomorrow",
      project_id: project.id,
    }, {}, db);

    expect(result.task).not.toBeNull();
    expect(result.task!.priority).toBe("critical");
    expect(result.task!.due_at).toBeDefined();
    expect(result.task!.metadata?.nl_intake).toBe(true);
  });
});
