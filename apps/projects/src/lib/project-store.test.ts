import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase } from "../db/database.js";
import { acquireWorkspaceLock, releaseWorkspaceLock } from "../db/workspaces.js";
import type { ProjectStore } from "../store/project-store.js";
import type {
  GuardedProjectMutationReceiptLookupInput,
  GuardedProjectMutationRequest,
  GuardedProjectMutationResult,
  GuardedProjectReadRequest,
  JsonObject,
  Workspace,
} from "../types/workspace.js";
import { deriveGuardedIdempotencyKey, preconditionDigest, requestDigest } from "./guarded-project-mutation.js";
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
  const requestHash = requestDigest(input.patch);
  const preconditionHash = preconditionDigest({ project_id: project.id, expected_revision: input.expected_revision });
  const idempotencyKey = deriveGuardedIdempotencyKey({
    operation_id: input.operation_id,
    step_id: input.step_id,
    direction: input.direction ?? "forward",
    target_id: project.id,
    request_digest: requestHash,
    precondition_digest: preconditionHash,
  });
  return {
    ok: true,
    dry_run: Boolean(input.dry_run),
    outcome: input.dry_run ? "planned" : "accepted",
    idempotency_key: idempotencyKey,
    request_digest: requestHash,
    precondition_digest: preconditionHash,
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
      idempotency_key: idempotencyKey,
      target_id: project.id,
      request_digest: requestHash,
      precondition_digest: preconditionHash,
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
    transport: "http",
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

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

describe("API-backed project store ensure", () => {
  test("rejects a cross-target guarded response before creating local state", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-store-target-guard-"));
    const previousHome = process.env.HASNA_PROJECTS_HOME;
    const previousDbPath = process.env.HASNA_PROJECTS_DB_PATH;
    const home = join(root, "home");
    process.env.HASNA_PROJECTS_HOME = home;
    process.env.HASNA_PROJECTS_DB_PATH = join(root, "registry.db");
    closeDatabase();
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
      closeDatabase();
      if (previousDbPath === undefined) delete process.env.HASNA_PROJECTS_DB_PATH;
      else process.env.HASNA_PROJECTS_DB_PATH = previousDbPath;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("previews then applies the null primary-path repair with a deterministic guarded receipt", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-store-hosted-"));
    const previousHome = process.env.HASNA_PROJECTS_HOME;
    const previousDbPath = process.env.HASNA_PROJECTS_DB_PATH;
    process.env.HASNA_PROJECTS_HOME = join(root, "home");
    process.env.HASNA_PROJECTS_DB_PATH = join(root, "registry.db");
    closeDatabase();
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
      closeDatabase();
      if (previousDbPath === undefined) delete process.env.HASNA_PROJECTS_DB_PATH;
      else process.env.HASNA_PROJECTS_DB_PATH = previousDbPath;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("preserves created files when a failed hosted repair has no authoritative receipt outcome", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-store-compensate-"));
    const previousHome = process.env.HASNA_PROJECTS_HOME;
    const previousDbPath = process.env.HASNA_PROJECTS_DB_PATH;
    const home = join(root, "home");
    process.env.HASNA_PROJECTS_HOME = home;
    process.env.HASNA_PROJECTS_DB_PATH = join(root, "registry.db");
    closeDatabase();
    const id = "wks_hostedstorefailure01";
    const dataPath = join(home, "data", id);
    const sentinel = join(dataPath, "keep.txt");
    mkdirSync(dataPath, { recursive: true });
    writeFileSync(sentinel, "pre-existing\n");
    try {
      await expect(ensureProjectStoreForTarget(apiStore(workspace(id, null), [], true), id)).rejects.toThrow("outcome remains ambiguous");
      expect(existsSync(sentinel)).toBe(true);
      expect(existsSync(dataPath)).toBe(true);
      expect(existsSync(join(dataPath, "project.db"))).toBe(true);
      expect(existsSync(join(dataPath, "assets"))).toBe(true);
      expect(existsSync(join(home, "workspaces", id))).toBe(true);
    } finally {
      if (previousHome === undefined) delete process.env.HASNA_PROJECTS_HOME;
      else process.env.HASNA_PROJECTS_HOME = previousHome;
      closeDatabase();
      if (previousDbPath === undefined) delete process.env.HASNA_PROJECTS_DB_PATH;
      else process.env.HASNA_PROJECTS_DB_PATH = previousDbPath;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reconciles an accepted receipt after an ambiguous transport abort before preserving the local store", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-store-ambiguous-accepted-"));
    const previousHome = process.env.HASNA_PROJECTS_HOME;
    const previousDbPath = process.env.HASNA_PROJECTS_DB_PATH;
    const home = join(root, "home");
    process.env.HASNA_PROJECTS_HOME = home;
    process.env.HASNA_PROJECTS_DB_PATH = join(root, "registry.db");
    closeDatabase();
    const id = "wks_hostedambiguous001";
    const project = workspace(id, null);
    let accepted: GuardedProjectMutationResult | null = null;
    const store = apiStore(project, []);
    store.guardedUpdateProject = async (input) => {
      accepted = mutationResult(input, project);
      throw abortError("connection closed after hosted acceptance");
    };
    store.lookupGuardedProjectMutationReceipt = async (input: GuardedProjectMutationReceiptLookupInput) => {
      expect(accepted).not.toBeNull();
      expect(input).toMatchObject({
        project_id: id,
        operation_id: `project-store-ensure:${id}`,
        step_id: "set-canonical-primary",
        direction: "forward",
        idempotency_key: accepted!.idempotency_key,
        max_items: 1,
      });
      return {
        receipt: accepted!.receipt!,
        response_control: accepted!.response_control,
      };
    };
    try {
      const applied = await ensureProjectStoreForTarget(store, id);
      expect(applied.registry_mutation?.receipt?.receipt_id).toBe("gpmr_store_ensure");
      expect(applied.project.primary_path).toBe(applied.paths.workspace_path);
      expect(existsSync(applied.paths.project_db_path)).toBe(true);
      expect(existsSync(applied.paths.assets_path)).toBe(true);
    } finally {
      if (previousHome === undefined) delete process.env.HASNA_PROJECTS_HOME;
      else process.env.HASNA_PROJECTS_HOME = previousHome;
      closeDatabase();
      if (previousDbPath === undefined) delete process.env.HASNA_PROJECTS_DB_PATH;
      else process.env.HASNA_PROJECTS_DB_PATH = previousDbPath;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("compensates only after an exact receipt proves the hosted repair never accepted", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-store-ambiguous-rejected-"));
    const previousHome = process.env.HASNA_PROJECTS_HOME;
    const previousDbPath = process.env.HASNA_PROJECTS_DB_PATH;
    const home = join(root, "home");
    process.env.HASNA_PROJECTS_HOME = home;
    process.env.HASNA_PROJECTS_DB_PATH = join(root, "registry.db");
    closeDatabase();
    const id = "wks_hostedneveraccepted01";
    const project = workspace(id, null);
    const store = apiStore(project, []);
    let attempted: GuardedProjectMutationRequest | null = null;
    store.guardedUpdateProject = async (input) => {
      attempted = input;
      throw abortError("connection closed before hosted acceptance");
    };
    store.lookupGuardedProjectMutationReceipt = async (input: GuardedProjectMutationReceiptLookupInput) => {
      expect(attempted).not.toBeNull();
      const terminal = mutationResult(attempted!, project);
      return {
        receipt: {
          ...terminal.receipt!,
          receipt_id: "gpmr_store_never_accepted",
          idempotency_key: input.idempotency_key,
          outcome: "terminal_nonacceptance",
          reason: "revision_mismatch",
          result_project_id: null,
          after: null,
          post_revision: null,
        },
        response_control: terminal.response_control,
      };
    };
    try {
      await expect(ensureProjectStoreForTarget(store, id)).rejects.toThrow("terminal_nonacceptance");
      expect(existsSync(join(home, "data", id, "project.db"))).toBe(false);
      expect(existsSync(join(home, "data", id, "assets"))).toBe(false);
      expect(existsSync(join(home, "workspaces", id))).toBe(false);
    } finally {
      if (previousHome === undefined) delete process.env.HASNA_PROJECTS_HOME;
      else process.env.HASNA_PROJECTS_HOME = previousHome;
      closeDatabase();
      if (previousDbPath === undefined) delete process.env.HASNA_PROJECTS_DB_PATH;
      else process.env.HASNA_PROJECTS_DB_PATH = previousDbPath;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("refuses a concurrent apply before either invocation can claim the same paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-store-lock-"));
    const previousHome = process.env.HASNA_PROJECTS_HOME;
    const previousDbPath = process.env.HASNA_PROJECTS_DB_PATH;
    const home = join(root, "home");
    process.env.HASNA_PROJECTS_HOME = home;
    process.env.HASNA_PROJECTS_DB_PATH = join(root, "registry.db");
    closeDatabase();
    const id = "wks_hostedstorelocked001";
    const lockKey = `workspace:${id}`;
    try {
      acquireWorkspaceLock({ lock_key: lockKey, reason: "concurrent ensure control", ttl_seconds: 600 });
      await expect(ensureProjectStoreForTarget(apiStore(workspace(id, null), []), id))
        .rejects.toThrow("Project lock already held");
      expect(existsSync(join(home, "data", id))).toBe(false);
    } finally {
      releaseWorkspaceLock(lockKey);
      if (previousHome === undefined) delete process.env.HASNA_PROJECTS_HOME;
      else process.env.HASNA_PROJECTS_HOME = previousHome;
      closeDatabase();
      if (previousDbPath === undefined) delete process.env.HASNA_PROJECTS_DB_PATH;
      else process.env.HASNA_PROJECTS_DB_PATH = previousDbPath;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
