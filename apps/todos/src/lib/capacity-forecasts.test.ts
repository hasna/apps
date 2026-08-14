import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createPlan } from "../db/plans.js";
import { createProject } from "../db/projects.js";
import { createTask, logTime, updateTask } from "../db/tasks.js";
import { resetConfig } from "./config.js";
import {
  getPlanningForecast,
  listCapacityProfiles,
  removeCapacityProfile,
  renderPlanningForecastMarkdown,
  upsertCapacityProfile,
} from "./capacity-forecasts.js";

let previousDbPath: string | undefined;
let previousHome: string | undefined;
let home: string;

beforeEach(() => {
  previousDbPath = process.env["TODOS_DB_PATH"];
  previousHome = process.env["HOME"];
  home = mkdtempSync(join(tmpdir(), "todos-capacity-"));
  process.env["HOME"] = home;
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetConfig();
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  resetConfig();
  if (previousDbPath === undefined) delete process.env["TODOS_DB_PATH"];
  else process.env["TODOS_DB_PATH"] = previousDbPath;
  if (previousHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = previousHome;
  rmSync(home, { recursive: true, force: true });
});

describe("local capacity forecasts", () => {
  test("stores capacity profiles and forecasts plan completion risks", () => {
    const db = getDatabase();
    const project = createProject({ name: "Capacity Project", path: "/tmp/capacity-project" }, db);
    const plan = createPlan({ name: "Capacity Plan", project_id: project.id }, db);
    const first = createTask({
      title: "Estimated task",
      project_id: project.id,
      plan_id: plan.id,
      assigned_to: "codex",
      estimated_minutes: 120,
      due_at: "2026-01-02T00:00:00.000Z",
    }, db);
    const second = createTask({
      title: "Missing estimate",
      project_id: project.id,
      plan_id: plan.id,
      assigned_to: "codex",
    }, db);
    logTime({ task_id: first.id, agent_id: "codex", minutes: 30 }, db);

    const profile = upsertCapacityProfile({
      agent_id: "codex",
      project_id: project.id,
      minutes_per_day: 60,
      working_days: [1, 2, 3, 4, 5],
      effective_from: "2026-01-01",
    });
    expect(profile.minutes_per_day).toBe(60);
    expect(listCapacityProfiles({ agent_id: "codex" })).toHaveLength(1);

    const forecast = getPlanningForecast({
      project_id: project.id,
      plan_id: plan.id,
      agent_id: "codex",
      start_date: "2026-01-01",
    }, db);
    expect(forecast.capacity_minutes_per_day).toBe(60);
    expect(forecast.remaining_estimated_minutes).toBe(90);
    expect(forecast.forecast_work_days).toBe(2);
    expect(forecast.forecast_completion_date).toBe("2026-01-02");
    expect(forecast.missing_estimate_count).toBe(1);
    expect(forecast.risk_flags).toContain("missing_estimates");
    expect(renderPlanningForecastMarkdown(forecast)).toContain("Missing estimate");

    updateTask(second.id, { version: second.version, estimated_minutes: 30, status: "completed", actual_minutes: 45 }, db);
    const updated = getPlanningForecast({ project_id: project.id, plan_id: plan.id, agent_id: "codex", start_date: "2026-01-01" }, db);
    expect(updated.missing_estimate_count).toBe(0);
  });

  test("keeps the forecast date on the start date when no estimate remains", () => {
    const db = getDatabase();
    const project = createProject({ name: "Complete Project", path: "/tmp/complete-project" }, db);
    createTask({
      title: "Already complete",
      project_id: project.id,
      assigned_to: "codex",
      estimated_minutes: 45,
      actual_minutes: 45,
      status: "completed",
    }, db);
    upsertCapacityProfile({ agent_id: "codex", project_id: project.id, minutes_per_day: 60 });

    const forecast = getPlanningForecast({
      project_id: project.id,
      agent_id: "codex",
      start_date: "2026-01-01",
    }, db);

    expect(forecast.remaining_estimated_minutes).toBe(0);
    expect(forecast.forecast_work_days).toBe(0);
    expect(forecast.forecast_completion_date).toBe("2026-01-01");
  });

  test("reports no-capacity risk and removes profiles", () => {
    const db = getDatabase();
    const task = createTask({ title: "No capacity", assigned_to: "codex", estimated_minutes: 45 }, db);
    const forecast = getPlanningForecast({ agent_id: "codex", start_date: "2026-01-01" }, db);
    expect(forecast.tasks[0]?.task_id).toBe(task.id);
    expect(forecast.risk_flags).toContain("no_capacity");

    upsertCapacityProfile({ agent_id: "codex", minutes_per_day: 120 });
    expect(removeCapacityProfile("codex", null)).toBe(true);
    expect(listCapacityProfiles()).toHaveLength(0);
  });
});
