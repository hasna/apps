import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask, addDependency } from "../db/tasks.js";
import { createProject } from "../db/projects.js";
import {
  TUI_DASHBOARD_SCHEMA,
  initialDashboardState,
  reduceDashboardState,
  loadDashboardData,
  clampSelectedIndex,
  executeDashboardTaskAction,
  DASHBOARD_PANELS,
} from "./tui-dashboard.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("tui dashboard state", () => {
  it("initializes dashboard state", () => {
    const state = initialDashboardState({ readOnly: true });
    expect(state.schema_version).toBe(TUI_DASHBOARD_SCHEMA);
    expect(state.readOnly).toBe(true);
    expect(state.panel).toBe("overview");
  });

  it("navigates panels with panel_next", () => {
    let state = initialDashboardState();
    state = reduceDashboardState(state, { type: "panel_next" });
    expect(state.panel).toBe("tasks");
    state = reduceDashboardState(state, { type: "panel_prev" });
    expect(state.panel).toBe("overview");
  });

  it("cycles filters", () => {
    const state = reduceDashboardState(initialDashboardState(), { type: "set_filter", filter: "pending" });
    expect(state.filter).toBe("pending");
  });

  it("loads dashboard data with counts and tasks", () => {
    createTask({ title: "TUI task" });
    const data = loadDashboardData(initialDashboardState());
    expect(data.counts.total).toBeGreaterThan(0);
    expect(data.tasks.some((t) => t.title === "TUI task")).toBe(true);
  });

  it("loads blocked tasks in blockers panel data", () => {
    const project = createProject({ name: "tui", path: "/tmp/tui" });
    const blocker = createTask({ title: "Block", project_id: project.id });
    const blocked = createTask({ title: "Wait", project_id: project.id });
    addDependency(blocked.id, blocker.id);

    const data = loadDashboardData(initialDashboardState({ projectId: project.id }));
    expect(data.blocked.length).toBe(1);
  });

  it("clamps selected index to list bounds", () => {
    createTask({ title: "One" });
    let state = initialDashboardState();
    state = { ...state, selectedIndex: 99 };
    const data = loadDashboardData(state);
    state = clampSelectedIndex(state, data);
    expect(state.selectedIndex).toBe(0);
  });

  it("blocks mutations in read-only mode", () => {
    createTask({ title: "RO" });
    const state = initialDashboardState({ readOnly: true });
    const result = executeDashboardTaskAction(state, "start");
    expect(result.error).toContain("Read-only");
  });

  it("starts task when not read-only", () => {
    createTask({ title: "Start me" });
    const state = clampSelectedIndex(
      { ...initialDashboardState(), panel: "tasks" },
      loadDashboardData(initialDashboardState()),
    );
    const result = executeDashboardTaskAction(state, "start", { agentId: "tui-agent" });
    expect(result.result).toMatch(/^started:/);
  });

  it("covers all dashboard panels", () => {
    expect(DASHBOARD_PANELS).toContain("blockers");
    expect(DASHBOARD_PANELS).toContain("plans");
  });
});
