import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { closeDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import { createScenario } from "../db/scenarios.js";
import { createRun, getResultsByRun, getRun, resetStore } from "../store/index.js";

// Serve a reachable URL so the run preflight's reachability check passes.
// The worker scenario never opens the page in this fixture (the forced
// lightpanda engine throws before any navigation), so a static 200 suffices.
function startPreflightServer(): { url: string; stop: () => void } {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("ok", { status: 200 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
  };
}

const cleanupPaths: string[] = [];

// Force the local sqlite store: on fleet machines the ambient environment
// carries HASNA_TESTERS_API_URL + HASNA_TESTERS_API_KEY, which would route
// every store call in this file — and in the spawned CLI — to the hosted
// API. The fixture needs the isolated temp DB.
for (const key of [
  "HASNA_TESTERS_API_URL",
  "TESTERS_API_URL",
  "HASNA_TESTERS_API_KEY",
  "TESTERS_API_KEY",
]) {
  delete process.env[key];
}

// The child CLI inherits its environment from this process; build a scrubbed
// copy so no ambient hosted-API configuration can reach the worker.
function childEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      key === "HASNA_TESTERS_API_URL" ||
      key === "TESTERS_API_URL" ||
      key === "HASNA_TESTERS_API_KEY" ||
      key === "TESTERS_API_KEY"
    )
      continue;
    env[key] = value ?? "";
  }
  return { ...env, ...extra };
}

async function setupWorkerDb() {
  const baseDir = mkdtempSync(join(tmpdir(), "testers-army-worker-"));
  const dbPath = join(baseDir, "testers.db");
  const testersDir = join(baseDir, ".hasna", "testers");
  cleanupPaths.push(baseDir);

  process.env.TESTERS_DB_PATH = dbPath;
  process.env.HASNA_TESTERS_DIR = testersDir;
  resetStore();
  resetDatabase();

  const project = createProject({ name: "army-worker-project", scenarioPrefix: "ARMY" });
  const scenario = createScenario({
    name: "Worker scenario",
    description: "Executed by a runWithArmy worker process",
    projectId: project.id,
    steps: ["Navigate to the page"],
  });
  // The coordinator's shared run record: worker must attach to it, never
  // finalize it.
  const sharedRun = await createRun({
    url: "http://127.0.0.1:1",
    model: "haiku",
    projectId: project.id,
  });

  closeDatabase();
  return { dbPath, testersDir, project, scenario, sharedRun };
}

afterEach(() => {
  closeDatabase();
  for (const dir of cleanupPaths.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.TESTERS_DB_PATH;
  delete process.env.HASNA_TESTERS_DIR;
});

describe("testers run --run-id (army worker mode)", () => {
  test("worker writes results into the shared run and exits non-zero on failure, without finalizing the run", async () => {
    const { dbPath, testersDir, project, scenario, sharedRun } = await setupWorkerDb();
    const server = startPreflightServer();

    const proc = Bun.spawn({
      cmd: [
        "bun",
        "run",
        "src/cli/index.tsx",
        "--no-color",
        "run",
        server.url,
        "--project",
        project.id,
        "--scenario",
        scenario.shortId,
        "--run-id",
        sharedRun.id,
        "--model",
        "haiku",
        "--no-auto-generate",
      ],
      env: childEnv({
        TESTERS_DB_PATH: dbPath,
        HASNA_TESTERS_DIR: testersDir,
        // Presence-only: the run preflight demands an API key env var. The
        // scenario never reaches the AI layer in this fixture (the browser
        // engine is forced to lightpanda, which is unavailable), so no real
        // credential is needed or used.
        ANTHROPIC_API_KEY: "army-worker-test-placeholder-key",
        TESTERS_BROWSER_ENGINE: "lightpanda",
      }),
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    server.stop();

    // The worker executed the scenario, which genuinely failed in this
    // environment (no usable AI model/browser for the fixture) — a real
    // outcome recorded as a result, never a silent success.
    expect(exitCode).toBe(1);

    const results = await getResultsByRun(sharedRun.id);
    expect(results.length).toBe(1);
    expect(results[0].scenarioId).toBe(scenario.id);
    expect(results[0].status).toBe("error");
    expect(results[0].error).toBeTruthy();

    // The worker must NOT finalize the coordinator's run — status is
    // untouched (still "pending" from createRun).
    const run = await getRun(sharedRun.id);
    expect(run?.status).toBe("pending");
  });

  test("worker exits 2 when the shared run record does not exist", async () => {
    const { dbPath, testersDir, project, scenario } = await setupWorkerDb();
    const server = startPreflightServer();

    const proc = Bun.spawn({
      cmd: [
        "bun",
        "run",
        "src/cli/index.tsx",
        "--no-color",
        "run",
        server.url,
        "--project",
        project.id,
        "--scenario",
        scenario.shortId,
        "--run-id",
        "no-such-run",
        "--model",
        "haiku",
        "--no-auto-generate",
      ],
      env: childEnv({
        TESTERS_DB_PATH: dbPath,
        HASNA_TESTERS_DIR: testersDir,
        ANTHROPIC_API_KEY: "army-worker-test-placeholder-key",
      }),
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    server.stop();

    expect(exitCode).toBe(2);
  });
});
