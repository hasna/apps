import { describe, expect, test } from "bun:test";
import { buildGuardedProjectReadResult } from "./guarded-project-mutation.js";
import type { Workspace } from "../types/workspace.js";

function project(): Workspace {
  return {
    id: "wks_guardedread0001",
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

  test("fails closed when the whole-operation time budget is exceeded", () => {
    const workspace = project();
    expect(() => buildGuardedProjectReadResult(workspace, {
      project_id: workspace.id,
      response_byte_limit: 16_384,
      time_budget_ms: 1,
    }, Date.now() - 50)).toThrow(/guarded project read time budget exceeded/);
  });
});
