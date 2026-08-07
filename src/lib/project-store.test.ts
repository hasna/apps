import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectStore } from "../store/project-store.js";
import type {
  GuardedProjectMutationRequest,
  GuardedProjectMutationResult,
  GuardedProjectReadRequest,
  JsonObject,
  Workspace,
} from "../types/workspace.js";
import { ensureProjectStoreForTarget } from "./project-store.js";

function workspace(id: string, primaryPath: string | null): Workspace {
  return {
    id,
    slug: `project-${id.slice(-6)}`,
    name: "Hosted Project",
    description: null,
    kind: "generic",
    status: "active",
    root_id: null,
    recipe_id: null,
    canonical_machine: null,
    primary_path: primaryPath,
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

function mutationResult(input: GuardedProjectMutationRequest, project: Workspace): GuardedProjectMutationResult {
  const after = { ...project, primary_path: input.patch.primary_path ?? project.primary_path, updated_at: "2026-08-07 00:00:02" };
  return {
    ok: true,
    dry_run: Boolean(input.dry_run),
    outcome: input.dry_run ? "planned" : "accepted",
    idempotency_key: "gpm_store_ensure",
    request_digest: "request",
    precondition_digest: "precondition",
    project_id: project.id,
    expected_revision: input.expected_revision,
    current_revision: after.updated_at,
    before: project,
    after,
    receipt: input.dry_run ? null : {
      receipt_id: "gpmr_store_ensure",
      operation_id: input.operation_id,
      step_id: input.step_id,
      direction: "forward",
      idempotency_key: "gpm_store_ensure",
      target_id: project.id,
      request_digest: "request",
      precondition_digest: "precondition",
      expected_revision: input.expected_revision,
      outcome: "accepted",
      reason: null,
      result_project_id: project.id,
      duplicate_of_receipt_id: null,
      before: project as unknown as JsonObject,
      after: after as unknown as JsonObject,
      post_revision: after.updated_at,
      created_at: after.updated_at,
    },
    response_control: {
      response_byte_limit: input.response_byte_limit,
      time_budget_ms: input.time_budget_ms,
      response_bytes: 1024,
      elapsed_ms: 1,
      complete: true,
      truncated: false,
    },
  };
}

function apiStore(project: Workspace, updates: GuardedProjectMutationRequest[], failUpdate = false): ProjectStore {
  return {
    mode: "api",
    baseUrl: "https://projects.example.test/v1",
    async guardedReadProject(input: GuardedProjectReadRequest) {
      return {
        ok: true,
        project_id: project.id,
        project,
        current_revision: project.updated_at,
        response_control: {
          response_byte_limit: input.response_byte_limit,
          time_budget_ms: input.time_budget_ms,
          response_bytes: 1024,
          elapsed_ms: 1,
          complete: true,
          truncated: false,
        },
      };
    },
    async guardedUpdateProject(input: GuardedProjectMutationRequest) {
      updates.push(input);
      if (failUpdate) throw new Error("guarded update failed");
      return mutationResult(input, project);
    },
  } as unknown as ProjectStore;
}

describe("API-backed project store ensure", () => {
  test("rejects a cross-target guarded response before creating local state", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-store-target-guard-"));
    const previousHome = process.env.HASNA_PROJECTS_HOME;
    const home = join(root, "home");
    process.env.HASNA_PROJECTS_HOME = home;
    const requestedId = "wks_hostedstoretarget001";
    const returned = workspace("wks_hostedstoretarget002", null);
    try {
      await expect(ensureProjectStoreForTarget(apiStore(returned, []), requestedId, { dryRun: true }))
        .rejects.toThrow(`one complete exact record for ${requestedId}`);
      expect(existsSync(join(home, "data", requestedId))).toBe(false);
      expect(existsSync(join(home, "data", returned.id))).toBe(false);
    } finally {
      if (previousHome === undefined) delete process.env.HASNA_PROJECTS_HOME;
      else process.env.HASNA_PROJECTS_HOME = previousHome;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("previews then applies the null primary-path repair with a deterministic guarded receipt", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-store-hosted-"));
    const previousHome = process.env.HASNA_PROJECTS_HOME;
    process.env.HASNA_PROJECTS_HOME = join(root, "home");
    const id = "wks_hostedstoreensure01";
    const project = workspace(id, null);
    const updates: GuardedProjectMutationRequest[] = [];
    try {
      const dryRun = await ensureProjectStoreForTarget(apiStore(project, updates), id, { dryRun: true });
      expect(dryRun.primary_updated).toBe(true);
      expect(dryRun.registry_mutation?.outcome).toBe("planned");
      expect(existsSync(dryRun.paths.project_db_path)).toBe(false);
      expect(updates[0]).toMatchObject({
        project_id: id,
        operation_id: `project-store-ensure:${id}`,
        step_id: "set-canonical-primary",
        expected_revision: project.updated_at,
        dry_run: true,
      });

      const applied = await ensureProjectStoreForTarget(apiStore(project, updates), id);
      expect(applied.primary_updated).toBe(true);
      expect(applied.registry_mutation?.receipt?.receipt_id).toBe("gpmr_store_ensure");
      expect(applied.project.primary_path).toBe(applied.paths.workspace_path);
      expect(applied.app_store).toMatchObject({ exists: true, project_id: id, schema_version: 3 });
      expect(existsSync(applied.paths.project_db_path)).toBe(true);
    } finally {
      if (previousHome === undefined) delete process.env.HASNA_PROJECTS_HOME;
      else process.env.HASNA_PROJECTS_HOME = previousHome;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("compensates only files created by a failed hosted repair", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-store-compensate-"));
    const previousHome = process.env.HASNA_PROJECTS_HOME;
    const home = join(root, "home");
    process.env.HASNA_PROJECTS_HOME = home;
    const id = "wks_hostedstorefailure01";
    const dataPath = join(home, "data", id);
    const sentinel = join(dataPath, "keep.txt");
    mkdirSync(dataPath, { recursive: true });
    writeFileSync(sentinel, "pre-existing\n");
    try {
      await expect(ensureProjectStoreForTarget(apiStore(workspace(id, null), [], true), id)).rejects.toThrow("guarded update failed");
      expect(existsSync(sentinel)).toBe(true);
      expect(existsSync(dataPath)).toBe(true);
      expect(existsSync(join(dataPath, "project.db"))).toBe(false);
      expect(existsSync(join(dataPath, "assets"))).toBe(false);
      expect(existsSync(join(home, "workspaces", id))).toBe(false);
    } finally {
      if (previousHome === undefined) delete process.env.HASNA_PROJECTS_HOME;
      else process.env.HASNA_PROJECTS_HOME = previousHome;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
