import { existsSync, readFileSync } from "node:fs";
import type { Database } from "bun:sqlite";
import { getDatabase } from "../db/database.js";
import {
  addWorkspaceLocation,
  getRecipe,
  getRoot,
  listAgentRuns,
  listWorkspaceLocations,
  type WorkspaceFilter,
  listWorkspaces,
} from "../db/workspaces.js";
import { workspaceMarkerPath, writeWorkspaceMarker } from "./workspace-runtime.js";
import { inspectLegacyProjectLayout, migrateLegacyProjectLayout } from "./project-layout-migration.js";
import type { ProjectStore } from "../store/project-store.js";
import type { Workspace } from "../types/workspace.js";

export type WorkspaceCheckStatus = "ok" | "warn" | "error";

export interface WorkspaceDoctorCheck {
  code: string;
  name: string;
  status: WorkspaceCheckStatus;
  message: string;
  fixable?: boolean;
}

export interface WorkspaceDoctorFix {
  code: string;
  message: string;
  changed: boolean;
  dryRun: boolean;
}

export interface WorkspaceDoctorResult {
  workspace: Workspace;
  checks: WorkspaceDoctorCheck[];
  fixes: WorkspaceDoctorFix[];
  ok: boolean;
}

export type WorkspaceDoctorTransport = "local" | "http";

/**
 * The shared-registry references a HOSTED doctor run resolved through the
 * ProjectStore (`/v1/roots`, `/v1/recipes`) before the synchronous doctor ran:
 * `true` = found, `false` = missing, absent = not resolved in this call.
 * {@link doctorWorkspaceWithStore} fills this in; a direct hosted call without
 * it reports the reference as not checked rather than opening the on-box
 * SQLite to answer a question the hosted registry owns (hasna/apps#1720).
 */
export interface WorkspaceDoctorReferences {
  root?: boolean;
  recipe?: boolean;
}

export interface WorkspaceDoctorOptions {
  fix?: boolean;
  dryRun?: boolean;
  transport?: WorkspaceDoctorTransport;
  references?: WorkspaceDoctorReferences;
}

/** The hosted transport never reads the on-box registry: every check that would is answered here. */
const HOSTED_NOT_CHECKED =
  "API-backed projects do not own the machine-local registry; not checked in the hosted backend";

function checkPath(workspace: Workspace): WorkspaceDoctorCheck {
  if (!workspace.primary_path) {
    return { code: "WORKSPACE_PATH_MISSING", name: "path", status: "warn", message: "no primary path", fixable: false };
  }
  if (existsSync(workspace.primary_path)) {
    return { code: "WORKSPACE_PATH_OK", name: "path", status: "ok", message: workspace.primary_path };
  }
  return { code: "WORKSPACE_PATH_NOT_FOUND", name: "path", status: "error", message: workspace.primary_path, fixable: true };
}

function checkMarker(workspace: Workspace): WorkspaceDoctorCheck {
  if (!workspace.primary_path || !existsSync(workspace.primary_path)) {
    return { code: "WORKSPACE_MARKER_SKIPPED", name: "marker", status: "warn", message: "skipped because path is missing" };
  }
  const markerPath = workspaceMarkerPath(workspace);
  if (!existsSync(markerPath)) {
    return { code: "WORKSPACE_MARKER_MISSING", name: "marker", status: "warn", message: markerPath, fixable: true };
  }
  try {
    const marker = JSON.parse(readFileSync(markerPath, "utf-8")) as { id?: string; slug?: string };
    if (marker.id !== workspace.id || marker.slug !== workspace.slug) {
      return { code: "WORKSPACE_MARKER_MISMATCH", name: "marker", status: "warn", message: markerPath, fixable: true };
    }
    return { code: "WORKSPACE_MARKER_OK", name: "marker", status: "ok", message: markerPath };
  } catch {
    return { code: "WORKSPACE_MARKER_MALFORMED", name: "marker", status: "warn", message: markerPath, fixable: true };
  }
}

/**
 * One shared-registry reference (root or recipe). Local answers from the
 * on-box registry; hosted answers ONLY from what the caller resolved through
 * the store, so `getDatabase()` is unreachable on the hosted transport.
 */
function checkReference(
  name: "root" | "recipe",
  id: string | null,
  transport: WorkspaceDoctorTransport,
  resolved: boolean | undefined,
  lookupLocal: (id: string) => boolean,
): WorkspaceDoctorCheck {
  const prefix = name === "root" ? "WORKSPACE_ROOT" : "WORKSPACE_RECIPE";
  if (!id) return { code: `${prefix}_OK`, name, status: "ok", message: "none" };
  let found: boolean;
  if (transport === "http") {
    if (resolved === undefined) {
      return {
        code: `${prefix}_NOT_CHECKED`,
        name,
        status: "warn",
        message: `${id}: ${HOSTED_NOT_CHECKED} (resolve it through doctorWorkspaceWithStore)`,
        fixable: false,
      };
    }
    found = resolved;
  } else {
    found = lookupLocal(id);
  }
  return found
    ? { code: `${prefix}_OK`, name, status: "ok", message: id }
    : { code: `${prefix}_MISSING`, name, status: "error", message: id };
}

function checkReferences(
  workspace: Workspace,
  transport: WorkspaceDoctorTransport,
  references: WorkspaceDoctorReferences | undefined,
  db?: Database,
): WorkspaceDoctorCheck[] {
  return [
    checkReference("root", workspace.root_id, transport, references?.root, (id) => Boolean(getRoot(id, db))),
    checkReference("recipe", workspace.recipe_id, transport, references?.recipe, (id) => Boolean(getRecipe(id, db))),
  ];
}

function checkLocations(workspace: Workspace, transport: WorkspaceDoctorTransport, db?: Database): WorkspaceDoctorCheck {
  if (transport === "http") {
    return {
      code: "WORKSPACE_LOCATIONS_LOCAL_ONLY",
      name: "locations",
      status: "warn",
      message: "API-backed projects do not own the machine-local location registry; location repair is available only for a local project row on the machine that owns the path",
      fixable: false,
    };
  }
  const locations = listWorkspaceLocations(workspace.id, db);
  if (!locations.length) {
    return { code: "WORKSPACE_LOCATIONS_MISSING", name: "locations", status: "warn", message: "no locations registered", fixable: Boolean(workspace.primary_path) };
  }
  const stale = locations.filter((location) => location.kind === "local" && !existsSync(location.path));
  if (stale.length) {
    return { code: "WORKSPACE_LOCATIONS_STALE", name: "locations", status: "warn", message: `${stale.length} stale location(s)` };
  }
  return { code: "WORKSPACE_LOCATIONS_OK", name: "locations", status: "ok", message: `${locations.length} location(s)` };
}

function checkAgentRuns(workspace: Workspace, transport: WorkspaceDoctorTransport, db?: Database): WorkspaceDoctorCheck {
  if (transport === "http") {
    // The prompt-agent run ledger is an on-box sub-resource the projects API
    // does not model (see ProjectStore.listAgentRuns). Reading the local file
    // here was the hosted-read-opens-SQLite defect: it created projects.db
    // under the app home and reported "no recent failed runs" from an empty
    // ledger the hosted project does not own.
    return {
      code: "WORKSPACE_AGENT_RUNS_LOCAL_ONLY",
      name: "agent_runs",
      status: "warn",
      message: `agent runs are an on-box ledger; ${HOSTED_NOT_CHECKED}`,
      fixable: false,
    };
  }
  const failed = listAgentRuns({ workspace_id: workspace.id, status: "failed", limit: 20 }, db);
  if (failed.length) {
    return { code: "WORKSPACE_AGENT_RUNS_FAILED", name: "agent_runs", status: "warn", message: `${failed.length} failed run(s)` };
  }
  return { code: "WORKSPACE_AGENT_RUNS_OK", name: "agent_runs", status: "ok", message: "no recent failed runs" };
}

function tableExists(db: Database, table: string): boolean {
  const row = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name: string } | null;
  return Boolean(row);
}

function checkLegacyLayout(workspace: Workspace): WorkspaceDoctorCheck {
  const layout = inspectLegacyProjectLayout(workspace);
  if (!layout.singular_path || !layout.present) {
    return { code: "WORKSPACE_LAYOUT_OK", name: "layout", status: "ok", message: "no legacy singular layout" };
  }
  return {
    code: "WORKSPACE_LEGACY_LAYOUT_DIR",
    name: "layout",
    status: "warn",
    message: `legacy singular layout found at ${layout.singular_path}; migrate it to ${layout.plural_path}`,
    fixable: Boolean(workspace.primary_path),
  };
}

function checkMigrationMap(workspace: Workspace, transport: WorkspaceDoctorTransport, db?: Database): WorkspaceDoctorCheck {
  const migratedFrom = workspace.metadata["migrated_from_project_id"];
  if (typeof migratedFrom !== "string" || migratedFrom.length === 0) {
    return { code: "WORKSPACE_MIGRATION_NOT_APPLICABLE", name: "migration", status: "ok", message: "not migrated" };
  }
  if (transport === "http") {
    return {
      code: "WORKSPACE_MIGRATION_MAP_LOCAL_ONLY",
      name: "migration",
      status: "warn",
      message: `${migratedFrom}: the workspace_migration_map table is on-box; ${HOSTED_NOT_CHECKED}`,
      fixable: false,
    };
  }
  const d = db || getDatabase();
  if (!tableExists(d, "workspace_migration_map")) {
    return { code: "WORKSPACE_MIGRATION_MAP_MISSING", name: "migration", status: "error", message: "workspace_migration_map table missing" };
  }
  const row = d
    .query("SELECT workspace_id FROM workspace_migration_map WHERE old_project_id = ?")
    .get(migratedFrom) as { workspace_id: string } | null;
  if (!row) {
    return { code: "WORKSPACE_MIGRATION_MAP_ROW_MISSING", name: "migration", status: "error", message: migratedFrom };
  }
  if (row.workspace_id !== workspace.id) {
    return { code: "WORKSPACE_MIGRATION_MAP_MISMATCH", name: "migration", status: "error", message: `${migratedFrom} maps to ${row.workspace_id}` };
  }
  return { code: "WORKSPACE_MIGRATION_MAP_OK", name: "migration", status: "ok", message: migratedFrom };
}

/**
 * Synchronous doctor. On the hosted transport (`transport: "http"`) NOTHING
 * here reaches the on-box registry: references come from `options.references`,
 * and the location, agent-run and migration-map checks answer "local only".
 * Prefer {@link doctorWorkspaceWithStore}, which resolves the references.
 */
export function doctorWorkspace(workspace: Workspace, options: WorkspaceDoctorOptions = {}, db?: Database): WorkspaceDoctorResult {
  const transport = options.transport ?? "local";
  const checks = [
    checkPath(workspace),
    checkMarker(workspace),
    checkLegacyLayout(workspace),
    ...checkReferences(workspace, transport, options.references, db),
    checkLocations(workspace, transport, db),
    checkAgentRuns(workspace, transport, db),
    checkMigrationMap(workspace, transport, db),
  ];
  const fixes: WorkspaceDoctorFix[] = [];
  const dryRun = options.dryRun === true;

  if (options.fix) {
    const markerCheck = checks.find((check) => check.code.startsWith("WORKSPACE_MARKER_") && check.fixable);
    if (markerCheck && workspace.primary_path && existsSync(workspace.primary_path)) {
      if (!dryRun) {
        writeWorkspaceMarker(workspace, {
          source: "cli",
          command: "projects doctor --fix",
          recordEvents: transport === "local",
          db,
        });
      }
      fixes.push({ code: "FIX_WORKSPACE_MARKER", message: `${dryRun ? "Would write" : "Wrote"} ${workspaceMarkerPath(workspace)}`, changed: !dryRun, dryRun });
    }
    const locationCheck = checks.find((check) => check.code === "WORKSPACE_LOCATIONS_MISSING" && check.fixable);
    if (locationCheck && workspace.primary_path) {
      if (!dryRun) addWorkspaceLocation({ workspace_id: workspace.id, path: workspace.primary_path, label: "main", is_primary: true }, db);
      fixes.push({ code: "FIX_WORKSPACE_LOCATION", message: `${dryRun ? "Would add" : "Added"} primary location ${workspace.primary_path}`, changed: !dryRun, dryRun });
    }
    const layoutCheck = checks.find((check) => check.code === "WORKSPACE_LEGACY_LAYOUT_DIR" && check.fixable);
    if (layoutCheck) {
      const migration = migrateLegacyProjectLayout(workspace, { dryRun });
      const noun = migration.moved.length === 1 ? "entry" : "entries";
      fixes.push({
        code: "FIX_WORKSPACE_LAYOUT_MIGRATED",
        message: `${dryRun ? "Would move" : "Moved"} ${migration.moved.length} legacy layout ${noun} to ${migration.plural_path}${migration.skipped.length > 0 ? `, ${migration.skipped.length} skipped` : ""}`,
        changed: !dryRun,
        dryRun,
      });
    }
  }

  return { workspace, checks, fixes, ok: checks.every((check) => check.status !== "error") };
}

/** The slice of the Store the doctor needs; a test can hand in a fake. */
export type WorkspaceDoctorStore = Pick<ProjectStore, "transport" | "getRoot" | "getRecipe">;

/**
 * Doctor a project through the active Store — the entry point the CLI, the MCP
 * server and the prompt agent share.
 *
 * Hosted: the root/recipe references are resolved against the shared registry
 * (`/v1/roots`, `/v1/recipes`) and the synchronous doctor runs with
 * `transport: "http"`, so the on-box SQLite is never opened or created for an
 * API-backed project (hasna/apps#1720, acceptance f). Local: the synchronous
 * doctor, unchanged, completed synchronously (no await) so a caller holding a
 * synchronous lock still covers the whole run.
 */
export async function doctorWorkspaceWithStore(
  store: WorkspaceDoctorStore,
  workspace: Workspace,
  options: Omit<WorkspaceDoctorOptions, "transport" | "references"> = {},
): Promise<WorkspaceDoctorResult> {
  if (store.transport !== "http") {
    return doctorWorkspace(workspace, { ...options, transport: "local" });
  }
  const [root, recipe] = await Promise.all([
    workspace.root_id ? store.getRoot(workspace.root_id) : Promise.resolve(null),
    workspace.recipe_id ? store.getRecipe(workspace.recipe_id) : Promise.resolve(null),
  ]);
  return doctorWorkspace(workspace, {
    ...options,
    transport: "http",
    references: { root: Boolean(root), recipe: Boolean(recipe) },
  });
}

export function doctorWorkspaces(filter: WorkspaceFilter = {}, options: WorkspaceDoctorOptions = {}, db?: Database): WorkspaceDoctorResult[] {
  return listWorkspaces({ ...filter, limit: filter.limit ?? 500 }, db).map((workspace) => doctorWorkspace(workspace, options, db));
}
