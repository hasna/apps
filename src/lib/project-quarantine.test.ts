import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  addWorkspaceLocation,
  createWorkspace,
  getWorkspace,
  listProjectResourceLinks,
  listWorkspaceLocations,
  mutateProjectResourceLinks,
  quarantineDuplicateProject,
  readDuplicateProjectQuarantinePreimage,
  rollbackDuplicateProjectQuarantine,
  updateWorkspace,
} from "../db/workspaces.js";
import { runMigrations } from "../db/schema.js";
import type {
  ProjectQuarantineReadResult,
  ProjectQuarantineRequest,
  ProjectResourceLinkInput,
} from "../types/workspace.js";

function makeDb(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys=ON");
  runMigrations(db);
  return db;
}

function links(): ProjectResourceLinkInput[] {
  return [
    {
      authority: "conversations",
      service_instance: "urn:hasna:conversations:test",
      source_package: "@hasna/conversations",
      target_kind: "channel",
      locator: { kind: "conversations_channel_id", value: "chn_1012ddb87c8f033cb40fdead018cdfc8" },
      scope: "collection",
      labels: { channel_name: "fleet-resources" },
    },
    {
      authority: "todos",
      service_instance: "urn:hasna:todos:test",
      source_package: "@hasna/todos",
      target_kind: "project",
      locator: { kind: "canonical_uri", value: "urn:hasna:todos:project:d736e48e-8267-4d91-b76d-9ab1d4015db8" },
      scope: "collection",
      labels: { name: "Fleet Resources" },
    },
  ];
}

function seed(db: Database): ProjectQuarantineReadResult {
  const project = createWorkspace({
    id: "wks_quarantinefixture0001",
    name: "Fleet Resources Duplicate",
    slug: "fleet-resources-duplicate",
    primary_path: "/tmp/fleet-resources-duplicate",
    git_remote: "https://github.com/hasna/fleet-resources.git",
    integrations: { github_repo: "hasna/fleet-resources" },
    metadata: { retained: "provenance" },
  }, db);
  const linked = mutateProjectResourceLinks({
    project_id: project.id,
    operation_id: "seed-quarantine-links",
    step_id: "links",
    mode: "reconcile",
    expected_revision: project.updated_at,
    links: links(),
    integrations: {
      github_repo: "hasna/fleet-resources",
      conversations_channel: "fleet-resources",
      todos_project_id: "d736e48e-8267-4d91-b76d-9ab1d4015db8",
    },
    max_items: 10,
    response_byte_limit: 100_000,
    time_budget_ms: 5_000,
  }, db);
  expect(linked.outcome).toBe("accepted");
  addWorkspaceLocation({
    workspace_id: project.id,
    path: "/tmp/fleet-resources-secondary",
    machine_id: "station02",
    label: "secondary",
  }, db);
  return readDuplicateProjectQuarantinePreimage({
    project_id: project.id,
    resource_link_max_items: 10,
    workspace_location_max_items: 10,
    response_byte_limit: 100_000,
    time_budget_ms: 5_000,
  }, db);
}

function request(read: ProjectQuarantineReadResult, overrides: Partial<ProjectQuarantineRequest> = {}): ProjectQuarantineRequest {
  return {
    project_id: read.project_id,
    operation_id: "quarantine-fleet-resources",
    step_id: "quarantine-duplicate",
    expected_revision: read.current_revision,
    expected_project_digest: read.snapshot.project_digest,
    expected_resource_link_collection_digest: read.snapshot.resource_link_collection_digest,
    expected_resource_link_ids: read.snapshot.resource_links.map((link) => link.id),
    resource_link_max_items: 10,
    expected_workspace_location_collection_digest: read.snapshot.workspace_location_collection_digest,
    expected_workspace_location_ids: read.snapshot.workspace_locations.map((location) => location.id),
    workspace_location_max_items: 10,
    quarantine_name: "Fleet Resources Duplicate (provenance only)",
    quarantine_slug: "fleet-resources-duplicate-provenance",
    response_byte_limit: 100_000,
    time_budget_ms: 5_000,
    ...overrides,
  };
}

function domainState(db: Database, projectId: string) {
  return {
    project: getWorkspace(projectId, db),
    links: listProjectResourceLinks(projectId, 10, db),
    locations: listWorkspaceLocations(projectId, db),
  };
}

describe("duplicate project quarantine transaction", () => {
  test("atomically frees selectors and links, preserves the row, and restores the exact preimage", () => {
    const db = makeDb();
    const read = seed(db);
    const before = domainState(db, read.project_id);
    expect(read.complete).toBe(true);
    expect(read.truncated).toBe(false);
    expect(read.resource_link_count).toBe(2);
    expect(read.workspace_location_count).toBe(2);

    const accepted = quarantineDuplicateProject(request(read), db);
    expect(accepted.outcome).toBe("accepted");
    expect(JSON.stringify(accepted.receipt?.before)).toBe(JSON.stringify(read.snapshot));
    expect(accepted.after?.resource_links).toEqual([]);
    expect(accepted.after?.workspace_locations).toEqual([]);
    expect(accepted.after?.project).toMatchObject({
      status: "archived",
      primary_path: null,
      git_remote: null,
      integrations: {},
    });
    expect(getWorkspace(read.project_id, db)?.metadata.retained).toBe("provenance");
    expect(listProjectResourceLinks(read.project_id, 10, db)).toEqual([]);
    expect(listWorkspaceLocations(read.project_id, db)).toEqual([]);

    const duplicate = quarantineDuplicateProject(request(read), db);
    expect(duplicate.outcome).toBe("duplicate_of_accepted");
    expect(duplicate.receipt?.duplicate_of_receipt_id).toBe(accepted.receipt?.receipt_id);

    const rolledBack = rollbackDuplicateProjectQuarantine({
      project_id: read.project_id,
      operation_id: "rollback-fleet-resources-quarantine",
      step_id: "restore-duplicate",
      accepted_receipt_id: accepted.receipt!.receipt_id,
      expected_current_revision: accepted.rollback!.expected_current_revision,
      resource_link_max_items: 10,
      workspace_location_max_items: 10,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    }, db);
    expect(rolledBack.outcome).toBe("accepted");
    const restored = domainState(db, read.project_id);
    expect({ ...restored.project!, updated_at: before.project!.updated_at }).toEqual(before.project!);
    expect(restored.links).toEqual(before.links);
    expect(restored.locations).toEqual(before.locations);

    const duplicateRollback = rollbackDuplicateProjectQuarantine({
      project_id: read.project_id,
      operation_id: "rollback-fleet-resources-quarantine",
      step_id: "restore-duplicate",
      accepted_receipt_id: accepted.receipt!.receipt_id,
      expected_current_revision: accepted.rollback!.expected_current_revision,
      resource_link_max_items: 10,
      workspace_location_max_items: 10,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    }, db);
    expect(duplicateRollback.outcome).toBe("duplicate_of_accepted");
  });

  test("wrong revision, project digest, link digest/set, and path digest/set fail without domain writes", () => {
    const cases: Array<[string, (read: ProjectQuarantineReadResult) => Partial<ProjectQuarantineRequest>, string]> = [
      ["revision", () => ({ expected_revision: "2026-01-01 00:00:00" }), "stale_revision"],
      ["project digest", () => ({ expected_project_digest: "wrong-project-digest" }), "project_digest_mismatch"],
      ["link digest", () => ({ expected_resource_link_collection_digest: "wrong-link-digest" }), "resource_link_collection_digest_mismatch"],
      ["link set", (read) => ({ expected_resource_link_ids: read.snapshot.resource_links.slice(1).map((link) => link.id) }), "resource_link_target_set_mismatch"],
      ["path digest", () => ({ expected_workspace_location_collection_digest: "wrong-path-digest" }), "workspace_location_collection_digest_mismatch"],
      ["path set", (read) => ({ expected_workspace_location_ids: read.snapshot.workspace_locations.slice(1).map((location) => location.id) }), "workspace_location_target_set_mismatch"],
    ];
    for (const [label, alter, reason] of cases) {
      const db = makeDb();
      const read = seed(db);
      const before = domainState(db, read.project_id);
      const result = quarantineDuplicateProject(request(read, {
        operation_id: `quarantine-control-${label.replaceAll(" ", "-")}`,
        ...alter(read),
      }), db);
      expect(result.outcome, label).toBe("terminal_nonacceptance");
      expect(result.receipt?.reason, label).toBe(reason);
      expect(domainState(db, read.project_id), label).toEqual(before);
    }
  });

  test("incomplete link or path reads fail closed before mutation", () => {
    for (const limited of ["links", "locations"] as const) {
      const db = makeDb();
      const read = seed(db);
      const before = domainState(db, read.project_id);
      expect(() => quarantineDuplicateProject(request(read, limited === "links"
        ? {
            resource_link_max_items: 1,
            expected_resource_link_ids: read.snapshot.resource_links.slice(0, 1).map((link) => link.id),
          }
        : {
            workspace_location_max_items: 1,
            expected_workspace_location_ids: read.snapshot.workspace_locations.slice(0, 1).map((location) => location.id),
          }), db)).toThrow(/exceeds max_items/);
      expect(domainState(db, read.project_id)).toEqual(before);
    }
  });

  test("receipt failure rolls back metadata, typed links, locations, and events as one transaction", () => {
    const db = makeDb();
    const read = seed(db);
    const before = domainState(db, read.project_id);
    const eventsBefore = (db.query("SELECT COUNT(*) AS n FROM workspace_events").get() as { n: number }).n;
    db.run(`CREATE TRIGGER fail_quarantine_receipt
      BEFORE INSERT ON guarded_project_mutation_receipts
      WHEN NEW.outcome = 'accepted' AND NEW.operation_id = 'quarantine-fleet-resources'
      BEGIN SELECT RAISE(ABORT, 'injected quarantine receipt failure'); END`);

    expect(() => quarantineDuplicateProject(request(read), db)).toThrow(/injected quarantine receipt failure/);
    expect(domainState(db, read.project_id)).toEqual(before);
    expect((db.query("SELECT COUNT(*) AS n FROM workspace_events").get() as { n: number }).n).toBe(eventsBefore);
  });

  test("rollback refuses any post-quarantine drift and preserves the drifted postimage", () => {
    const db = makeDb();
    const read = seed(db);
    const accepted = quarantineDuplicateProject(request(read), db);
    updateWorkspace(read.project_id, { description: "changed after quarantine" }, db);
    const drifted = domainState(db, read.project_id);

    expect(() => rollbackDuplicateProjectQuarantine({
      project_id: read.project_id,
      operation_id: "rollback-drifted-quarantine",
      step_id: "restore-duplicate",
      accepted_receipt_id: accepted.receipt!.receipt_id,
      expected_current_revision: accepted.rollback!.expected_current_revision,
      resource_link_max_items: 10,
      workspace_location_max_items: 10,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    }, db)).toThrow(/drift/);
    expect(domainState(db, read.project_id)).toEqual(drifted);
  });
});
