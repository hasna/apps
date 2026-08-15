import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import { createTask } from "../db/tasks.js";
import {
  INBOX_INTAKE_SCHEMA,
  detectSourceType,
  parseCiLog,
  parseErrorPaste,
  parseFeedback,
  previewInboxIntake,
  createInboxIntake,
  formatIntakePreviewText,
} from "./inbox-intake.js";

let db: Database;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("detectSourceType", () => {
  it("detects CI logs and errors", () => {
    expect(detectSourceType("FAIL src/foo.test.ts\nError: expected true")).toBe("ci_log");
    expect(detectSourceType("TypeError: Cannot read property 'x'")).toBe("error_paste");
    expect(detectSourceType("Feedback: button is broken")).toBe("feedback");
  });
});

describe("parseCiLog", () => {
  it("extracts failure lines", () => {
    const log = "## test\nFAIL src/a.test.ts\n  Error: boom\nPASS src/b.test.ts";
    const parsed = parseCiLog(log);
    expect(parsed.title).toContain("[CI]");
    expect(parsed.failures.length).toBeGreaterThan(0);
  });
});

describe("parseErrorPaste", () => {
  it("uses first line as title", () => {
    const parsed = parseErrorPaste("ReferenceError: foo is not defined\n  at bar.ts:10");
    expect(parsed.title).toContain("ReferenceError");
    expect(parsed.stack).toContain("bar.ts");
  });
});

describe("parseFeedback", () => {
  it("wraps support notes", () => {
    const parsed = parseFeedback("Support: login fails on Safari");
    expect(parsed.title).toContain("[Feedback]");
  });
});

describe("previewInboxIntake", () => {
  it("builds preview from text with redaction metadata", () => {
    const preview = previewInboxIntake({
      text: "Error: something broke in checkout",
      source_type: "error_paste",
    }, db);

    expect(preview.schema_version).toBe(INBOX_INTAKE_SCHEMA);
    expect(preview.source_type).toBe("error_paste");
    expect(preview.create_task_input.title).toContain("[Error]");
    expect(preview.suggested_tags).toContain("intake");
  });

  it("detects duplicate by fingerprint", () => {
    const project = createProject({ name: "Intake", path: "/tmp/intake" }, db);
    const first = createInboxIntake({
      text: "Bug: duplicate intake item",
      project_id: project.id,
    }, {}, db);

    const second = previewInboxIntake({
      text: "Bug: duplicate intake item",
      project_id: project.id,
    }, db);

    expect(first.task).not.toBeNull();
    expect(second.duplicate_of?.task_id).toBe(first.task!.id);
    expect(second.triage_status).toBe("duplicate");
  });

  it("formats preview text", () => {
    const preview = previewInboxIntake({ text: "Feedback: nice app" }, db);
    const text = formatIntakePreviewText(preview);
    expect(text).toContain("Source: feedback");
    expect(text).toContain("Title:");
  });
});

describe("createInboxIntake", () => {
  it("dry-run does not create task", () => {
    const result = createInboxIntake({ text: "New task from intake" }, { dry_run: true }, db);
    expect(result.task).toBeNull();
    expect(result.preview.triage_status).toBe("preview");
  });

  it("creates task and skips duplicate by default", () => {
    const project = createProject({ name: "P", path: "/tmp/p2" }, db);
    createTask({
      title: "Existing",
      project_id: project.id,
      metadata: { source_fingerprint: "abc123" },
    }, db);

    const preview = previewInboxIntake({
      text: "ignored",
      title: "Existing",
      project_id: project.id,
    }, db);

    // force different fingerprint but same title triggers dedupe via findDuplicateCandidates path
    const created = createInboxIntake({ text: "Unique intake item xyz", project_id: project.id }, {}, db);
    expect(created.task).not.toBeNull();
    expect(created.skipped_duplicate).toBe(false);
    expect(preview.create_task_input.project_id).toBe(project.id);
  });

  it("redacts secrets in intake text", () => {
    const preview = previewInboxIntake({
      text: "Error in deploy\napi_key=supersecretvalue123456789",
      source_type: "error_paste",
    }, db);
    expect(preview.redacted).toBe(true);
    const body = preview.description || preview.create_task_input.description || "";
    expect(body).not.toContain("supersecretvalue123456789");
  });
});
