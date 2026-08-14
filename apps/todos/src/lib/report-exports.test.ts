import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import { createTask } from "../db/tasks.js";
import { createPlan } from "../db/plans.js";
import { createRunRecord } from "./run-records.js";
import {
  REPORT_EXPORT_SCHEMA,
  buildReportExportData,
  formatReportMarkdown,
  formatReportHtml,
  exportReport,
} from "./report-exports.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "todos-report-"));
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  rmSync(tempDir, { recursive: true, force: true });
});

describe("report exports", () => {
  it("builds deterministic project markdown report", () => {
    const project = createProject({ name: "demo", path: "/tmp/demo" });
    createTask({ title: "Task A", project_id: project.id, status: "pending" });

    const data = buildReportExportData({
      kind: "project",
      project_id: project.id,
      exported_at: "2026-01-01T00:00:00.000Z",
    });

    expect(data.schema_version).toBe(REPORT_EXPORT_SCHEMA);
    expect(data.read_only).toBe(true);
    expect(data.sections.some((s) => s.id === "status")).toBe(true);

    const md = formatReportMarkdown(data);
    expect(md).toContain("# Project: demo");
    expect(md).toContain("2026-01-01T00:00:00.000Z");
    expect(md).toContain("Task A");
  });

  it("exports self-contained html file", () => {
    const project = createProject({ name: "html-demo", path: "/tmp/html" });
    const data = buildReportExportData({
      kind: "project",
      project_id: project.id,
      exported_at: "2026-01-01T00:00:00.000Z",
    });
    const html = formatReportHtml(data);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Read-only");
    expect(html).toContain("html-demo");
  });

  it("exports run and plan reports", () => {
    const plan = createPlan({ name: "Sprint 1" });
    const run = createRunRecord({ objective: "Ship feature", plan_id: plan.id });

    const runData = buildReportExportData({ kind: "run", run_record_id: run.id, exported_at: "2026-01-01T00:00:00.000Z" });
    expect(runData.title).toContain("Ship feature");

    const planData = buildReportExportData({ kind: "plan", plan_id: plan.id, exported_at: "2026-01-01T00:00:00.000Z" });
    expect(planData.title).toContain("Sprint 1");
  });

  it("writes report to disk", () => {
    const project = createProject({ name: "write", path: "/tmp/write" });
    const out = join(tempDir, "report.md");
    exportReport({
      kind: "project",
      project_id: project.id,
      format: "markdown",
      path: out,
      exported_at: "2026-01-01T00:00:00.000Z",
    });
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out, "utf8")).toContain("Project: write");
  });
});
