import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Store } from "./store.js";
import { runDoctor, type DoctorReport } from "./doctor.js";
import { RESTART_INTERRUPTED_RUN_PREFIX } from "./health.js";

function check(report: DoctorReport, id: string) {
  return report.checks.find((entry) => entry.id === id);
}

describe("doctor", () => {
  let dataDir: string;
  let machinesDir: string;
  let home: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "loops-doctor-data-"));
    machinesDir = mkdtempSync(join(tmpdir(), "loops-doctor-machines-"));
    home = mkdtempSync(join(tmpdir(), "loops-doctor-home-"));
    for (const key of [
      "LOOPS_DATA_DIR",
      "HASNA_MACHINES_DIR",
      "HASNA_LOOPS_API_URL",
      "HASNA_LOOPS_API_KEY",
      "HASNA_LOOPS_DATABASE_URL",
    ]) savedEnv[key] = process.env[key];
    process.env.LOOPS_DATA_DIR = dataDir;
    process.env.HASNA_MACHINES_DIR = machinesDir;
    process.env.HASNA_LOOPS_API_URL = "";
    process.env.HASNA_LOOPS_API_KEY = "";
    process.env.HASNA_LOOPS_DATABASE_URL = "";
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    // Isolation guard: doctor runs must never create a home-level .hasna dir.
    expect(existsSync(join(home, ".hasna"))).toBe(false);
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(machinesDir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  test("reports healthy environment checks for an empty store", () => {
    const store = new Store(":memory:");
    try {
      const report = runDoctor(store);
      expect(check(report, "data-dir")?.status).toBe("ok");
      expect(check(report, "data-dir")?.detail).toBe(dataDir);
      expect(check(report, "bun")?.status).toBe("ok");
      // @hasna/machines was deleted (2026-09-03); the doctor check degrades to a
      // warn whose detail names the deletion verdict, never an ok with an
      // empty topology.
      expect(check(report, "machines")?.status).toBe("warn");
      expect(check(report, "machines")?.detail).toContain("@hasna/machines has been deleted");
      expect(check(report, "daemon")?.status).toBe("ok");
      expect(check(report, "daemon")?.message).toBe("daemon is not running");
      expect(check(report, "loop-runs")?.status).toBe("ok");
      expect(check(report, "scheduler-state")).toMatchObject({
        status: "ok",
        message: "scheduler state storage=sqlite connection=file remote_scheduler=none",
      });
      expect(check(report, "scheduler-state")?.detail).toContain("gates=max_dispatch,max_active,max_active_per_project,max_active_per_project_group,max_active_scope,max_per_profile");
      for (const provider of ["claude", "agent", "codewith", "aicopilot", "opencode", "codex"]) {
        expect(["ok", "warn"]).toContain(check(report, `provider:${provider}`)?.status ?? "missing");
      }
      expect(report.ok).toBe(true);
    } finally {
      store.close();
    }
  });

  test("warns when a partial API connection cannot resolve", () => {
    process.env.HASNA_LOOPS_API_URL = "https://loops.example.test";
    delete process.env.HASNA_LOOPS_API_KEY;
    const store = new Store(":memory:");
    try {
      const report = runDoctor(store);
      const scheduler = check(report, "scheduler-state");
      expect(scheduler?.status).toBe("warn");
      expect(scheduler?.message).toContain("HASNA_LOOPS_API_URL is set without HASNA_LOOPS_API_KEY");
      expect(report.ok).toBe(true);
    } finally {
      store.close();
    }
  });

  test("warns on recorded failed runs without failing the report", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "doctor-failed-run",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "command", command: "printf ok", shell: true },
      });
      const claim = store.claimRun(loop, "2026-01-01T00:00:00Z", "test", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      store.finalizeRun(
        claim!.run.id,
        { status: "failed", finishedAt: "2026-01-01T00:00:01.000Z", durationMs: 1_000, stdout: "", stderr: "boom" },
        { claimedBy: "test", claimToken: claim!.claimToken, now: new Date("2026-01-01T00:00:01Z") },
      );
      const report = runDoctor(store);
      expect(check(report, "loop-runs")?.status).toBe("warn");
      expect(check(report, "loop-runs")?.message).toContain("1 failed loop run(s)");
      expect(report.ok).toBe(true);
    } finally {
      store.close();
    }
  });

  test("surfaces restart-interrupted runs separately from failed loop runs", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "doctor-restart-interrupted-run",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "sleep", args: ["10"] },
      });
      store.createSkippedRun(
        loop,
        "2026-01-01T00:00:00.000Z",
        `${RESTART_INTERRUPTED_RUN_PREFIX}: child process terminated by SIGTERM during daemon stop/restart`,
      );

      const report = runDoctor(store);
      expect(check(report, "loop-runs")?.status).toBe("ok");
      expect(check(report, "loop-runs")?.message).toBe("no failed loop runs recorded");
      expect(check(report, "loop-runs:restart-interrupted")?.status).toBe("warn");
      expect(check(report, "loop-runs:restart-interrupted")?.message).toContain("1 daemon restart-interrupted");
      expect(report.ok).toBe(true);
    } finally {
      store.close();
    }
  });

  test("fails preflight checks for active loops whose binaries are missing", () => {
    const store = new Store(":memory:");
    try {
      const broken = store.createLoop({
        name: "doctor-missing-binary",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "openloops-definitely-missing-binary" },
      });
      const healthy = store.createLoop({
        name: "doctor-healthy",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "printf ok", shell: true },
      });
      const report = runDoctor(store);
      const failed = check(report, `loop:${broken.id}:preflight`);
      expect(failed?.status).toBe("fail");
      expect(failed?.message).toContain("doctor-missing-binary");
      expect(check(report, `loop:${healthy.id}:preflight`)?.status).toBe("ok");
      expect(report.ok).toBe(false);
    } finally {
      store.close();
    }
  });

  test("preflights every step of active workflow loops", () => {
    const store = new Store(":memory:");
    try {
      const workflow = store.createWorkflow({
        name: "doctor-workflow",
        steps: [
          { id: "fine", target: { type: "command", command: "printf ok", shell: true } },
          { id: "broken", dependsOn: ["fine"], target: { type: "command", command: "openloops-definitely-missing-binary" } },
        ],
      });
      const loop = store.createLoop({
        name: "doctor-workflow-loop",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "workflow", workflowId: workflow.id },
      });
      const report = runDoctor(store);
      const preflight = check(report, `loop:${loop.id}:preflight`);
      expect(preflight?.status).toBe("fail");
      expect(preflight?.detail).toContain("openloops-definitely-missing-binary");
      expect(report.ok).toBe(false);
    } finally {
      store.close();
    }
  });
});
