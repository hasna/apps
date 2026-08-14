import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import { listTasks, updateTask } from "../db/tasks.js";
import {
  TESTERS_ISSUE_REPORT_SCHEMA_VERSION,
  fingerprintTesterIssueReport,
  normalizeTesterIssueReport,
  upsertTesterIssueReport,
  upsertTesterIssueReports,
} from "./tester-issue-reports.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

function issue(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: TESTERS_ISSUE_REPORT_SCHEMA_VERSION,
    title: "Checkout button stays disabled",
    kind: "assertion_failure",
    severity: "high",
    source: {
      tool: "testers",
      run_id: "run-1",
      result_id: "result-1",
      scenario_id: "scenario-checkout",
      scenario_name: "Checkout happy path",
      url: "https://preview.example.com/checkout?run=1",
    },
    failure: {
      message: "Expected checkout button to become enabled",
      steps: ["Open checkout", "Fill required fields"],
    },
    labels: ["checkout"],
    ...overrides,
  };
}

describe("tester issue reports", () => {
  test("normalizes testers.issue_report.v1 and derives a stable fingerprint", () => {
    const normalized = normalizeTesterIssueReport(issue({ fingerprint: undefined }));
    const again = normalizeTesterIssueReport(issue({
      fingerprint: undefined,
      source: {
        tool: "testers",
        run_id: "run-2",
        result_id: "result-2",
        scenario_id: "scenario-checkout",
        scenario_name: "Checkout happy path",
        url: "https://preview.example.com/checkout?run=2",
      },
    }));

    expect(normalized.schema_version).toBe("testers.issue_report.v1");
    expect(normalized.severity).toBe("high");
    expect(fingerprintTesterIssueReport(normalized)).toBe(fingerprintTesterIssueReport(again));
  });

  test("creates a task from a tester report and updates the same fingerprint on repeat", () => {
    const db = getDatabase();
    const project = createProject({ name: "Tester Reports", path: "/tmp/tester-reports" }, db);

    const first = upsertTesterIssueReport({
      report: issue({ fingerprint: "checkout-disabled" }),
      project_id: project.id,
      apply: true,
    }, db);

    expect(first.action).toBe("created");
    expect(first.task?.title).toContain("Checkout button stays disabled");
    expect(first.task?.priority).toBe("high");
    expect(first.task?.tags).toEqual(expect.arrayContaining(["bug", "testers", "tester-report", "assertion-failure"]));
    expect(first.task?.metadata["tester_issue_fingerprint"]).toBe("testers:checkout-disabled");

    const second = upsertTesterIssueReport({
      report: issue({
        fingerprint: "checkout-disabled",
        failure: { message: "Expected checkout button to become enabled after card entry" },
      }),
      project_id: project.id,
      apply: true,
    }, db);

    expect(second.action).toBe("updated");
    expect(second.task?.id).toBe(first.task?.id);
    expect((second.task?.metadata["tester_issue_report"] as Record<string, unknown>)["occurrence_count"]).toBe(2);
    expect(second.task?.description).toContain("after card entry");
  });

  test("scopes matching by project when the same tester fingerprint appears in separate projects", () => {
    const db = getDatabase();
    const firstProject = createProject({ name: "Project A", path: "/tmp/project-a" }, db);
    const secondProject = createProject({ name: "Project B", path: "/tmp/project-b" }, db);

    const first = upsertTesterIssueReport({
      report: issue({ fingerprint: "shared-fingerprint" }),
      project_id: firstProject.id,
      apply: true,
    }, db);
    const second = upsertTesterIssueReport({
      report: issue({ fingerprint: "shared-fingerprint" }),
      project_id: secondProject.id,
      apply: true,
    }, db);
    const repeatedSecond = upsertTesterIssueReport({
      report: issue({ fingerprint: "shared-fingerprint", failure: { message: "Still failing in B" } }),
      project_id: secondProject.id,
      apply: true,
    }, db);

    expect(first.action).toBe("created");
    expect(second.action).toBe("created");
    expect(first.task?.id).not.toBe(second.task?.id);
    expect(repeatedSecond.action).toBe("updated");
    expect(repeatedSecond.task?.id).toBe(second.task?.id);
    expect(listTasks({ include_archived: true }, db).filter((task) => task.metadata["tester_issue_fingerprint"] === "testers:shared-fingerprint")).toHaveLength(2);
  });

  test("updates assignment on repeated reports when requested", () => {
    const db = getDatabase();
    const first = upsertTesterIssueReport({
      report: issue({ fingerprint: "assign-me" }),
      assigned_to: "tester-a",
      apply: true,
    }, db);
    const second = upsertTesterIssueReport({
      report: issue({ fingerprint: "assign-me" }),
      assigned_to: "tester-b",
      apply: true,
    }, db);

    expect(first.task?.assigned_to).toBe("tester-a");
    expect(second.action).toBe("updated");
    expect(second.task?.assigned_to).toBe("tester-b");
  });

  test("reopens completed matches as regressions", () => {
    const db = getDatabase();
    const first = upsertTesterIssueReport({
      report: issue({ fingerprint: "checkout-regression" }),
      apply: true,
    }, db);
    const completed = updateTask(first.task!.id, { version: first.task!.version, status: "completed" }, db);

    const regressed = upsertTesterIssueReport({
      report: issue({ fingerprint: "checkout-regression" }),
      apply: true,
    }, db);

    expect(completed.status).toBe("completed");
    expect(regressed.action).toBe("regressed");
    expect(regressed.task?.status).toBe("pending");
    expect(regressed.task?.completed_at).toBeNull();
  });

  test("batches report payloads for CLI and SDK callers", () => {
    const db = getDatabase();
    const result = upsertTesterIssueReports({
      reports: [issue({ fingerprint: "one" }), issue({ fingerprint: "two", severity: "critical" })],
      apply: true,
    }, db);

    expect(result.schema_version).toBe("todos.tester_issue_report_batch_result.v1");
    expect(result.summary).toMatchObject({ total: 2, created: 2 });
    expect(result.results.map((item) => item.task?.priority)).toEqual(["high", "critical"]);
  });

  test("rolls back applied batches when one report is invalid", () => {
    const db = getDatabase();

    expect(() => upsertTesterIssueReports({
      reports: [issue({ fingerprint: "will-roll-back" }), { schema_version: "wrong", title: "Invalid" }],
      apply: true,
    }, db)).toThrow("Expected schema_version testers.issue_report.v1");

    expect(listTasks({ include_archived: true }, db).filter((task) => task.metadata["tester_issue_fingerprint"] === "testers:will-roll-back")).toHaveLength(0);
  });
});
