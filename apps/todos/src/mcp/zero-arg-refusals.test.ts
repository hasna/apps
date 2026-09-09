import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createRetrospective } from "../db/retrospectives.js";
import { finishTaskRunTransaction } from "../db/task-runs.js";
// The REAL formatter, not a copy: this file pins the end-to-end contract the
// 0.16.0 docs state — a zero-argument on-box MCP tool refuses with a typed
// payload, never an opaque UNKNOWN_ERROR.
import { formatError } from "./index.js";

// Two spawned-suite neighbours live in this package; give the suite headroom on
// a loaded host (same class as the other spawn-based files).
setDefaultTimeout(60_000);

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

/**
 * `create_retrospective` and `finish_task_run` are zero-required-argument MCP
 * tools served from the on-box store. Both refuse caller input when invoked
 * with no arguments (a missing scope; a missing run id/key) and both used to
 * throw a PLAIN `Error`, which `formatError` sanitizes to
 * `{"code":"UNKNOWN_ERROR"}`. Measured under `HASNA_TODOS_LOCAL=1` — the exact
 * remedy the 0.16.0 docs prescribe for these tools — that made the docs' "no
 * zero-argument tool returns an opaque UNKNOWN_ERROR" claim false. These tests
 * pin the typed refusal through the real formatter.
 */
describe("zero-argument on-box MCP refusals are typed, not UNKNOWN_ERROR", () => {
  test("create_retrospective answers INVALID_INPUT for a scoped-less call", () => {
    let thrown: unknown;
    try {
      createRetrospective({}, db);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    const result = JSON.parse(formatError(thrown));
    expect(result.code).toBe("INVALID_INPUT");
    expect(result.code).not.toBe("UNKNOWN_ERROR");
    expect(result.message).toBe("Retrospective requires --plan or --project");
    expect(result.suggestion).toBe("Pass plan_id or project_id.");
  });

  test("finish_task_run answers INVALID_INPUT for a run-id-less call", () => {
    let thrown: unknown;
    try {
      finishTaskRunTransaction({}, db);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    const result = JSON.parse(formatError(thrown));
    expect(result.code).toBe("INVALID_INPUT");
    expect(result.code).not.toBe("UNKNOWN_ERROR");
    expect(result.message).toBe("runs finish requires a run id or --key");
    expect(result.suggestion).toBe("Pass run_id, or key with task_id.");
  });
});
