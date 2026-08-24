import { describe, expect, setSystemTime, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MIGRATIONS, runMigrations } from "./schema.js";
import {
  acquireWorkspaceLock,
  addWorkspaceLocation,
  addTmuxProfileWindow,
  archiveWorkspace,
  assignAgentToWorkspace,
  completeAgentRun,
  createAgent,
  createRecipe,
  createRoot,
  createTmuxProfile,
  deleteRoot,
  createWorkspace,
  deleteWorkspace,
  getWorkspaceByPath,
  getWorkspaceBySlug,
  getWorkspace,
  guardedUpdateWorkspace,
  inferWorkspaceKind,
  listAgentRuns,
  listMachines,
  listRoots,
  listTmuxProfileWindows,
  listWorkspaceLocks,
  listWorkspaceEvents,
  listWorkspaceAgents,
  listWorkspaceLocations,
  listWorkspacesByPath,
  listWorkspaces,
  countWorkspaces,
  lookupGuardedWorkspaceMutationReceipt,
  matchRootForPath,
  migrateLegacyProjectsToWorkspaces,
  releaseWorkspaceLock,
  rollbackGuardedWorkspaceMutation,
  resolveTmuxProfile,
  renderTemplate,
  scoreRoots,
  startAgentRun,
  unarchiveWorkspace,
  updateRoot,
  updateWorkspace,
} from "./workspaces.js";
import { doctorWorkspace } from "../lib/workspace-doctor.js";
import { builtInWorkspaceRecipes, ensureBuiltInWorkspaceRecipes } from "../lib/workspace-defaults.js";
import { closeDatabase, getDatabase, PROJECTS_DB_PATH_ENV } from "./database.js";
import { resolveProjectStore, __resetProjectStore } from "../store/project-store.js";
import { importRegisteredRoots, importWorkspace, planWorkspaceImport } from "../lib/workspace-import.js";
import { cleanupWorkspaceCreation, executeWorkspaceCreation, planWorkspaceCreation } from "../lib/workspace-plan.js";
import { applyWorkspaceTmuxProfile, prepareWorkspaceDirectory, tmuxProfileToSpec, workspaceMarkerPath } from "../lib/workspace-runtime.js";
import { inspectProjectStore, migrateProjectToStore, planProjectStoreMigration } from "../lib/project-store.js";
import { projectWorkspaceStorePath } from "../lib/project-store-paths.js";
import type { JsonObject } from "../types/workspace.js";

function makeDb(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys=ON");
  runMigrations(db);
  return db;
}

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "workspace-domain-"));
}

describe("workspace schema", () => {
  test("doctor local mode repairs the marker and package-owned location registry together", () => {
    const db = makeDb();
    const projectPath = tmpDir();
    try {
      const workspace = createWorkspace({
        name: "Local Doctor",
        slug: "local-doctor",
        primary_path: projectPath,
      }, db);
      db.run("DELETE FROM workspace_locations WHERE workspace_id = ?", [workspace.id]);
      writeFileSync(
        workspaceMarkerPath(workspace),
        JSON.stringify({ schema_version: 1, id: workspace.id, slug: "stale-local-doctor" }, null, 2) + "\n",
      );

      const dryRun = doctorWorkspace(workspace, { fix: true, dryRun: true, transport: "local" }, db);
      expect(dryRun.fixes.map((fix) => fix.code).sort()).toEqual(["FIX_WORKSPACE_LOCATION", "FIX_WORKSPACE_MARKER"]);
      expect(listWorkspaceLocations(workspace.id, db)).toHaveLength(0);

      const fixed = doctorWorkspace(workspace, { fix: true, transport: "local" }, db);
      expect(fixed.fixes.map((fix) => fix.code).sort()).toEqual(["FIX_WORKSPACE_LOCATION", "FIX_WORKSPACE_MARKER"]);
      expect(JSON.parse(readFileSync(workspaceMarkerPath(workspace), "utf-8")).slug).toBe("local-doctor");
      expect(listWorkspaceLocations(workspace.id, db)).toHaveLength(1);
      expect(listWorkspaceEvents(workspace.id, db).map((event) => event.event_type)).toContain("workspace_marker_written");
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
      db.close();
    }
  });

  test("creates generic workspace tables and seeds the machine registry", () => {
    const db = makeDb();
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('roots', 'workspaces', 'agents', 'recipes', 'workspace_events', 'agent_runs', 'machines')")
      .all() as { name: string }[];
    expect(tables.map((table) => table.name).sort()).toEqual([
      "agent_runs",
      "agents",
      "machines",
      "recipes",
      "roots",
      "workspace_events",
      "workspaces",
    ]);
    const columns = db.query("PRAGMA table_info(workspaces)").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain("canonical_machine");
    const machines = listMachines(db);
    expect(machines).toHaveLength(16);
    expect(machines.find((machine) => machine.slug === "spark02")?.role).toBe("mirror-hub");
    expect(machines.find((machine) => machine.slug === "apple06")?.role).toBe("avoid");
    expect(machines.find((machine) => machine.slug === "machine011")?.role).toBe("assignable");
    db.close();
  });

  test("migrates canonical_machine metadata into the first-class column", () => {
    const db = new Database(":memory:");
    db.run(`
      CREATE TABLE _migrations (
        id INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    for (const migration of MIGRATIONS.slice(0, 6)) db.run(migration);
    db.run(
      "INSERT INTO workspaces (id, slug, name, metadata) VALUES (?, ?, ?, ?)",
      ["wks_legacy_owner", "legacy-owner", "Legacy Owner", JSON.stringify({ canonical_machine: "spark01", retained: true })],
    );

    runMigrations(db);

    const workspace = getWorkspaceBySlug("legacy-owner", db);
    expect(workspace?.canonical_machine).toBe("spark01");
    expect(workspace?.metadata).toEqual({ retained: true });
    db.close();
  });

  test("widens resource-link locator kinds without losing legacy UUID links", () => {
    const db = new Database(":memory:");
    db.run("PRAGMA foreign_keys=ON");
    db.run(`
      CREATE TABLE _migrations (
        id INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    for (const migration of MIGRATIONS.slice(0, 10)) db.run(migration);
    db.run(
      "INSERT INTO workspaces (id, slug, name) VALUES (?, ?, ?)",
      ["wks_locator_upgrade", "locator-upgrade", "Locator Upgrade"],
    );
    db.run(`
      INSERT INTO project_resource_links (
        id, project_id, authority, service_instance, source_package, target_kind,
        locator_kind, locator_value, scope, labels_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      "prl_legacy_uuid",
      "wks_locator_upgrade",
      "conversations",
      "urn:hasna:conversations:test",
      "@hasna/conversations",
      "channel",
      "external_uuid",
      "515fbb15-4661-4cdc-b1df-f719797b8cad",
      "resource",
      JSON.stringify({ channel_name: "locator-upgrade" }),
    ]);
    expect(() => db.run(`
      INSERT INTO project_resource_links (
        id, project_id, authority, service_instance, source_package, target_kind,
        locator_kind, locator_value, scope, labels_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      "prl_channel_before_upgrade",
      "wks_locator_upgrade",
      "conversations",
      "urn:hasna:conversations:test",
      "@hasna/conversations",
      "channel",
      "conversations_channel_id",
      "chn_79fa9c68937a1d020d6031dcaa3dd8d7",
      "resource",
      JSON.stringify({ channel_name: "locator-upgrade" }),
    ])).toThrow();

    runMigrations(db);

    expect(db.query(
      "SELECT locator_kind, locator_value FROM project_resource_links ORDER BY id",
    ).all()).toEqual([{
      locator_kind: "external_uuid",
      locator_value: "515fbb15-4661-4cdc-b1df-f719797b8cad",
    }]);
    db.run(`
      INSERT INTO project_resource_links (
        id, project_id, authority, service_instance, source_package, target_kind,
        locator_kind, locator_value, scope, labels_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      "prl_channel_after_upgrade",
      "wks_locator_upgrade",
      "conversations",
      "urn:hasna:conversations:test",
      "@hasna/conversations",
      "channel",
      "conversations_channel_id",
      "chn_79fa9c68937a1d020d6031dcaa3dd8d7",
      "resource",
      JSON.stringify({ channel_name: "locator-upgrade" }),
    ]);
    expect(db.query(
      "SELECT locator_kind FROM project_resource_links ORDER BY id",
    ).all()).toEqual([
      { locator_kind: "conversations_channel_id" },
      { locator_kind: "external_uuid" },
    ]);
    expect(() => db.run(
      "UPDATE project_resource_links SET locator_value = ? WHERE id = ?",
      ["chn_00000000000000000000000000000000", "prl_channel_after_upgrade"],
    )).toThrow(/immutable/);
    db.close();
  });

  test("widens resource-link authorities for Orgs without losing existing links", () => {
    const db = new Database(":memory:");
    db.run("PRAGMA foreign_keys=ON");
    db.run(`
      CREATE TABLE _migrations (
        id INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    for (const migration of MIGRATIONS.slice(0, 11)) db.run(migration);
    db.run(
      "INSERT INTO workspaces (id, slug, name) VALUES (?, ?, ?)",
      ["wks_orgs_upgrade", "orgs-upgrade", "Orgs Upgrade"],
    );
    db.run(`
      INSERT INTO project_resource_links (
        id, project_id, authority, service_instance, source_package, target_kind,
        locator_kind, locator_value, scope, labels_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      "prl_existing_todos",
      "wks_orgs_upgrade",
      "todos",
      "urn:hasna:todos:test",
      "@hasna/todos",
      "project",
      "canonical_uri",
      "urn:hasna:todos:project:existing",
      "collection",
      JSON.stringify({ name: "Existing Todos" }),
    ]);
    expect(() => db.run(`
      INSERT INTO project_resource_links (
        id, project_id, authority, service_instance, source_package, target_kind,
        locator_kind, locator_value, scope, labels_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      "prl_orgs_before_upgrade",
      "wks_orgs_upgrade",
      "orgs",
      "urn:hasna:orgs:test",
      "@hasna/orgs",
      "org",
      "canonical_uri",
      "urn:hasna:orgs:org:hasna-family",
      "collection",
      JSON.stringify({ name: "Hasna Family" }),
    ])).toThrow();

    runMigrations(db);

    expect(db.query(
      "SELECT authority, source_package, target_kind FROM project_resource_links ORDER BY id",
    ).all()).toEqual([{
      authority: "todos",
      source_package: "@hasna/todos",
      target_kind: "project",
    }]);
    db.run(`
      INSERT INTO project_resource_links (
        id, project_id, authority, service_instance, source_package, target_kind,
        locator_kind, locator_value, scope, labels_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      "prl_orgs_after_upgrade",
      "wks_orgs_upgrade",
      "orgs",
      "urn:hasna:orgs:test",
      "@hasna/orgs",
      "org",
      "canonical_uri",
      "urn:hasna:orgs:org:hasna-family",
      "collection",
      JSON.stringify({ name: "Hasna Family" }),
    ]);
    expect(db.query(
      "SELECT authority, source_package, target_kind FROM project_resource_links ORDER BY id",
    ).all()).toEqual([
      { authority: "todos", source_package: "@hasna/todos", target_kind: "project" },
      { authority: "orgs", source_package: "@hasna/orgs", target_kind: "org" },
    ]);
    expect(() => db.run(
      "UPDATE project_resource_links SET locator_value = ? WHERE id = ?",
      ["urn:hasna:orgs:org:other", "prl_orgs_after_upgrade"],
    )).toThrow(/immutable/);
    db.close();
  });

  test("widens resource-link authorities for Contacts without losing existing links", () => {
    const db = new Database(":memory:");
    db.run("PRAGMA foreign_keys=ON");
    db.run(`
      CREATE TABLE _migrations (
        id INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    for (const migration of MIGRATIONS.slice(0, 12)) db.run(migration);
    db.run(
      "INSERT INTO workspaces (id, slug, name) VALUES (?, ?, ?)",
      ["wks_contacts_upgrade", "contacts-upgrade", "Contacts Upgrade"],
    );
    db.run(`
      INSERT INTO project_resource_links (
        id, project_id, authority, service_instance, source_package, target_kind,
        locator_kind, locator_value, scope, labels_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      "prl_existing_orgs",
      "wks_contacts_upgrade",
      "orgs",
      "urn:hasna:orgs:test",
      "@hasna/orgs",
      "org",
      "canonical_uri",
      "urn:hasna:orgs:org:hasna-family",
      "collection",
      JSON.stringify({ name: "Hasna Family" }),
    ]);
    expect(() => db.run(`
      INSERT INTO project_resource_links (
        id, project_id, authority, service_instance, source_package, target_kind,
        locator_kind, locator_value, scope, labels_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      "prl_contacts_before_upgrade",
      "wks_contacts_upgrade",
      "contacts",
      "urn:hasna:contacts:test",
      "@hasna/contacts",
      "contact",
      "external_uuid",
      "6b68e131-abe5-43b7-92cd-9930b04611df",
      "resource",
      JSON.stringify({ name: "Bianca" }),
    ])).toThrow();

    runMigrations(db);

    expect(db.query(
      "SELECT authority, source_package, target_kind FROM project_resource_links ORDER BY id",
    ).all()).toEqual([{
      authority: "orgs",
      source_package: "@hasna/orgs",
      target_kind: "org",
    }]);
    db.run(`
      INSERT INTO project_resource_links (
        id, project_id, authority, service_instance, source_package, target_kind,
        locator_kind, locator_value, scope, labels_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      "prl_contacts_after_upgrade",
      "wks_contacts_upgrade",
      "contacts",
      "urn:hasna:contacts:test",
      "@hasna/contacts",
      "contact",
      "external_uuid",
      "6b68e131-abe5-43b7-92cd-9930b04611df",
      "resource",
      JSON.stringify({ name: "Bianca" }),
    ]);
    expect(db.query(
      "SELECT authority, source_package, target_kind FROM project_resource_links ORDER BY id",
    ).all()).toEqual([
      { authority: "contacts", source_package: "@hasna/contacts", target_kind: "contact" },
      { authority: "orgs", source_package: "@hasna/orgs", target_kind: "org" },
    ]);
    expect(() => db.run(
      "UPDATE project_resource_links SET locator_value = ? WHERE id = ?",
      ["515fbb15-4661-4cdc-b1df-f719797b8cad", "prl_contacts_after_upgrade"],
    )).toThrow(/immutable/);
    db.close();
  });

  test("widens resource-link target kinds for Todos tasks without losing existing links", () => {
    const db = new Database(":memory:");
    db.run("PRAGMA foreign_keys=ON");
    db.run(`
      CREATE TABLE _migrations (
        id INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    for (const migration of MIGRATIONS.slice(0, 13)) db.run(migration);
    db.run(
      "INSERT INTO workspaces (id, slug, name) VALUES (?, ?, ?)",
      ["wks_todos_task_upgrade", "todos-task-upgrade", "Todos Task Upgrade"],
    );
    db.run(`
      INSERT INTO project_resource_links (
        id, project_id, authority, service_instance, source_package, target_kind,
        locator_kind, locator_value, scope, labels_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      "prl_existing_plan",
      "wks_todos_task_upgrade",
      "todos",
      "urn:hasna:todos:test",
      "@hasna/todos",
      "plan",
      "external_uuid",
      "27fcfeec-3740-4a89-a0ea-4c7c2c60aeeb",
      "collection",
      JSON.stringify({ name: "Existing Plan" }),
    ]);
    expect(() => db.run(`
      INSERT INTO project_resource_links (
        id, project_id, authority, service_instance, source_package, target_kind,
        locator_kind, locator_value, scope, labels_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      "prl_task_before_upgrade",
      "wks_todos_task_upgrade",
      "todos",
      "urn:hasna:todos:test",
      "@hasna/todos",
      "task",
      "external_uuid",
      "e2f791bd-f26b-4fac-a762-2cba96202aa5",
      "resource",
      JSON.stringify({ name: "Root Task" }),
    ])).toThrow();

    runMigrations(db);

    expect(db.query(
      "SELECT authority, target_kind, locator_value FROM project_resource_links ORDER BY id",
    ).all()).toEqual([{
      authority: "todos",
      target_kind: "plan",
      locator_value: "27fcfeec-3740-4a89-a0ea-4c7c2c60aeeb",
    }]);
    db.run(`
      INSERT INTO project_resource_links (
        id, project_id, authority, service_instance, source_package, target_kind,
        locator_kind, locator_value, scope, labels_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      "prl_task_after_upgrade",
      "wks_todos_task_upgrade",
      "todos",
      "urn:hasna:todos:test",
      "@hasna/todos",
      "task",
      "external_uuid",
      "e2f791bd-f26b-4fac-a762-2cba96202aa5",
      "resource",
      JSON.stringify({ name: "Root Task" }),
    ]);
    expect(db.query(
      "SELECT authority, target_kind, locator_value FROM project_resource_links ORDER BY id",
    ).all()).toEqual([
      {
        authority: "todos",
        target_kind: "plan",
        locator_value: "27fcfeec-3740-4a89-a0ea-4c7c2c60aeeb",
      },
      {
        authority: "todos",
        target_kind: "task",
        locator_value: "e2f791bd-f26b-4fac-a762-2cba96202aa5",
      },
    ]);
    expect(() => db.run(
      "UPDATE project_resource_links SET locator_value = ? WHERE id = ?",
      ["00000000-0000-4000-8000-000000000000", "prl_task_after_upgrade"],
    )).toThrow(/immutable/);
    db.close();
  });
});

describe("workspace domain services", () => {
  test("guarded project metadata mutation enforces exact id, revision, idempotency, receipts, dry-run, lookup, and rollback", () => {
    const db = makeDb();
    try {
      const workspace = createWorkspace({ name: "Guarded Demo", slug: "guarded-demo", metadata: { owner: "old" } }, db);
      const originalRevision = workspace.updated_at;

      expect(() => guardedUpdateWorkspace({
        project_id: workspace.slug,
        operation_id: "op-exact-id",
        step_id: "rename",
        expected_revision: originalRevision,
        patch: { name: "Should Not Run" },
        response_byte_limit: 20_000,
        time_budget_ms: 2_000,
        dry_run: true,
      }, db)).toThrow(/complete stable project id/);
      expect(() => guardedUpdateWorkspace({
        project_id: workspace.id.slice(0, 8),
        operation_id: "op-partial-id",
        step_id: "rename",
        expected_revision: originalRevision,
        patch: { name: "Should Not Run" },
        response_byte_limit: 20_000,
        time_budget_ms: 2_000,
        dry_run: true,
      }, db)).toThrow(/complete stable project id/);

      const dryRun = guardedUpdateWorkspace({
        project_id: workspace.id,
        operation_id: "op-dry-run",
        step_id: "rename",
        expected_revision: originalRevision,
        patch: {
          name: "Dry Run Only",
          metadata: { owner: "dry" },
          last_opened_at: "2026-08-08T10:00:00.000Z",
        },
        response_byte_limit: 40_000,
        time_budget_ms: 2_000,
        dry_run: true,
      }, db);
      expect(dryRun.outcome).toBe("planned");
      expect(dryRun.receipt).toBeNull();
      expect(dryRun.response_control.complete).toBe(true);
      expect(dryRun.response_control.truncated).toBe(false);
      expect(dryRun.response_control.response_bytes).toBeGreaterThan(0);
      expect(dryRun.after?.last_opened_at).toBe("2026-08-08T10:00:00.000Z");
      expect(getWorkspace(workspace.id, db)?.name).toBe("Guarded Demo");
      expect(getWorkspace(workspace.id, db)?.last_opened_at).toBeNull();

      const accepted = guardedUpdateWorkspace({
        project_id: workspace.id,
        operation_id: "op-forward",
        step_id: "rename",
        expected_revision: originalRevision,
        patch: {
          name: "Guarded Renamed",
          metadata: { owner: "new" },
          last_opened_at: "2026-08-08T11:00:00.000Z",
        },
        response_byte_limit: 80_000,
        time_budget_ms: 2_000,
        agent_id: undefined,
        source: "cli",
        command: "projects guarded-update",
      }, db);
      expect(accepted.ok).toBe(true);
      expect(accepted.outcome).toBe("accepted");
      expect(accepted.receipt?.outcome).toBe("accepted");
      expect(accepted.receipt?.result_project_id).toBe(workspace.id);
      expect(accepted.receipt?.post_revision).toBe(accepted.after?.updated_at);
      expect(accepted.response_control.complete).toBe(true);
      expect(accepted.response_control.truncated).toBe(false);
      expect(getWorkspace(workspace.id, db)?.name).toBe("Guarded Renamed");
      expect(getWorkspace(workspace.id, db)?.last_opened_at).toBe("2026-08-08T11:00:00.000Z");

      const duplicate = guardedUpdateWorkspace({
        project_id: workspace.id,
        operation_id: "op-forward",
        step_id: "rename",
        expected_revision: originalRevision,
        patch: {
          name: "Guarded Renamed",
          metadata: { owner: "new" },
          last_opened_at: "2026-08-08T11:00:00.000Z",
        },
        response_byte_limit: 80_000,
        time_budget_ms: 2_000,
      }, db);
      expect(duplicate.ok).toBe(true);
      expect(duplicate.outcome).toBe("duplicate_of_accepted");
      expect(duplicate.receipt?.outcome).toBe("duplicate_of_accepted");
      expect(duplicate.receipt?.receipt_id).not.toBe(accepted.receipt?.receipt_id);
      expect(duplicate.receipt?.duplicate_of_receipt_id).toBe(accepted.receipt?.receipt_id);

      const changedRequest = guardedUpdateWorkspace({
        project_id: workspace.id,
        operation_id: "op-forward",
        step_id: "rename",
        expected_revision: originalRevision,
        patch: { name: "Different Request" },
        response_byte_limit: 80_000,
        time_budget_ms: 2_000,
      }, db);
      expect(changedRequest.ok).toBe(false);
      expect(changedRequest.receipt?.outcome).toBe("terminal_nonacceptance");
      expect(changedRequest.receipt?.reason).toBe("changed_request_or_precondition_for_step");
      expect(getWorkspace(workspace.id, db)?.name).toBe("Guarded Renamed");

      const stale = guardedUpdateWorkspace({
        project_id: workspace.id,
        operation_id: "op-stale",
        step_id: "rename",
        expected_revision: originalRevision,
        patch: { name: "Stale Should Fail" },
        response_byte_limit: 80_000,
        time_budget_ms: 2_000,
      }, db);
      expect(stale.ok).toBe(false);
      expect(stale.receipt?.outcome).toBe("terminal_nonacceptance");
      expect(stale.receipt?.reason).toBe("stale_revision");
      expect(getWorkspace(workspace.id, db)?.name).toBe("Guarded Renamed");

      const lookedUp = lookupGuardedWorkspaceMutationReceipt({
        project_id: workspace.id,
        operation_id: "op-forward",
        step_id: "rename",
        direction: "forward",
        idempotency_key: accepted.idempotency_key,
        max_items: 1,
        response_byte_limit: 20_000,
        time_budget_ms: 2_000,
      }, db);
      expect(lookedUp.receipt_id).toBe(duplicate.receipt!.receipt_id);
      expect(lookedUp.duplicate_of_receipt_id).toBe(accepted.receipt!.receipt_id);
      expect(() => lookupGuardedWorkspaceMutationReceipt({
        project_id: workspace.id,
        operation_id: "op-forward",
        step_id: "rename",
        direction: "forward",
        idempotency_key: "missing",
        max_items: 1,
        response_byte_limit: 20_000,
        time_budget_ms: 2_000,
      }, db)).toThrow(/exactly one terminal receipt, found 0/);

      const rolledBack = rollbackGuardedWorkspaceMutation({
        project_id: workspace.id,
        operation_id: "op-rollback",
        step_id: "restore",
        accepted_receipt_id: accepted.receipt!.receipt_id,
        expected_current_revision: accepted.receipt!.post_revision!,
        response_byte_limit: 80_000,
        time_budget_ms: 2_000,
        source: "cli",
        command: "projects guarded-rollback",
      }, db);
      expect(rolledBack.ok).toBe(true);
      expect(rolledBack.receipt?.direction).toBe("inverse");
      expect(rolledBack.after?.name).toBe("Guarded Demo");
      expect(rolledBack.after?.metadata).toEqual({ owner: "old" });
      expect(rolledBack.after?.last_opened_at).toBeNull();
      expect(getWorkspace(workspace.id, db)?.name).toBe("Guarded Demo");
      expect(getWorkspace(workspace.id, db)?.last_opened_at).toBeNull();
    } finally {
      db.close();
    }
  });

  test("guarded identity mutation receipts use the final primary-location revision and roll back every identity field", () => {
    const db = makeDb();
    const originalPath = tmpDir();
    const forwardPath = tmpDir();
    const frozen = new Date("2026-08-09T12:00:00.000Z");
    try {
      setSystemTime(frozen);
      const workspace = createWorkspace({
        name: "Guarded Identity Demo",
        kind: "generic",
        primary_path: originalPath,
        git_remote: "https://example.invalid/hasna/guarded-before.git",
      }, db);

      const accepted = guardedUpdateWorkspace({
        project_id: workspace.id,
        operation_id: "op-identity-forward",
        step_id: "identity",
        expected_revision: workspace.updated_at,
        patch: {
          kind: "open-source",
          primary_path: forwardPath,
          git_remote: "https://example.invalid/hasna/guarded-after.git",
        },
        response_byte_limit: 80_000,
        time_budget_ms: 2_000,
        source: "cli",
        command: "projects guarded-update",
      }, db);

      const storedForward = getWorkspace(workspace.id, db)!;
      expect(accepted.outcome).toBe("accepted");
      expect(accepted.after).toEqual(storedForward);
      expect(accepted.receipt?.after).toEqual(storedForward as unknown as JsonObject);
      expect(accepted.receipt?.post_revision).toBe(storedForward.updated_at);
      expect(listWorkspaceEvents(workspace.id, db)
        .find((event) => event.event_type === "updated")?.after_json).toEqual(storedForward as unknown as JsonObject);
      expect(storedForward).toMatchObject({
        kind: "open-source",
        primary_path: forwardPath,
        git_remote: "https://example.invalid/hasna/guarded-after.git",
      });
      expect(listWorkspaceLocations(workspace.id, db).map((location) => ({
        path: location.path,
        is_primary: location.is_primary,
      }))).toEqual(expect.arrayContaining([
        { path: originalPath, is_primary: false },
        { path: forwardPath, is_primary: true },
      ]));

      const rolledBack = rollbackGuardedWorkspaceMutation({
        project_id: workspace.id,
        operation_id: "op-identity-rollback",
        step_id: "restore-identity",
        accepted_receipt_id: accepted.receipt!.receipt_id,
        expected_current_revision: accepted.receipt!.post_revision!,
        response_byte_limit: 80_000,
        time_budget_ms: 2_000,
        source: "cli",
        command: "projects guarded-rollback",
      }, db);

      const storedRollback = getWorkspace(workspace.id, db)!;
      expect(rolledBack.outcome).toBe("accepted");
      expect(rolledBack.after).toEqual(storedRollback);
      expect(storedRollback).toMatchObject({
        kind: "generic",
        primary_path: originalPath,
        git_remote: "https://example.invalid/hasna/guarded-before.git",
      });
      expect(listWorkspaceLocations(workspace.id, db).map((location) => ({
        path: location.path,
        is_primary: location.is_primary,
      }))).toEqual(expect.arrayContaining([
        { path: originalPath, is_primary: true },
        { path: forwardPath, is_primary: false },
      ]));
    } finally {
      setSystemTime();
      rmSync(originalPath, { recursive: true, force: true });
      rmSync(forwardPath, { recursive: true, force: true });
      db.close();
    }
  });

  test("guarded rollback to a remote-only project clears primary location semantics", () => {
    const db = makeDb();
    const forwardPath = tmpDir();
    const frozen = new Date("2026-08-09T13:00:00.000Z");
    try {
      setSystemTime(frozen);
      const workspace = createWorkspace({
        name: "Guarded Remote Only",
        kind: "remote-only",
        git_remote: "https://example.invalid/hasna/guarded-remote-only.git",
      }, db);
      expect(workspace.primary_path).toBeNull();
      expect(listWorkspaceLocations(workspace.id, db)).toEqual([]);

      const accepted = guardedUpdateWorkspace({
        project_id: workspace.id,
        operation_id: "op-remote-only-forward",
        step_id: "set-primary-path",
        expected_revision: workspace.updated_at,
        patch: { primary_path: forwardPath },
        response_byte_limit: 80_000,
        time_budget_ms: 2_000,
        source: "cli",
        command: "projects guarded-update",
      }, db);

      const storedForward = getWorkspace(workspace.id, db)!;
      expect(accepted.outcome).toBe("accepted");
      expect(accepted.after).toEqual(storedForward);
      expect(accepted.receipt?.after).toEqual(storedForward as unknown as JsonObject);
      expect(accepted.receipt?.post_revision).toBe(storedForward.updated_at);
      expect(listWorkspaceLocations(workspace.id, db).map((location) => ({
        path: location.path,
        is_primary: location.is_primary,
      }))).toEqual([{ path: forwardPath, is_primary: true }]);

      const rolledBack = rollbackGuardedWorkspaceMutation({
        project_id: workspace.id,
        operation_id: "op-remote-only-rollback",
        step_id: "clear-primary-path",
        accepted_receipt_id: accepted.receipt!.receipt_id,
        expected_current_revision: accepted.receipt!.post_revision!,
        response_byte_limit: 80_000,
        time_budget_ms: 2_000,
        source: "cli",
        command: "projects guarded-rollback",
      }, db);

      const storedRollback = getWorkspace(workspace.id, db)!;
      expect(rolledBack.outcome).toBe("accepted");
      expect(rolledBack.after).toEqual(storedRollback);
      expect(rolledBack.receipt?.after).toEqual(storedRollback as unknown as JsonObject);
      expect(rolledBack.receipt?.post_revision).toBe(storedRollback.updated_at);
      expect(storedRollback.primary_path).toBeNull();
      expect(listWorkspaceLocations(workspace.id, db).map((location) => ({
        path: location.path,
        is_primary: location.is_primary,
      }))).toEqual([{ path: forwardPath, is_primary: false }]);
    } finally {
      setSystemTime();
      rmSync(forwardPath, { recursive: true, force: true });
      db.close();
    }
  });

  test("guarded project metadata mutation rejects stale revisions when accepted updates share or precede clock time", () => {
    const db = makeDb();
    const frozen = new Date("2026-08-08T12:00:00.000Z");
    try {
      setSystemTime(frozen);
      const workspace = createWorkspace({ name: "Clock Guarded Demo" }, db);
      const originalRevision = workspace.updated_at;

      const accepted = guardedUpdateWorkspace({
        project_id: workspace.id,
        operation_id: "op-equal-clock",
        step_id: "rename",
        expected_revision: originalRevision,
        patch: { name: "Equal Clock Accepted" },
        response_byte_limit: 80_000,
        time_budget_ms: 2_000,
      }, db);
      expect(accepted.ok).toBe(true);
      expect(accepted.outcome).toBe("accepted");

      const stale = guardedUpdateWorkspace({
        project_id: workspace.id,
        operation_id: "op-equal-clock-stale",
        step_id: "rename",
        expected_revision: originalRevision,
        patch: { name: "Old Revision Must Fail" },
        response_byte_limit: 80_000,
        time_budget_ms: 2_000,
      }, db);
      expect(stale.ok).toBe(false);
      expect(stale.receipt?.outcome).toBe("terminal_nonacceptance");
      expect(stale.receipt?.reason).toBe("stale_revision");
      expect(getWorkspace(workspace.id, db)?.name).toBe("Equal Clock Accepted");

      const equalClockRevision = accepted.after!.updated_at;
      expect(Date.parse(equalClockRevision.replace(" ", "T") + "Z")).toBeGreaterThan(
        Date.parse(originalRevision.replace(" ", "T") + "Z"),
      );

      setSystemTime(new Date("2026-08-08T11:59:59.999Z"));
      const backwardsClock = guardedUpdateWorkspace({
        project_id: workspace.id,
        operation_id: "op-backwards-clock",
        step_id: "rename",
        expected_revision: equalClockRevision,
        patch: { name: "Backwards Clock Accepted" },
        response_byte_limit: 80_000,
        time_budget_ms: 2_000,
      }, db);
      expect(backwardsClock.ok).toBe(true);
      expect(backwardsClock.outcome).toBe("accepted");
      expect(Date.parse(backwardsClock.after!.updated_at.replace(" ", "T") + "Z")).toBeGreaterThan(
        Date.parse(equalClockRevision.replace(" ", "T") + "Z"),
      );
    } finally {
      setSystemTime();
      db.close();
    }
  });

  test("guarded project metadata mutation fails closed when the response byte budget is exceeded", () => {
    const db = makeDb();
    try {
      const workspace = createWorkspace({ name: "Tiny Budget" }, db);
      expect(() => guardedUpdateWorkspace({
        project_id: workspace.id,
        operation_id: "op-budget",
        step_id: "rename",
        expected_revision: workspace.updated_at,
        patch: { name: "Too Large For Response Budget" },
        response_byte_limit: 10,
        time_budget_ms: 2_000,
        dry_run: true,
      }, db)).toThrow(/response byte budget exceeded/);
      expect(getWorkspace(workspace.id, db)?.name).toBe("Tiny Budget");

      expect(() => guardedUpdateWorkspace({
        project_id: workspace.id,
        operation_id: "op-budget-write",
        step_id: "rename",
        expected_revision: workspace.updated_at,
        patch: { name: "Must Not Mutate" },
        response_byte_limit: 10,
        time_budget_ms: 2_000,
      }, db)).toThrow(/response byte budget exceeded/);
      expect(getWorkspace(workspace.id, db)?.name).toBe("Tiny Budget");
    } finally {
      db.close();
    }
  });

  test("defaults rootless projects to the canonical ID-based workspace store", () => {
    const db = makeDb();
    const previousHome = process.env["HASNA_PROJECTS_HOME"];
    const storeHome = tmpDir();
    process.env["HASNA_PROJECTS_HOME"] = storeHome;
    try {
      const workspace = createWorkspace({ name: "Store Default", kind: "project", tags: ["kind:work-project"] }, db);
      expect(workspace.primary_path).toBe(join(storeHome, "workspaces", workspace.id));
      const inspection = inspectProjectStore(workspace);
      expect(inspection.paths.data_path).toBe(join(storeHome, "data", workspace.id));
      expect(inspection.primary_is_canonical).toBe(true);
      expect(listWorkspaceLocations(workspace.id, db)[0]?.kind).toBe("local");
    } finally {
      if (previousHome === undefined) delete process.env["HASNA_PROJECTS_HOME"];
      else process.env["HASNA_PROJECTS_HOME"] = previousHome;
      rmSync(storeHome, { recursive: true, force: true });
      db.close();
    }
  });

  test("rejects unsafe custom workspace IDs before deriving store paths", () => {
    const db = makeDb();
    const previousHome = process.env["HASNA_PROJECTS_HOME"];
    const storeHome = tmpDir();
    process.env["HASNA_PROJECTS_HOME"] = storeHome;
    try {
      expect(() => projectWorkspaceStorePath("../escape")).toThrow(/Invalid workspace id/);
      expect(() => createWorkspace({ id: "../escape", name: "Bad ID", kind: "project" }, db)).toThrow(/Invalid workspace id/);
      expect(() => createWorkspace({ id: "wks_bad/escape", name: "Bad Slash", kind: "project" }, db)).toThrow(/Invalid workspace id/);
    } finally {
      if (previousHome === undefined) delete process.env["HASNA_PROJECTS_HOME"];
      else process.env["HASNA_PROJECTS_HOME"] = previousHome;
      rmSync(storeHome, { recursive: true, force: true });
      db.close();
    }
  });

  test("enforces authoritative finance metadata across create, plan, update, and import", async () => {
    const db = makeDb();
    const financeMetadata = {
      business_area: " Finance ",
      jurisdiction: " ro ",
      legal_entities: [" Example Alpha SRL "],
      fiscal_cycle: " MONTHLY ",
      data_classification: " Restricted ",
      retention_policy: " knowledge:finance-retention-v1 ",
      ledger_authority: " @hasna/accounting ",
      evidence_store: " @hasna/files ",
      approver: " role:finance-controller ",
      external_recipient_policy: " @hasna/invoices:approved-recipient-only ",
    };
    const importRoot = tmpDir();
    const importPath = join(importRoot, "monthly-filing");
    mkdirSync(importPath);
    try {
      const taggedOnly = createWorkspace({
        name: "Finance Tag Only",
        tags: ["finance"],
        metadata: { owner: "tests" },
      }, db);
      expect(taggedOnly.metadata).toEqual({ owner: "tests" });

      expect(() => createWorkspace({
        name: "Incomplete Finance",
        metadata: {
          business_area: "finance",
          ledger_authority: "@hasna/accounting",
        },
      }, db)).toThrow(/missing required fields/i);
      expect(() => planWorkspaceCreation({
        name: "Incomplete Finance Plan",
        metadata: { business_area: "finance" },
      }, { db })).toThrow(/missing required fields/i);

      const created = createWorkspace({
        name: "Monthly Filing",
        slug: "monthly-filing",
        metadata: financeMetadata,
      }, db);
      expect(created.metadata).toMatchObject({
        business_area: "finance",
        jurisdiction: "RO",
        legal_entities: ["Example Alpha SRL"],
        fiscal_cycle: "monthly",
        data_classification: "restricted",
        ledger_authority: "@hasna/accounting",
        evidence_store: "@hasna/files",
      });
      expect(() => updateWorkspace(created.id, {
        metadata: { owner: "replacement-without-finance-authority" },
      }, db)).toThrow(/missing required fields/i);

      process.env[PROJECTS_DB_PATH_ENV] = ":memory:";
      delete process.env["HASNA_PROJECTS_API_URL"];
      delete process.env["HASNA_PROJECTS_API_KEY"];
      closeDatabase();
      __resetProjectStore();
      const store = resolveProjectStore({});
      const rejectedImport = await importWorkspace(store, importPath, {
        metadata: {
          business_area: "finance",
          evidence_store: "@hasna/files",
        },
      });
      expect(rejectedImport.error).toMatch(/missing required fields/i);
      expect(await store.listProjects({ query: "monthly-filing" })).toHaveLength(0);

      const imported = await importWorkspace(store, importPath, { metadata: financeMetadata });
      expect(imported.error).toBeUndefined();
      expect(imported.workspace?.metadata).toMatchObject({
        business_area: "finance",
        jurisdiction: "RO",
        fiscal_cycle: "monthly",
        ledger_authority: "@hasna/accounting",
        evidence_store: "@hasna/files",
      });
    } finally {
      closeDatabase();
      __resetProjectStore();
      delete process.env[PROJECTS_DB_PATH_ENV];
      rmSync(importRoot, { recursive: true, force: true });
      db.close();
    }
  });

  test("plans and applies safe migration into the canonical workspace store", () => {
    const db = makeDb();
    const previousHome = process.env["HASNA_PROJECTS_HOME"];
    const storeHome = tmpDir();
    const sourceDir = tmpDir();
    mkdirSync(join(sourceDir, ".git"));
    writeFileSync(join(sourceDir, "README.md"), "# migrated\n");
    process.env["HASNA_PROJECTS_HOME"] = storeHome;
    try {
      const workspace = createWorkspace({
        name: "Migrated Store",
        kind: "project",
        primary_path: sourceDir,
        tags: ["client:example"],
      }, db);
      const plan = planProjectStoreMigration(workspace);
      expect(plan.can_apply).toBe(true);
      expect(plan.source_path).toBe(sourceDir);
      expect(plan.target_path).toBe(join(storeHome, "workspaces", workspace.id));
      expect(plan.actions.some((action) => action.action === "move")).toBe(true);
      expect(existsSync(sourceDir)).toBe(true);

      const result = migrateProjectToStore(workspace, { db, apply: true, source: "cli", command: "projects store migrate --apply" });
      expect(result.verified).toBe(true);
      expect(result.project.primary_path).toBe(join(storeHome, "workspaces", workspace.id));
      expect(existsSync(sourceDir)).toBe(false);
      expect(existsSync(join(result.target_path, ".git"))).toBe(true);
      expect(existsSync(join(result.target_path, ".project.json"))).toBe(true);
      expect(existsSync(result.plan_artifact_path!)).toBe(true);
      const locations = listWorkspaceLocations(workspace.id, db);
      expect(locations.some((location) => location.label === "previous-primary" && location.path === sourceDir)).toBe(true);
      expect(locations.some((location) => location.label === "canonical" && location.is_primary)).toBe(true);
    } finally {
      if (previousHome === undefined) delete process.env["HASNA_PROJECTS_HOME"];
      else process.env["HASNA_PROJECTS_HOME"] = previousHome;
      rmSync(storeHome, { recursive: true, force: true });
      rmSync(sourceDir, { recursive: true, force: true });
      db.close();
    }
  });

  test("rolls back the directory move when store migration fails after moving files", () => {
    const db = makeDb();
    const previousHome = process.env["HASNA_PROJECTS_HOME"];
    const storeHome = tmpDir();
    const sourceDir = tmpDir();
    mkdirSync(join(sourceDir, ".git"));
    writeFileSync(join(sourceDir, "README.md"), "# rollback\n");
    chmodSync(sourceDir, 0o555);
    process.env["HASNA_PROJECTS_HOME"] = storeHome;
    try {
      const workspace = createWorkspace({
        name: "Rollback Store",
        kind: "project",
        primary_path: sourceDir,
      }, db);

      expect(() => migrateProjectToStore(workspace, { db, apply: true, source: "cli", command: "projects store migrate --apply" })).toThrow();
      expect(existsSync(sourceDir)).toBe(true);
      expect(existsSync(join(sourceDir, ".git"))).toBe(true);
      expect(existsSync(join(storeHome, "workspaces", workspace.id))).toBe(false);
      expect((getWorkspaceBySlug(workspace.slug, db) ?? workspace).primary_path).toBe(sourceDir);
    } finally {
      chmodSync(sourceDir, 0o755);
      if (previousHome === undefined) delete process.env["HASNA_PROJECTS_HOME"];
      else process.env["HASNA_PROJECTS_HOME"] = previousHome;
      rmSync(storeHome, { recursive: true, force: true });
      rmSync(sourceDir, { recursive: true, force: true });
      db.close();
    }
  });

  test("creates roots, recipes, agents, workspaces, locations, and events", () => {
    const db = makeDb();
    const rootPath = tmpDir();
    const root = createRoot({
      slug: "test-root",
      name: "Test Root",
      base_path: rootPath,
      tags: ["test", "root"],
      default_kind: "open-source",
      path_template: "open-{slug}",
      github_org: "hasna",
      repo_visibility: "public",
    }, db);
    const recipe = createRecipe({
      slug: "open-source-ts",
      name: "Open Source TypeScript",
      kind: "open-source",
      default_tags: ["typescript"],
      steps: [{ type: "mkdir", path: "{path}/src" }],
    }, db);
    const agent = createAgent({
      slug: "codex",
      name: "Codex",
      kind: "ai",
      provider: "openrouter",
      model: "openai/gpt-4o-mini",
      role: "creator",
      permissions: ["workspace:create"],
    }, db);

    const workspace = createWorkspace({
      name: "Open Logs",
      root_id: root.id,
      recipe_id: recipe.id,
      agent_id: agent.id,
      source: "agent",
      prompt: "create an open source logging project",
      tags: ["logs"],
    }, db);

    expect(workspace.id).toMatch(/^wks_/);
    expect(workspace.kind).toBe("open-source");
    expect(workspace.primary_path).toBe(join(rootPath, "open-open-logs"));
    expect(workspace.tags.sort()).toEqual(["logs", "root", "test", "typescript"].sort());
    expect(getWorkspaceByPath(workspace.primary_path!, db)?.id).toBe(workspace.id);
    expect(listWorkspaceLocations(workspace.id, db)).toHaveLength(1);
    expect(listWorkspaceEvents(workspace.id, db).map((event) => event.event_type)).toContain("created");
    const creatorAssignments = listWorkspaceAgents(workspace.id, db);
    expect(creatorAssignments).toHaveLength(1);
    expect(creatorAssignments[0]?.role).toBe("creator");
    expect(creatorAssignments[0]?.agent?.slug).toBe("codex");
    expect(listRoots(db)).toHaveLength(1);
    expect(listWorkspaces({ tags: ["typescript"] }, db)).toHaveLength(1);

    for (let index = 0; index < 30; index++) {
      createWorkspace({
        name: `Alpha Untagged ${index.toString().padStart(2, "0")}`,
        slug: `alpha-untagged-${index}`,
      }, db);
    }
    createWorkspace({ name: "Zulu Tagged", slug: "zulu-tagged", tags: ["target"] }, db);
    expect(listWorkspaces({ tags: ["target"], limit: 1 }, db).map((item) => item.slug)).toEqual(["zulu-tagged"]);

    createWorkspace({ id: "wks_aaaaaaaaaaaa", name: "Stable Tie", slug: "stable-tie-a" }, db);
    createWorkspace({ id: "wks_zzzzzzzzzzzz", name: "Stable Tie", slug: "stable-tie-z" }, db);
    expect(listWorkspaces({ query: "Stable Tie", limit: 1, offset: 0 }, db)[0]?.id).toBe("wks_aaaaaaaaaaaa");
    expect(listWorkspaces({ query: "Stable Tie", limit: 1, offset: 1 }, db)[0]?.id).toBe("wks_zzzzzzzzzzzz");

    const secondaryPath = tmpDir();
    const secondary = addWorkspaceLocation({
      workspace_id: workspace.id,
      path: secondaryPath,
      label: "secondary",
      metadata: { purpose: "alternate folder" },
      agent_id: agent.id,
      source: "cli",
      command: "projects locations add",
    }, db);
    expect(secondary.path).toBe(secondaryPath);
    expect(secondary.is_primary).toBe(false);
    expect(getWorkspaceByPath(secondaryPath, db)?.id).toBe(workspace.id);
    expect(listWorkspacesByPath(secondaryPath, db).map((item) => item.id)).toEqual([workspace.id]);
    expect(listWorkspaceEvents(workspace.id, db).map((event) => event.event_type)).toContain("location_added");

    const owner = createAgent({ name: "Owner", slug: "owner", kind: "human" }, db);
    const assignment = assignAgentToWorkspace(workspace.id, owner.id, "owner", agent.id, { scope: "project" }, db);
    expect(assignment.role).toBe("owner");
    expect(assignment.agent?.slug).toBe("owner");
    expect(assignment.metadata.scope).toBe("project");
    expect(listWorkspaceAgents(workspace.id, db).map((item) => item.role).sort()).toEqual(["creator", "owner"]);

    rmSync(rootPath, { recursive: true });
    rmSync(secondaryPath, { recursive: true });
    db.close();
  });

  test("records agent runs", () => {
    const db = makeDb();
    const agent = createAgent({ name: "Prompt Agent", slug: "prompt-agent", kind: "ai", provider: "openrouter", model: "test/model" }, db);
    const run = startAgentRun({ agent_id: agent.id, provider: "openrouter", model: "test/model", prompt: "create a thing", plan: { steps: 1 } }, db);
    expect(run.status).toBe("running");
    const completed = completeAgentRun(run.id, { result: { ok: true }, tool_calls: [{ name: "workspace_create" }] }, db);
    expect(completed.status).toBe("completed");
    expect(completed.result_json?.["ok"]).toBe(true);
    expect(completed.tool_calls_json[0]?.["name"]).toBe("workspace_create");
    expect(listAgentRuns({ agent_id: agent.id }, db)).toHaveLength(1);
    db.close();
  });

  // Regression: in the hosted backend a prompt run creates the project in the hosted backend
  // registry, so its id is NOT present in the local workspaces table. The on-box
  // run ledger must record the run without FK-failing on that hosted id (it nulls
  // the workspace_id rather than throwing "FOREIGN KEY constraint failed").
  test("agent run ledger nulls a workspace_id that does not exist locally", () => {
    const db = makeDb();
    const agent = createAgent({ name: "Cloud Agent", slug: "cloud-agent", kind: "ai", provider: "openrouter", model: "test/model" }, db);
    const run = startAgentRun({ agent_id: agent.id, workspace_id: "wks_cloud_only", prompt: "make it", model: "test/model" }, db);
    expect(run.workspace_id).toBeNull();
    const completed = completeAgentRun(run.id, { workspace_id: "wks_cloud_only", result: { ok: true } }, db);
    expect(completed.status).toBe("completed");
    expect(completed.workspace_id).toBeNull();
    db.close();
  });

  test("seeds built-in workspace recipes idempotently", () => {
    const db = makeDb();
    expect(builtInWorkspaceRecipes().map((recipe) => recipe.slug)).toContain("open-source-typescript-cli");
    const first = ensureBuiltInWorkspaceRecipes(db);
    expect(first.created).toHaveLength(10);
    const second = ensureBuiltInWorkspaceRecipes(db);
    expect(second.created).toHaveLength(0);
    expect(second.existing).toHaveLength(10);
    db.close();
  });

  test("updates, matches, and deletes roots with workspace detach safety", () => {
    const db = makeDb();
    const rootDir = tmpDir();
    const root = createRoot({
      name: "Policy Root",
      slug: "policy-root",
      base_path: rootDir,
      default_kind: "open-source",
      tags: ["open", "policy"],
      github_org: "hasna",
      repo_visibility: "public",
    }, db);
    const updated = updateRoot(root.id, {
      github_org: "hasnatools",
      tags: ["platform"],
      path_template: "platform-{slug}",
    }, db);
    expect(updated.github_org).toBe("hasnatools");
    expect(updated.path_template).toBe("platform-{slug}");
    expect(scoreRoots({ path: join(rootDir, "child"), kind: "open-source", github_org: "hasnatools" }, db)[0]?.root.id).toBe(root.id);

    const workspace = createWorkspace({ name: "Rooted", root_id: root.id, kind: "open-source" }, db);
    expect(() => deleteRoot(root.id, {}, db)).toThrow(/used by 1 workspace/);
    const deleted = deleteRoot(root.id, { detachWorkspaces: true }, db);
    expect(deleted.detached_workspaces).toBe(1);
    expect(updateWorkspace(workspace.id, { name: "Detached Rooted" }, db).root_id).toBeNull();
    rmSync(rootDir, { recursive: true });
    db.close();
  });

  test("enforces root allowed agents, allowed recipes, and agent permissions", () => {
    const db = makeDb();
    const rootDir = tmpDir();
    const allowedAgent = createAgent({ name: "Allowed", slug: "allowed", kind: "human", permissions: ["workspace:create"] }, db);
    const blockedAgent = createAgent({ name: "Blocked", slug: "blocked", kind: "human", permissions: ["workspace:update"] }, db);
    const recipe = createRecipe({ name: "Allowed Recipe", slug: "allowed-recipe", kind: "docs" }, db);
    const root = createRoot({
      name: "Policy Root",
      slug: "policy-enforced-root",
      base_path: rootDir,
      allowed_agents: [allowedAgent.slug],
      allowed_recipes: [recipe.slug],
      path_template: "{slug}",
    }, db);

    expect(() => createWorkspace({ name: "Blocked Agent", root_id: root.id, recipe_id: recipe.id, agent_id: blockedAgent.id }, db)).toThrow(/permission workspace:create|does not allow agent/);
    expect(() => createWorkspace({ name: "Blocked Recipe", root_id: root.id, agent_id: allowedAgent.id }, db)).toThrow(/does not allow recipe/);
    const workspace = createWorkspace({ name: "Allowed Workspace", root_id: root.id, recipe_id: recipe.id, agent_id: allowedAgent.id }, db);
    expect(workspace.root_id).toBe(root.id);
    rmSync(rootDir, { recursive: true });
    db.close();
  });

  test("manages tmux profiles and renders workspace profile specs", () => {
    const db = makeDb();
    const dir = tmpDir();
    const workspace = createWorkspace({ name: "Profile App", primary_path: dir, kind: "generic" }, db);
    const profile = createTmuxProfile({
      name: "Dev Profile",
      slug: "dev-profile",
      session_template: "{slug}-dev",
      windows: [{ window_name_template: "editor", path_template: "{path}", window_index: 0 }],
    }, db);
    addTmuxProfileWindow({ profile_id: profile.id, window_name_template: "server", command: "bun run dev", window_index: 1 }, db);

    const windows = listTmuxProfileWindows(profile.id, db);
    expect(resolveTmuxProfile("dev-profile", db)?.id).toBe(profile.id);
    expect(windows).toHaveLength(2);
    const spec = tmuxProfileToSpec(workspace, profile, windows);
    expect(spec.session).toBe("profile-app-dev");
    expect(spec.windows.map((window) => window.name)).toEqual(["editor", "server"]);
    const dryRun = applyWorkspaceTmuxProfile(workspace, profile, windows, { dryRun: true });
    expect(dryRun.session_action).toBe("planned");
    expect(dryRun.windows).toHaveLength(2);
    rmSync(dir, { recursive: true });
    db.close();
  });

  test("plans and executes workspace creation with locks and rollback records", async () => {
    const db = makeDb();
    const rootDir = tmpDir();
    const root = createRoot({ name: "Plan Root", slug: "plan-root", base_path: rootDir, path_template: "{slug}" }, db);
    const profile = createTmuxProfile({
      name: "Plan Profile",
      slug: "plan-profile",
      session_template: "{slug}-dev",
      windows: [{ window_name_template: "editor" }],
    }, db);

    const plan = planWorkspaceCreation({
      name: "Planned App",
      root_id: root.id,
      createDirectory: true,
      gitInit: true,
      writeMarker: true,
      tmux_profile: profile.slug,
      source: "cli",
    }, { db });

    expect(plan.workspace.slug).toBe("planned-app");
    expect(plan.workspace.primary_path).toBe(join(rootDir, "planned-app"));
    expect(plan.db_writes.map((write) => write.target)).toContain("workspaces");
    expect(plan.runtime_actions.map((action) => action.type)).toEqual(["mkdir", "git_init", "workspace_marker"]);
    expect(plan.tmux?.session_name).toBe("planned-app-dev");
    expect(plan.locks.map((lock) => lock.key)).toContain(`workspace-path:${join(rootDir, "planned-app")}`);
    expect(plan.rollback_actions.some((action) => action.action === "remove_file")).toBe(true);

    const dryRun = await executeWorkspaceCreation({
      name: "Dry Planned App",
      root_id: root.id,
      createDirectory: true,
      writeMarker: true,
    }, { db, dryRun: true });
    expect(dryRun.dry_run).toBe(true);
    expect(listWorkspaces({}, db)).toHaveLength(0);

    const executed = await executeWorkspaceCreation({
      name: "Planned App",
      root_id: root.id,
      createDirectory: true,
      writeMarker: true,
      tmux_profile: profile.slug,
    }, { db, runtimeDryRun: true });
    expect(executed.success).toBe(true);
    expect(executed.workspace?.primary_path).toBe(join(rootDir, "planned-app"));
    expect(executed.prepare.every((action) => action.status === "planned")).toBe(true);
    expect(listWorkspaceLocks(db)).toHaveLength(0);
    expect(listWorkspaceEvents(executed.workspace!.id, db).some((event) => event.event_type === "creation_runtime_planned")).toBe(true);

    rmSync(rootDir, { recursive: true });
    db.close();
  });

  test("preserves an explicit workspace slug by default in planning and local creation", () => {
    const db = makeDb();
    try {
      const planned = planWorkspaceCreation({
        name: "Team One",
        slug: "Team_One",
      }, { db });
      const created = createWorkspace({
        name: "Team One",
        slug: "Team_One",
      }, db);

      expect(planned.workspace.slug).toBe("Team_One");
      expect(created.slug).toBe("Team_One");
    } finally {
      db.close();
    }
  });

  test("cleans up workspace creation artifacts from rollback records", async () => {
    const db = makeDb();
    const rootDir = tmpDir();
    const root = createRoot({ name: "Cleanup Root", slug: "cleanup-root", base_path: rootDir, path_template: "{slug}" }, db);

    const executed = await executeWorkspaceCreation({
      name: "Cleanup App",
      root_id: root.id,
      createDirectory: true,
      writeMarker: true,
    }, { db });
    const workspace = executed.workspace!;
    const markerPath = join(workspace.primary_path!, ".project.json");
    expect(existsSync(workspace.primary_path!)).toBe(true);
    expect(existsSync(markerPath)).toBe(true);

    const preview = cleanupWorkspaceCreation(executed.plan, { db, dryRun: true });
    expect(preview.dry_run).toBe(true);
    expect(preview.actions.every((action) => action.status === "planned" || action.status === "skipped")).toBe(true);
    expect(getWorkspaceBySlug(workspace.slug, db)?.id).toBe(workspace.id);

    const cleanup = cleanupWorkspaceCreation(executed.plan, { db });
    expect(cleanup.success).toBe(true);
    expect(getWorkspaceBySlug(workspace.slug, db)).toBeNull();
    expect(existsSync(markerPath)).toBe(false);
    expect(existsSync(workspace.primary_path!)).toBe(false);
    expect(cleanup.actions.some((action) => action.action === "remove_empty_directory" && action.status === "completed")).toBe(true);

    rmSync(rootDir, { recursive: true, force: true });
    db.close();
  });

  test("updates, archives, searches, and deletes workspaces with events", () => {
    const db = makeDb();
    const dir = tmpDir();
    const workspace = createWorkspace({
      name: "Mutable Workspace",
      slug: "mutable-workspace",
      primary_path: dir,
      kind: "generic",
      tags: ["before"],
    }, db);

    const updated = updateWorkspace(workspace.id, {
      name: "Renamed Workspace",
      description: "searchable replacement workspace",
      tags: ["after", "replacement"],
      metadata: { owner: "tests" },
      source: "cli",
      command: "workspaces update",
    }, db);
    expect(updated.name).toBe("Renamed Workspace");
    expect(updated.tags.sort()).toEqual(["after", "replacement"]);
    expect(listWorkspaces({ query: "searchable" }, db).map((item) => item.id)).toContain(workspace.id);

    expect(archiveWorkspace(workspace.id, { source: "cli", command: "workspaces archive" }, db).status).toBe("archived");
    expect(unarchiveWorkspace(workspace.id, { source: "cli", command: "workspaces unarchive" }, db).status).toBe("active");
    const deleted = deleteWorkspace(workspace.id, { source: "cli", command: "workspaces delete" }, db);
    expect(deleted.hard).toBe(false);
    expect(deleted.workspace.status).toBe("deleted");
    expect(listWorkspaceEvents(workspace.id, db).map((event) => event.event_type)).toEqual([
      "created",
      "updated",
      "updated",
      "updated",
      "updated",
    ]);

    rmSync(dir, { recursive: true });
    db.close();
  });

  test("writes markers, diagnoses workspaces, imports folders, matches roots, and manages locks", async () => {
    // Import/registry ops now route through the Store, so bind fixtures and the
    // store to one shared global in-memory db.
    process.env[PROJECTS_DB_PATH_ENV] = ":memory:";
    delete process.env["HASNA_PROJECTS_API_URL"];
    delete process.env["HASNA_PROJECTS_API_KEY"];
    closeDatabase();
    __resetProjectStore();
    const db = getDatabase();
    const store = resolveProjectStore({});
    const rootDir = tmpDir();
    const childDir = join(rootDir, "tooling");
    mkdirSync(childDir);
    writeFileSync(join(childDir, "package.json"), JSON.stringify({ name: "tooling-kit" }));
    mkdirSync(join(childDir, "docs"));
    writeFileSync(join(childDir, ".project.json"), JSON.stringify({ name: "Legacy Tooling" }));
    const root = createRoot({ name: "Import Root", slug: "import-root", base_path: rootDir, path_template: "{slug}" }, db);

    const preview = await planWorkspaceImport(store, childDir, { tags: ["imported"], metadata: { domain: "tools" } });
    expect(preview.name).toBe("Legacy Tooling");
    expect(preview.root_id).toBe(root.id);
    expect(preview.metadata.domain).toBe("tools");
    expect(preview.signals).toContain("project-marker");
    expect(preview.signals).toContain("scaffold-dir:docs");
    expect(matchRootForPath(childDir, db)?.id).toBe(root.id);

    const scan = await importRegisteredRoots(store, { dryRun: true, tags: ["scan"] });
    expect(scan.dry_run).toBe(true);
    expect(scan.previews.some((item) => item.path === childDir && item.tags.includes("scan"))).toBe(true);

    const pathLock = acquireWorkspaceLock({ lock_key: `workspace-path:${childDir}`, reason: "import conflict" }, db);
    const blockedImport = await importWorkspace(store, childDir, { tags: ["imported"] });
    expect(blockedImport.error).toMatch(/Workspace lock already held/);
    expect(listWorkspaceLocks(db).map((item) => item.lock_key)).not.toContain("workspace-slug:legacy-tooling");
    expect(releaseWorkspaceLock(pathLock.lock_key, pathLock.id, db)).toBe(true);

    const imported = await importWorkspace(store, childDir, { tags: ["imported"], metadata: { domain: "tools" } });
    expect(imported.workspace?.slug).toBe("legacy-tooling");
    const workspace = imported.workspace!;
    expect(workspace.metadata.domain).toBe("tools");
    expect(workspace.metadata.import_signals).toContain("project-marker");
    const beforeFix = doctorWorkspace(workspace, {}, db);
    expect(beforeFix.checks.some((check) => check.code === "WORKSPACE_MARKER_MISMATCH")).toBe(true);
    const dryRunFix = doctorWorkspace(workspace, { fix: true, dryRun: true }, db);
    expect(dryRunFix.fixes.some((fix) => fix.code === "FIX_WORKSPACE_MARKER" && fix.dryRun)).toBe(true);
    prepareWorkspaceDirectory(workspace, { writeMarker: true, recordEvents: false });
    expect(workspaceMarkerPath(workspace)).toBe(join(childDir, ".project.json"));
    expect(doctorWorkspace(workspace, {}, db).checks.some((check) => check.code === "WORKSPACE_MARKER_OK")).toBe(true);

    const lock = acquireWorkspaceLock({ lock_key: "workspace:test", workspace_id: workspace.id, reason: "test" }, db);
    expect(lock.lock_key).toBe("workspace:test");
    expect(listWorkspaceLocks(db)).toHaveLength(1);
    expect(releaseWorkspaceLock(lock.lock_key, lock.id, db)).toBe(true);
    expect(listWorkspaceLocks(db)).toHaveLength(0);

    rmSync(rootDir, { recursive: true });
    db.close();
  });

  // Regression 6692dc56: releaseWorkspaceLock used to DELETE by lock_key alone,
  // so a holder whose guarded mutation outlived the 600s TTL had its row pruned
  // and re-acquired by a successor, and the stale holder's finally-block release
  // then deleted the successor's LIVE lock — mutual exclusion silently defeated.
  // Release must be holder-scoped by the lock row's unique id.
  test("a stale holder's release cannot delete a successor's lock (release is holder-scoped by lock id)", () => {
    const db = makeDb();
    const key = "workspace:regression-6692dc56";

    // Holder A acquires exactly the way LocalProjectStore.withLock does (ttl 600).
    const holderA = acquireWorkspaceLock({ lock_key: key, reason: "guarded update", ttl_seconds: 600 }, db);
    expect(holderA.id).toBeTruthy();

    // Time passes past the 600s TTL while A's guarded mutation is still running.
    // The next acquire prunes the expired row internally (acquireWorkspaceLock
    // calls its private clearExpiredLocks at entry — the same code path that
    // makes the successor acquire legitimately succeed).
    db.run("UPDATE workspace_locks SET expires_at = datetime('now', '-1 second') WHERE lock_key = ?", [key]);

    // Holder B acquires the same key after the expiry — mutual exclusion
    // legitimately re-opens.
    const holderB = acquireWorkspaceLock({ lock_key: key, reason: "guarded update", ttl_seconds: 600 }, db);
    expect(holderB.id).not.toBe(holderA.id);

    // A's finally block runs the scoped release with A's own lock id. It must
    // NOT delete B's live lock, and must report that it released nothing.
    expect(releaseWorkspaceLock(key, holderA.id, db)).toBe(false);
    const remaining = listWorkspaceLocks(db);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(holderB.id);

    // B's own holder-scoped release still works.
    expect(releaseWorkspaceLock(key, holderB.id, db)).toBe(true);
    expect(listWorkspaceLocks(db)).toHaveLength(0);

    db.close();
  });

  test("renders templates and infers kinds from existing conventions", () => {
    expect(renderTemplate("{kind}/{slug}", { kind: "open-source", slug: "open-logs" })).toBe("open-source/open-logs");
    expect(inferWorkspaceKind("open-logs", "/home/hasna/workspace/hasna/opensource/open-logs")).toBe("open-source");
    expect(inferWorkspaceKind("iapp-news", "/home/hasna/workspace/hasnaxyz/internalapp/iapp-news")).toBe("internal-app");
    expect(inferWorkspaceKind("platform-mcps", "/home/hasna/workspace/hasnatools/platform/platform-mcps")).toBe("platform");
    expect(inferWorkspaceKind("cweb-hasna", "/home/hasna/workspace/hasnaxyz/companywebsite/cweb-hasna")).toBe("company-website");
    expect(inferWorkspaceKind("community-kit", "/home/hasna/workspace/hasna/community/community-kit")).toBe("community");
    expect(inferWorkspaceKind("anything", "/future/path", ["remote-only"])).toBe("remote-only");
  });
});

describe("legacy project migration", () => {
  test("migrates existing project rows into workspaces once", () => {
    const db = makeDb();
    const dir = tmpDir();
    const workdirPath = join(dir, "legacy-workdir");
    mkdirSync(workdirPath, { recursive: true });
    const project = {
      id: "prj_legacy",
      slug: "open-legacy",
      path: dir,
    };
    db.run(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        path TEXT UNIQUE NOT NULL,
        s3_bucket TEXT,
        s3_prefix TEXT,
        git_remote TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        integrations TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        synced_at TEXT,
        last_opened_at TEXT
      )
    `);
    db.run(
      `INSERT INTO projects (id, slug, name, description, status, path, s3_bucket, s3_prefix, git_remote, tags, integrations, created_at, updated_at, synced_at, last_opened_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        project.id,
        project.slug,
        "Legacy Open",
        null,
        "active",
        project.path,
        null,
        null,
        null,
        JSON.stringify(["legacy"]),
        "{}",
        "2026-01-01 00:00:00.000",
        "2026-01-01 00:00:00.000",
        null,
        null,
      ],
    );
    db.run(`
      CREATE TABLE project_workdirs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        path TEXT NOT NULL,
        machine_id TEXT NOT NULL,
        label TEXT,
        is_primary INTEGER,
        claude_md_generated INTEGER,
        agents_md_generated INTEGER,
        created_at TEXT
      )
    `);
    db.run(
      `INSERT INTO project_workdirs (id, project_id, path, machine_id, label, is_primary, claude_md_generated, agents_md_generated, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "legacy_workdir_1",
        project.id,
        workdirPath,
        "legacy-machine",
        "laptop",
        1,
        1,
        0,
        "2026-01-02 00:00:00.000",
      ],
    );

    const first = migrateLegacyProjectsToWorkspaces(db);
    expect(first.migrated).toBe(1);
    expect(first.skipped).toBe(0);
    expect(first.workdirs_migrated).toBe(1);
    expect(first.validation.valid).toBe(true);
    expect(first.validation.workdir_source_count).toBe(1);
    expect(first.samples[0]?.old_project_id).toBe(project.id);
    const workspace = getWorkspaceByPath(workdirPath, db);
    expect(workspace?.slug).toBe("open-legacy");
    expect(workspace?.metadata["migrated_from_project_id"]).toBe(project.id);
    const locations = listWorkspaceLocations(workspace!.id, db);
    const migratedWorkdir = locations.find((location) => location.machine_id === "legacy-machine");
    expect(migratedWorkdir?.path).toBe(workdirPath);
    expect(migratedWorkdir?.is_primary).toBe(true);
    expect(migratedWorkdir?.metadata["migrated_from_workdir_id"]).toBe("legacy_workdir_1");
    expect(doctorWorkspace(workspace!, {}, db).checks.some((check) => check.code === "WORKSPACE_MIGRATION_MAP_OK")).toBe(true);
    expect(listWorkspaceEvents(workspace!.id, db).some((event) => event.source === "migration")).toBe(true);

    const second = migrateLegacyProjectsToWorkspaces(db);
    expect(second.migrated).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.workdirs_skipped).toBe(1);
    expect(second.validation.valid).toBe(true);

    rmSync(dir, { recursive: true });
    db.close();
  });
});

describe("registry fixture exclusion", () => {
  test("listWorkspaces and countWorkspaces exclude registry-fixture rows when asked", () => {
    const db = makeDb();
    const root = tmpDir();
    try {
      const real = createWorkspace({
        name: "Real Project",
        slug: "real-project",
        kind: "generic",
        primary_path: join(root, "real-project"),
      }, db);
      const fixture = createWorkspace({
        name: "Fixture Project",
        slug: "http-compact-project-1",
        kind: "generic",
        tags: ["registry-fixture"],
        primary_path: join(root, "http-compact-project-1"),
      }, db);

      expect(real.tags).toEqual([]);
      expect(fixture.tags).toEqual(["registry-fixture"]);

      // Default (no exclude flag) returns every row.
      expect(listWorkspaces({ limit: 100 }, db).map((w) => w.slug).sort()).toEqual(["http-compact-project-1", "real-project"].sort());
      expect(countWorkspaces({}, db)).toBe(2);

      // With the exclusion, the fixture row disappears from both list and count.
      const excluded = listWorkspaces({ exclude_registry_fixtures: true, limit: 100 }, db);
      expect(excluded.map((w) => w.slug)).toEqual(["real-project"]);
      expect(countWorkspaces({ exclude_registry_fixtures: true }, db)).toBe(1);

      // The exclusion composes with a tag filter: explicitly requesting the
      // fixture tag still honours the exclusion by default.
      const tagged = listWorkspaces({ tags: ["registry-fixture"], exclude_registry_fixtures: true, limit: 100 }, db);
      expect(tagged.map((w) => w.slug)).toEqual([]);

      // And without the exclusion, the tag filter still finds the fixture.
      const taggedAll = listWorkspaces({ tags: ["registry-fixture"], limit: 100 }, db);
      expect(taggedAll.map((w) => w.slug)).toEqual(["http-compact-project-1"]);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
