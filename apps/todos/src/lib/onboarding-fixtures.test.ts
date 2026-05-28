import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { listPlans } from "../db/plans.js";
import { listProjects } from "../db/projects.js";
import { listTasks } from "../db/tasks.js";
import {
  getOnboardingFixtureBundle,
  importOnboardingFixture,
  listOnboardingFixtures,
} from "./onboarding-fixtures.js";
import { validateLocalBridgeBundle } from "./local-bridge.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("onboarding fixtures", () => {
  test("ships a deterministic redacted local bridge demo", () => {
    const fixtures = listOnboardingFixtures();

    expect(fixtures).toHaveLength(1);
    expect(fixtures[0]).toMatchObject({
      name: "agent-project-demo",
      local_only: true,
      no_network: true,
      redacted: true,
    });
    expect(fixtures[0]!.workflow).toContain("Run an agent against the plan");
    expect(fixtures[0]!.stats).toMatchObject({
      projects: 1,
      plans: 1,
      tasks: 4,
      task_dependencies: 3,
      runs: 1,
      run_events: 4,
      run_commands: 1,
      run_artifacts: 1,
      task_verifications: 1,
    });

    const bundle = getOnboardingFixtureBundle("agent-project-demo");
    expect(validateLocalBridgeBundle(bundle)).toEqual({ ok: true, issues: [] });
    expect(bundle.exportedAt).toBe("2026-05-22T00:00:00.000Z");
    expect(JSON.stringify(bundle)).not.toMatch(/sk-[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|"(api[_-]?key|secret|token|password)"\s*:/i);
  });

  test("dry-runs and applies the demo fixture through the bridge importer", () => {
    const preview = importOnboardingFixture();

    expect(preview.ok).toBe(true);
    expect(preview.dry_run).toBe(true);
    expect(preview.inserted.projects).toBe(1);
    expect(preview.inserted.tasks).toBe(4);
    expect(listTasks()).toHaveLength(0);

    const applied = importOnboardingFixture({ dryRun: false });
    expect(applied.ok).toBe(true);
    expect(applied.dry_run).toBe(false);
    expect(applied.inserted.projects).toBe(1);
    expect(applied.inserted.tasks).toBe(4);

    expect(listProjects()).toHaveLength(1);
    expect(listPlans()).toHaveLength(1);
    const tasks = listTasks();
    expect(tasks.map((task) => task.title).sort()).toEqual([
      "Add the first todos",
      "Create the project",
      "Review completion evidence",
      "Run the agent on the plan",
    ].sort());
    expect(tasks.filter((task) => task.status === "completed")).toHaveLength(3);
  });
});
