process.env.TESTERS_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach } from "bun:test";
import { resetDatabase } from "./database.js";
import { createSchedule, getSchedule, listSchedules, updateSchedule, deleteSchedule, getEnabledSchedules, updateLastRun } from "./schedules.js";
import { createProject } from "./projects.js";
import { createRun } from "./runs.js";

beforeEach(() => {
  resetDatabase();
});

describe("createSchedule", () => {
  test("creates a schedule with all fields", () => {
    const s = createSchedule({
      name: "Nightly regression",
      cronExpression: "0 2 * * *",
      url: "http://localhost:3000",
      model: "quick",
      parallel: 3,
    });
    expect(s.id).toBeTruthy();
    expect(s.name).toBe("Nightly regression");
    expect(s.cronExpression).toBe("0 2 * * *");
    expect(s.url).toBe("http://localhost:3000");
    expect(s.model).toBe("quick");
    expect(s.parallel).toBe(3);
    expect(s.headed).toBe(false);
    expect(s.enabled).toBe(true);
  });

  test("creates with defaults", () => {
    const s = createSchedule({
      name: "Quick check",
      cronExpression: "*/5 * * * *",
      url: "http://localhost:3000",
    });
    expect(s.parallel).toBe(1);
    expect(s.headed).toBe(false);
    expect(s.enabled).toBe(true);
    expect(s.model).toBeNull();
  });

  test("creates with scenario filter", () => {
    const s = createSchedule({
      name: "Tagged tests",
      cronExpression: "0 * * * *",
      url: "http://localhost:3000",
      scenarioFilter: { tags: ["smoke", "auth"], priority: "critical" },
    });
    expect(s.scenarioFilter.tags).toEqual(["smoke", "auth"]);
    expect(s.scenarioFilter.priority).toBe("critical");
  });

  test("creates with project", () => {
    const project = createProject({ name: "myapp", path: "/tmp/myapp" });
    const s = createSchedule({
      name: "Project tests",
      cronExpression: "0 9 * * 1-5",
      url: "http://localhost:3000",
      projectId: project.id,
    });
    expect(s.projectId).toBe(project.id);
  });
});

describe("getSchedule", () => {
  test("gets by full id", () => {
    const s = createSchedule({ name: "test", cronExpression: "* * * * *", url: "http://localhost" });
    expect(getSchedule(s.id)).toBeTruthy();
    expect(getSchedule(s.id)!.name).toBe("test");
  });

  test("returns null for not found", () => {
    expect(getSchedule("nonexistent")).toBeNull();
  });
});

describe("listSchedules", () => {
  test("lists all schedules", () => {
    createSchedule({ name: "s1", cronExpression: "* * * * *", url: "http://a" });
    createSchedule({ name: "s2", cronExpression: "* * * * *", url: "http://b" });
    expect(listSchedules().length).toBe(2);
  });

  test("filters by enabled", () => {
    const s1 = createSchedule({ name: "s1", cronExpression: "* * * * *", url: "http://a" });
    createSchedule({ name: "s2", cronExpression: "* * * * *", url: "http://b" });
    updateSchedule(s1.id, { enabled: false });
    expect(listSchedules({ enabled: true }).length).toBe(1);
    expect(listSchedules({ enabled: false }).length).toBe(1);
  });

  test("limits results", () => {
    createSchedule({ name: "s1", cronExpression: "* * * * *", url: "http://a" });
    createSchedule({ name: "s2", cronExpression: "* * * * *", url: "http://b" });
    createSchedule({ name: "s3", cronExpression: "* * * * *", url: "http://c" });
    expect(listSchedules({ limit: 2 }).length).toBe(2);
  });
});

describe("updateSchedule", () => {
  test("updates fields", () => {
    const s = createSchedule({ name: "old", cronExpression: "* * * * *", url: "http://a" });
    const updated = updateSchedule(s.id, { name: "new", cronExpression: "0 * * * *" });
    expect(updated.name).toBe("new");
    expect(updated.cronExpression).toBe("0 * * * *");
  });

  test("enables and disables", () => {
    const s = createSchedule({ name: "test", cronExpression: "* * * * *", url: "http://a" });
    const disabled = updateSchedule(s.id, { enabled: false });
    expect(disabled.enabled).toBe(false);
    const enabled = updateSchedule(s.id, { enabled: true });
    expect(enabled.enabled).toBe(true);
  });
});

describe("deleteSchedule", () => {
  test("deletes existing", () => {
    const s = createSchedule({ name: "test", cronExpression: "* * * * *", url: "http://a" });
    expect(deleteSchedule(s.id)).toBe(true);
    expect(getSchedule(s.id)).toBeNull();
  });

  test("returns false for not found", () => {
    expect(deleteSchedule("nonexistent")).toBe(false);
  });
});

describe("getEnabledSchedules", () => {
  test("returns only enabled", () => {
    const s1 = createSchedule({ name: "s1", cronExpression: "* * * * *", url: "http://a" });
    createSchedule({ name: "s2", cronExpression: "* * * * *", url: "http://b" });
    updateSchedule(s1.id, { enabled: false });
    const enabled = getEnabledSchedules();
    expect(enabled.length).toBe(1);
    expect(enabled[0]!.name).toBe("s2");
  });
});

describe("updateLastRun", () => {
  test("updates last run info", () => {
    const s = createSchedule({ name: "test", cronExpression: "* * * * *", url: "http://a" });
    const run = createRun({ url: "http://a", model: "haiku" });
    updateLastRun(s.id, run.id, "2026-03-12T10:00:00.000Z");
    const updated = getSchedule(s.id)!;
    expect(updated.lastRunId).toBe(run.id);
    expect(updated.lastRunAt).toBeTruthy();
    expect(updated.nextRunAt).toBe("2026-03-12T10:00:00.000Z");
  });
});
