import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  acquireWorkspaceLock,
  addWorkspaceLocation,
  recordWorkspaceEvent,
  releaseWorkspaceLock,
  resolveWorkspace,
} from "../db/workspaces.js";
import type { EventSource, JsonObject, Workspace, WorkspaceLocation } from "../types/workspace.js";
import type { GuardedProjectMutationResult } from "../types/workspace.js";
import type { ProjectStore } from "../store/project-store.js";
import {
  ensureProjectStore as ensureProjectAppStore,
  inspectProjectStoreReadOnly as inspectProjectAppStoreReadOnly,
  inspectProjectStoreOwner,
  type ProjectStoreSummary,
} from "../db/project-store.js";
import {
  assertCompleteStableProjectId,
  deriveGuardedIdempotencyKey,
  preconditionDigest,
  requestDigest,
} from "./guarded-project-mutation.js";
import { prepareWorkspaceDirectory } from "./workspace-runtime.js";
import {
  getProjectsHome,
  isProjectWorkspaceStorePath,
  projectDataStorePath,
  projectWorkspaceStorePath,
  PROJECTS_HOME_ENV,
} from "./project-store-paths.js";

export interface ProjectStorePaths {
  home: string;
  workspace_path: string;
  data_path: string;
  project_db_path: string;
  assets_path: string;
  logs_path: string;
  artifacts_path: string;
  context_path: string;
}

export interface ProjectStoreInspection {
  project: Workspace;
  env: {
    projects_home_env: typeof PROJECTS_HOME_ENV;
    projects_home: string;
  };
  paths: ProjectStorePaths;
  primary_path: string | null;
  primary_is_canonical: boolean;
  exists: {
    workspace: boolean;
    data: boolean;
    logs: boolean;
    artifacts: boolean;
    context: boolean;
  };
  migration_recommended: boolean;
}

export interface ProjectStoreEnsureResult {
  project: Workspace;
  paths: ProjectStorePaths;
  created: string[];
  primary_updated: boolean;
  dry_run: boolean;
  app_store: ProjectStoreSummary;
  registry_mutation: GuardedProjectMutationResult | null;
}

export const PROJECT_STORE_ENSURE_RESPONSE_BYTE_LIMIT = 65_536 as const;
export const PROJECT_STORE_ENSURE_TIME_BUDGET_MS = 10_000 as const;

const PROJECT_STORE_ENSURE_STEP_ID = "set-canonical-primary" as const;

function receiptWorkspace(
  value: JsonObject | null,
  label: "before" | "after",
  projectId: string,
): Workspace {
  if (!value || value.id !== projectId) {
    throw new Error(`Guarded project store receipt ${label} snapshot does not match exact project ${projectId}`);
  }
  return value as unknown as Workspace;
}

function recoveredProjectStoreMutation(
  lookup: Awaited<ReturnType<ProjectStore["lookupGuardedProjectMutationReceipt"]>>,
  input: Parameters<ProjectStore["guardedUpdateProject"]>[0],
  idempotencyKey: string,
  canonicalPath: string,
): GuardedProjectMutationResult {
  const receipt = lookup.receipt;
  const expectedRequestDigest = requestDigest(input.patch);
  const expectedPreconditionDigest = preconditionDigest({
    project_id: input.project_id,
    expected_revision: input.expected_revision,
  });
  if (
    receipt.operation_id !== input.operation_id
    || receipt.step_id !== input.step_id
    || receipt.direction !== "forward"
    || receipt.idempotency_key !== idempotencyKey
    || receipt.target_id !== input.project_id
    || receipt.request_digest !== expectedRequestDigest
    || receipt.precondition_digest !== expectedPreconditionDigest
    || receipt.expected_revision !== input.expected_revision
  ) {
    throw new Error(`Guarded project store receipt reconciliation mismatch for exact project ${input.project_id}`);
  }
  if (receipt.outcome === "terminal_nonacceptance") {
    throw new Error(`Guarded primary-path update authoritatively returned terminal_nonacceptance for project ${input.project_id}: ${receipt.reason ?? "unspecified"}`);
  }
  const before = receiptWorkspace(receipt.before, "before", input.project_id);
  const after = receiptWorkspace(receipt.after, "after", input.project_id);
  if (
    receipt.result_project_id !== input.project_id
    || !receipt.post_revision
    || after.primary_path !== canonicalPath
  ) {
    throw new Error(`Guarded project store accepted receipt has an invalid result for exact project ${input.project_id}`);
  }
  return {
    ok: true,
    dry_run: false,
    outcome: receipt.outcome,
    idempotency_key: receipt.idempotency_key,
    request_digest: receipt.request_digest,
    precondition_digest: receipt.precondition_digest,
    project_id: input.project_id,
    expected_revision: input.expected_revision,
    current_revision: receipt.post_revision,
    before,
    after,
    receipt,
    response_control: lookup.response_control,
  };
}

export interface ProjectStoreMigrationAction {
  type: "file" | "db" | "verification";
  action: string;
  source?: string;
  target: string;
  status: "planned" | "completed" | "skipped";
  metadata?: JsonObject;
}

export interface ProjectStoreMigrationPlan {
  project: Workspace;
  paths: ProjectStorePaths;
  source_path: string | null;
  target_path: string;
  dry_run: boolean;
  can_apply: boolean;
  no_op: boolean;
  warnings: string[];
  actions: ProjectStoreMigrationAction[];
}

export interface ProjectStoreMigrationResult extends ProjectStoreMigrationPlan {
  project: Workspace;
  plan_artifact_path: string | null;
  verified: boolean;
  previous_location: WorkspaceLocation | null;
  primary_location: WorkspaceLocation | null;
}

export function projectStorePaths(workspaceId: string): ProjectStorePaths {
  const dataPath = projectDataStorePath(workspaceId);
  return {
    home: getProjectsHome(),
    workspace_path: projectWorkspaceStorePath(workspaceId),
    data_path: dataPath,
    project_db_path: join(dataPath, "project.db"),
    assets_path: join(dataPath, "assets"),
    logs_path: join(dataPath, "logs"),
    artifacts_path: join(dataPath, "artifacts"),
    context_path: join(dataPath, "context"),
  };
}

function ensureDir(path: string, created: string[], dryRun: boolean): void {
  if (dryRun) {
    if (!existsSync(path)) created.push(path);
    return;
  }
  const firstCreated = mkdirSync(path, { recursive: true });
  if (firstCreated !== undefined) created.push(path);
}

function ensureDataDirs(paths: ProjectStorePaths, dryRun: boolean): string[] {
  const created: string[] = [];
  ensureDir(paths.workspace_path, created, dryRun);
  ensureDir(paths.data_path, created, dryRun);
  ensureDir(paths.assets_path, created, dryRun);
  ensureDir(paths.logs_path, created, dryRun);
  ensureDir(paths.artifacts_path, created, dryRun);
  ensureDir(paths.context_path, created, dryRun);
  return created;
}

function projectMarkerId(path: string): string | null {
  const markerPath = join(path, ".project.json");
  if (!existsSync(markerPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(markerPath, "utf-8")) as { id?: unknown };
    return typeof parsed.id === "string" ? parsed.id : null;
  } catch {
    throw new Error(`Project store collision: canonical workspace marker is unreadable: ${markerPath}`);
  }
}

function assertCanonicalStoreClaim(project: Workspace, paths: ProjectStorePaths): void {
  const markerOwner = projectMarkerId(paths.workspace_path);
  if (markerOwner && markerOwner !== project.id) {
    throw new Error(`Project store collision: canonical workspace belongs to project ${markerOwner}, not ${project.id}`);
  }
  if (
    existsSync(paths.workspace_path)
    && !markerOwner
    && project.primary_path !== paths.workspace_path
    && readdirSync(paths.workspace_path).length > 0
  ) {
    throw new Error(`Project store collision: canonical workspace is non-empty and is not claimed by project ${project.id}: ${paths.workspace_path}`);
  }
  const appStoreOwner = inspectProjectStoreOwner(project.id);
  if (appStoreOwner && appStoreOwner !== project.id) {
    throw new Error(`Project store collision: canonical app store belongs to project ${appStoreOwner}, not ${project.id}`);
  }
}

function compensateCreatedStorePaths(created: string[], paths: ProjectStorePaths): void {
  if (created.includes(paths.project_db_path)) {
    for (const file of [paths.project_db_path, `${paths.project_db_path}-wal`, `${paths.project_db_path}-shm`]) {
      try { unlinkSync(file); } catch {}
    }
  }
  for (const path of [...created].reverse()) {
    if (path === paths.project_db_path) continue;
    try { rmdirSync(path); } catch {}
  }
}

export function inspectProjectStore(project: Workspace): ProjectStoreInspection {
  const paths = projectStorePaths(project.id);
  const primaryIsCanonical = isProjectWorkspaceStorePath(project.id, project.primary_path);
  return {
    project,
    env: {
      projects_home_env: PROJECTS_HOME_ENV,
      projects_home: paths.home,
    },
    paths,
    primary_path: project.primary_path,
    primary_is_canonical: primaryIsCanonical,
    exists: {
      workspace: existsSync(paths.workspace_path),
      data: existsSync(paths.data_path),
      logs: existsSync(paths.logs_path),
      artifacts: existsSync(paths.artifacts_path),
      context: existsSync(paths.context_path),
    },
    migration_recommended: Boolean(project.primary_path && !primaryIsCanonical),
  };
}

export function ensureProjectStore(
  project: Workspace,
  options: {
    db?: Database;
    dryRun?: boolean;
    setPrimaryIfMissing?: boolean;
    recordRegistryEvent?: boolean;
    agentId?: string;
    source?: EventSource;
    command?: string;
  } = {},
): ProjectStoreEnsureResult {
  const paths = projectStorePaths(project.id);
  const dryRun = Boolean(options.dryRun);
  assertCanonicalStoreClaim(project, paths);
  const created = ensureDataDirs(paths, dryRun);
  const appStoreExisted = existsSync(paths.project_db_path);
  if (!appStoreExisted) created.push(paths.project_db_path);
  const appStore = dryRun ? inspectProjectAppStoreReadOnly(project) : ensureProjectAppStore(project);
  let primaryUpdated = false;
  let nextProject = project;

  if (!project.primary_path && options.setPrimaryIfMissing !== false) {
    primaryUpdated = true;
    if (!dryRun) {
      addWorkspaceLocation({
        workspace_id: project.id,
        path: paths.workspace_path,
        label: "canonical",
        kind: "store",
        is_primary: true,
        metadata: { canonical: true, data_path: paths.data_path },
        agent_id: options.agentId,
        source: options.source ?? "cli",
        command: options.command,
      }, options.db);
      nextProject = resolveWorkspace(project.id, options.db) ?? project;
    }
  }

  if (!dryRun && options.recordRegistryEvent !== false) {
    recordWorkspaceEvent({
      workspace_id: project.id,
      agent_id: options.agentId,
      event_type: "store_ensured",
      source: options.source ?? "cli",
      command: options.command,
      after: { paths, created, primary_updated: primaryUpdated } as unknown as JsonObject,
    }, options.db);
  }

  return {
    project: nextProject,
    paths,
    created,
    primary_updated: primaryUpdated,
    dry_run: dryRun,
    app_store: appStore,
    registry_mutation: null,
  };
}

export async function ensureProjectStoreForTarget(
  store: ProjectStore,
  target: string,
  options: {
    dryRun?: boolean;
    setPrimaryIfMissing?: boolean;
    agentId?: string;
    source?: EventSource;
    command?: string;
    responseByteLimit?: number;
    timeBudgetMs?: number;
  } = {},
): Promise<ProjectStoreEnsureResult> {
  if (store.transport === "local") {
    const project = await store.resolveTarget(target);
    return ensureProjectStore(project, options);
  }

  assertCompleteStableProjectId(target);
  const responseByteLimit = options.responseByteLimit ?? PROJECT_STORE_ENSURE_RESPONSE_BYTE_LIMIT;
  const timeBudgetMs = options.timeBudgetMs ?? PROJECT_STORE_ENSURE_TIME_BUDGET_MS;
  const guarded = await store.guardedReadProject({
    project_id: target,
    response_byte_limit: responseByteLimit,
    time_budget_ms: timeBudgetMs,
  });
  const guardedProject = guarded.project;
  if (
    guarded.project_id !== target
    || !guardedProject
    || guardedProject.id !== target
    || guarded.response_control.complete !== true
    || guarded.response_control.truncated !== false
  ) {
    throw new Error(
      `Guarded project read did not return one complete exact record for ${target}; the Projects API producer must expose the bounded project field before store ensure can proceed`,
    );
  }

  const run = async (): Promise<ProjectStoreEnsureResult> => {
    let localResult: ProjectStoreEnsureResult | null = null;
    let compensationAuthorized = false;
    try {
      localResult = ensureProjectStore(guardedProject, {
        ...options,
        setPrimaryIfMissing: false,
        recordRegistryEvent: false,
      });

      if (!guardedProject.primary_path && options.setPrimaryIfMissing !== false) {
        const operationId = `project-store-ensure:${target}`;
        const patch = { primary_path: localResult.paths.workspace_path };
        const mutationInput = {
          project_id: target,
          operation_id: operationId,
          step_id: PROJECT_STORE_ENSURE_STEP_ID,
          expected_revision: guarded.current_revision,
          patch,
          dry_run: Boolean(options.dryRun),
          agent_id: options.agentId,
          source: options.source ?? "cli",
          command: options.command,
          response_byte_limit: responseByteLimit,
          time_budget_ms: timeBudgetMs,
        } as const;
        let registryMutation: GuardedProjectMutationResult;
        try {
          registryMutation = await store.guardedUpdateProject(mutationInput);
        } catch (updateError) {
          if (options.dryRun) throw updateError;
          const expectedRequestDigest = requestDigest(patch);
          const expectedPreconditionDigest = preconditionDigest({
            project_id: target,
            expected_revision: guarded.current_revision,
          });
          const idempotencyKey = deriveGuardedIdempotencyKey({
            operation_id: operationId,
            step_id: PROJECT_STORE_ENSURE_STEP_ID,
            direction: "forward",
            target_id: target,
            request_digest: expectedRequestDigest,
            precondition_digest: expectedPreconditionDigest,
          });
          try {
            const lookup = await store.lookupGuardedProjectMutationReceipt({
              project_id: target,
              operation_id: operationId,
              step_id: PROJECT_STORE_ENSURE_STEP_ID,
              direction: "forward",
              idempotency_key: idempotencyKey,
              max_items: 1,
              response_byte_limit: responseByteLimit,
              time_budget_ms: timeBudgetMs,
            });
            if (lookup.receipt.outcome === "terminal_nonacceptance") compensationAuthorized = true;
            registryMutation = recoveredProjectStoreMutation(
              lookup,
              mutationInput,
              idempotencyKey,
              localResult.paths.workspace_path,
            );
          } catch (reconciliationError) {
            if (compensationAuthorized) throw reconciliationError;
            const updateMessage = updateError instanceof Error ? updateError.message : String(updateError);
            const reconciliationMessage = reconciliationError instanceof Error
              ? reconciliationError.message
              : String(reconciliationError);
            throw new Error(
              `Guarded primary-path update outcome remains ambiguous for project ${target}; local store preserved. Update error: ${updateMessage}. Receipt reconciliation error: ${reconciliationMessage}`,
            );
          }
        }
        if (!registryMutation.ok || !registryMutation.after) {
          if (registryMutation.outcome === "terminal_nonacceptance") compensationAuthorized = true;
          throw new Error(`Guarded primary-path update did not accept project ${target}: ${registryMutation.outcome}`);
        }
        return {
          ...localResult,
          project: registryMutation.after,
          primary_updated: true,
          registry_mutation: registryMutation,
        };
      }
      return localResult;
    } catch (error) {
      if (compensationAuthorized && localResult && !localResult.dry_run) {
        compensateCreatedStorePaths(localResult.created, localResult.paths);
      }
      throw error;
    }
  };

  if (options.dryRun) return run();
  const lockKey = `workspace:${target}`;
  try {
    acquireWorkspaceLock({
      lock_key: lockKey,
      workspace_id: resolveWorkspace(target) ? target : undefined,
      reason: "project store ensure",
      ttl_seconds: 600,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("Workspace lock already held:")) {
      throw new Error(message.replace("Workspace lock", "Project lock"));
    }
    throw error;
  }
  try {
    return await run();
  } finally {
    releaseWorkspaceLock(lockKey);
  }
}

function isEmptyDirectory(path: string): boolean {
  try {
    return readdirSync(path).length === 0;
  } catch {
    return false;
  }
}

function migrationActions(
  paths: ProjectStorePaths,
  sourcePath: string | null,
  targetPath: string,
  noOp: boolean,
): ProjectStoreMigrationAction[] {
  const actions: ProjectStoreMigrationAction[] = [
    { type: "file", action: "ensure_store_dirs", target: paths.home, status: "planned" },
    { type: "file", action: "write_migration_plan", target: paths.data_path, status: "planned" },
  ];
  if (sourcePath && sourcePath !== targetPath) {
    actions.push({ type: "file", action: "move", source: sourcePath, target: targetPath, status: "planned" });
    actions.push({ type: "db", action: "register_previous_location", target: sourcePath, status: "planned" });
  }
  if (!noOp) {
    actions.push({ type: "db", action: "set_primary_location", target: targetPath, status: "planned" });
    actions.push({ type: "file", action: "write_project_marker", target: join(targetPath, ".project.json"), status: "planned" });
  }
  actions.push({ type: "verification", action: "verify_canonical_primary", target: targetPath, status: "planned" });
  return actions;
}

export function planProjectStoreMigration(project: Workspace, options: { dryRun?: boolean } = {}): ProjectStoreMigrationPlan {
  const paths = projectStorePaths(project.id);
  const sourcePath = project.primary_path ? resolve(project.primary_path) : null;
  const targetPath = paths.workspace_path;
  const noOp = sourcePath === targetPath;
  const warnings: string[] = [];

  if (sourcePath && !existsSync(sourcePath) && !noOp) {
    warnings.push(`Current primary path does not exist: ${sourcePath}`);
  }
  if (!noOp && existsSync(targetPath) && !isEmptyDirectory(targetPath)) {
    warnings.push(`Canonical workspace path already exists and is not empty: ${targetPath}`);
  }

  return {
    project,
    paths,
    source_path: sourcePath,
    target_path: targetPath,
    dry_run: options.dryRun !== false,
    can_apply: warnings.length === 0,
    no_op: noOp,
    warnings,
    actions: migrationActions(paths, sourcePath, targetPath, noOp),
  };
}

export function migrateProjectToStore(
  project: Workspace,
  options: { db?: Database; apply?: boolean; agentId?: string; source?: EventSource; command?: string } = {},
): ProjectStoreMigrationResult {
  const dryRun = !options.apply;
  const plan = planProjectStoreMigration(project, { dryRun });
  if (dryRun) {
    return { ...plan, plan_artifact_path: null, verified: false, previous_location: null, primary_location: null };
  }
  if (!plan.can_apply) {
    throw new Error(`Cannot migrate project store: ${plan.warnings.join("; ")}`);
  }

  const created = ensureDataDirs(plan.paths, false);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const planArtifactPath = join(plan.paths.data_path, `migration-plan-${timestamp}.json`);
  writeFileSync(planArtifactPath, JSON.stringify(plan, null, 2) + "\n", "utf-8");
  let movedDirectory = false;

  try {
    if (plan.source_path && plan.source_path !== plan.target_path) {
      if (existsSync(plan.target_path) && isEmptyDirectory(plan.target_path)) rmdirSync(plan.target_path);
      renameSync(plan.source_path, plan.target_path);
      movedDirectory = true;
    } else if (!existsSync(plan.target_path)) {
      mkdirSync(plan.target_path, { recursive: true });
    }

    let previousLocation: WorkspaceLocation | null = null;
    if (plan.source_path && plan.source_path !== plan.target_path) {
      previousLocation = addWorkspaceLocation({
        workspace_id: project.id,
        path: plan.source_path,
        label: "previous-primary",
        kind: "migrated-from",
        metadata: { migrated_to: plan.target_path, plan_artifact_path: planArtifactPath },
        agent_id: options.agentId,
        source: options.source ?? "cli",
        command: options.command,
      }, options.db);
    }

    const primaryLocation = addWorkspaceLocation({
      workspace_id: project.id,
      path: plan.target_path,
      label: "canonical",
      kind: "store",
      is_primary: true,
      metadata: { canonical: true, data_path: plan.paths.data_path, created, plan_artifact_path: planArtifactPath },
      agent_id: options.agentId,
      source: options.source ?? "cli",
      command: options.command,
    }, options.db);

    const updatedProject = resolveWorkspace(project.id, options.db) ?? project;
    prepareWorkspaceDirectory(updatedProject, {
      writeMarker: true,
      db: options.db,
      agentId: options.agentId,
      source: options.source ?? "cli",
      command: options.command,
    });
    const verified = isProjectWorkspaceStorePath(updatedProject.id, updatedProject.primary_path) && existsSync(plan.target_path);
    if (!verified) throw new Error("Migration verification failed: canonical primary path was not recorded and present.");

    recordWorkspaceEvent({
      workspace_id: project.id,
      agent_id: options.agentId,
      event_type: "store_migrated",
      source: options.source ?? "cli",
      command: options.command,
      before: project as unknown as JsonObject,
      after: { project: updatedProject, plan_artifact_path: planArtifactPath, verified } as unknown as JsonObject,
    }, options.db);

    return {
      ...plan,
      project: updatedProject,
      dry_run: false,
      actions: plan.actions.map((action) => ({ ...action, status: "completed" })),
      plan_artifact_path: planArtifactPath,
      verified,
      previous_location: previousLocation,
      primary_location: primaryLocation,
    };
  } catch (err) {
    const rollbackErrors: string[] = [];
    if (movedDirectory && plan.source_path && existsSync(plan.target_path) && !existsSync(plan.source_path)) {
      try {
        renameSync(plan.target_path, plan.source_path);
      } catch (rollbackErr) {
        rollbackErrors.push(`move-back failed: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`);
      }
    }
    if (plan.source_path && existsSync(plan.source_path)) {
      try {
        addWorkspaceLocation({
          workspace_id: project.id,
          path: plan.source_path,
          label: "main",
          kind: "local",
          is_primary: true,
          metadata: { failed_store_migration: true, rollback_from: plan.target_path, plan_artifact_path: planArtifactPath },
          agent_id: options.agentId,
          source: options.source ?? "cli",
          command: options.command,
        }, options.db);
      } catch (rollbackErr) {
        rollbackErrors.push(`primary-restore failed: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`);
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(rollbackErrors.length ? `${message}; rollback errors: ${rollbackErrors.join("; ")}` : message);
  }
}
