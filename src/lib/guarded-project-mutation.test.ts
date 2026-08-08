import { describe, expect, test } from "bun:test";
import {
  buildGuardedProjectReadResult,
  normalizePatch,
  requestDigest,
} from "./guarded-project-mutation.js";
import type { Workspace } from "../types/workspace.js";

function project(id = "wks_guardedread0001"): Workspace {
  return {
    id,
    slug: "guarded-read",
    name: "Guarded Read",
    description: null,
    kind: "generic",
    status: "active",
    root_id: null,
    recipe_id: null,
    canonical_machine: null,
    primary_path: null,
    git_remote: null,
    s3_bucket: null,
    s3_prefix: null,
    tags: [],
    integrations: {},
    metadata: {},
    last_opened_at: null,
    created_at: "2026-08-07 00:00:00",
    updated_at: "2026-08-07 00:00:01",
    synced_at: null,
  };
}

describe("guarded project read response control", () => {
  test("includes last_opened_at in normalized request identity", () => {
    const first = "2026-08-08T10:00:00.000Z";
    const second = "2026-08-08T11:00:00.000Z";

    expect(normalizePatch({ last_opened_at: first })).toEqual({ last_opened_at: first });
    expect(requestDigest({ last_opened_at: first })).not.toBe(requestDigest({ last_opened_at: second }));
  });

  test("returns the complete exact project record inside the bounded envelope", () => {
    const workspace = project();
    const result = buildGuardedProjectReadResult(workspace, {
      project_id: workspace.id,
      response_byte_limit: 16_384,
      time_budget_ms: 5_000,
    }, Date.now());

    expect(result.project).toEqual(workspace);
    expect(result.project_id).toBe(workspace.id);
    expect(result.response_control.complete).toBe(true);
    expect(result.response_control.truncated).toBe(false);
    expect(result.response_control.response_bytes).toBeGreaterThan(0);
  });

  test("accepts generated stable ids with underscore or hyphen immediately after wks_", () => {
    for (const id of [
      "wks__Z8qE5BOzztK7rOxQeGo2",
      "wks_-Z8qE5BOzztK7rOxQeGo2",
      "wks_A-Z_8qE5BOzztK7rOxQeGo2",
    ]) {
      const workspace = project(id);
      const result = buildGuardedProjectReadResult(workspace, {
        project_id: id,
        response_byte_limit: 16_384,
        time_budget_ms: 5_000,
      }, Date.now());

      expect(result.project_id).toBe(id);
      expect(result.response_control.complete).toBe(true);
    }
  });

  test("rejects non-id targets and malformed stable ids", () => {
    for (const id of [
      "guarded-read",
      "Guarded Read",
      "/tmp/guarded-read",
      " wks_guardedread0001",
      "wks_guardedread0001 ",
      "wks_",
      "wks_abc",
      "wks_!guardedread0001",
    ]) {
      const workspace = project(id);
      expect(() => buildGuardedProjectReadResult(workspace, {
        project_id: id,
        response_byte_limit: 16_384,
        time_budget_ms: 5_000,
      }, Date.now())).toThrow(/complete stable project id/);
    }
  });

  test("fails closed when the whole-operation time budget is exceeded", () => {
    const workspace = project();
    expect(() => buildGuardedProjectReadResult(workspace, {
      project_id: workspace.id,
      response_byte_limit: 16_384,
      time_budget_ms: 1,
    }, Date.now() - 50)).toThrow(/guarded project read time budget exceeded/);
  });
});
