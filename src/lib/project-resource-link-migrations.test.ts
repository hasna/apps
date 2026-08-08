import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  advanceProjectResourceLinkMigration,
  createWorkspace,
  mutateProjectResourceLinks,
  planProjectResourceLinkMigration,
  readProjectResourceLinkMigration,
  readProjectResourceLinks,
  rollbackProjectResourceLinkMigration,
} from "../db/workspaces.js";
import { runMigrations } from "../db/schema.js";
import type {
  ProjectResourceLinkInput,
  ProjectResourceLinkProducerEvidence,
} from "../types/workspace.js";

const BOUNDS = {
  response_byte_limit: 128_000,
  time_budget_ms: 5_000,
};

function makeDb(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys=ON");
  runMigrations(db);
  return db;
}

function todosProjectLink(): ProjectResourceLinkInput {
  return {
    authority: "todos",
    service_instance: "urn:hasna:todos:service:primary",
    source_package: "@hasna/todos",
    target_kind: "project",
    locator: {
      kind: "canonical_uri",
      value: "urn:hasna:todos:project:434a687f-6d99-4896-b260-7dc51538056a",
    },
    scope: "collection",
    labels: { name: "Email Triage" },
  };
}

function migrationItems() {
  return [{
    link: todosProjectLink(),
    producer_resource_kind: "todos_project_registration",
    producer_binding: {
      authority_id: "todos",
      tenant_id: "tenant-primary",
      corpus_id: null,
      capability_digest: "sha256:todos-capability",
    },
  }];
}

function producerEvidence(): ProjectResourceLinkProducerEvidence[] {
  return [{
    created_by_operation: true,
    forward_receipt_id: "todos-receipt-forward",
    child_link_receipt_ids: [],
    target_revision: "todos-revision-1",
    target_digest: "sha256:todos-target",
    inverse_verified: null,
    inverse_outcome: null,
  }];
}

describe("project resource-link migration manifest", () => {
  test("persists planned before writes, proves no Projects write, and records a two-stage rollback", () => {
    const db = makeDb();
    const project = createWorkspace({ name: "Migration No Write", slug: "migration-no-write" }, db);
    const request = {
      project_id: project.id,
      operation_id: "migration-no-write",
      step_id: "links",
      expected_project_revision: project.updated_at,
      links: migrationItems(),
      max_items: 10,
      ...BOUNDS,
    };
    const planned = planProjectResourceLinkMigration(request, db);
    expect(planned.outcome).toBe("accepted");
    expect(planned.manifest.manifest_id).toMatch(/^prlm_[0-9a-f]{36}$/);
    expect(planned.manifest.links[0]?.link_id).toMatch(/^prl_[0-9a-f]{36}$/);
    expect(planned.events.map((event) => event.to_state)).toEqual(["planned"]);

    const replay = planProjectResourceLinkMigration(request, db);
    expect(replay.outcome).toBe("duplicate_of_accepted");
    expect(replay.manifest.manifest_id).toBe(planned.manifest.manifest_id);

    expect(() => rollbackProjectResourceLinkMigration({
      project_id: project.id,
      manifest_id: planned.manifest.manifest_id,
      expected_transition_version: 1,
      max_items: 10,
      producer_outcome: "complete",
      evidence: { producer: "not-yet-compensated" },
      ...BOUNDS,
    }, db)).toThrow(/producer_outcome=pending/);

    const proof = rollbackProjectResourceLinkMigration({
      project_id: project.id,
      manifest_id: planned.manifest.manifest_id,
      expected_transition_version: 1,
      max_items: 10,
      producer_outcome: "pending",
      evidence: { projects_reference_check: "complete" },
      ...BOUNDS,
    }, db);
    expect(proof.manifest.state).toBe("rollback_in_progress");
    expect(proof.manifest.projects_reference_proof).toEqual(expect.objectContaining({
      kind: "no_projects_write",
      complete: true,
      truncated: false,
      link_ids_checked: [planned.manifest.links[0]!.link_id],
    }));
    expect(proof.events.map((event) => event.to_state)).toEqual(["planned", "rollback_in_progress"]);
    expect(() => db.run(
      "UPDATE project_resource_link_migration_events SET evidence_json = '{}' WHERE manifest_id = ?",
      [planned.manifest.manifest_id],
    )).toThrow(/append-only/);

    const completed = rollbackProjectResourceLinkMigration({
      project_id: project.id,
      manifest_id: planned.manifest.manifest_id,
      expected_transition_version: proof.manifest.transition_version,
      max_items: 10,
      producer_outcome: "complete",
      evidence: { producer_inverse: "verified" },
      ...BOUNDS,
    }, db);
    expect(completed.manifest.state).toBe("rolled_back");
    expect(completed.events.map((event) => event.to_state)).toEqual([
      "planned",
      "rollback_in_progress",
      "rolled_back",
    ]);

    const duplicate = rollbackProjectResourceLinkMigration({
      project_id: project.id,
      manifest_id: planned.manifest.manifest_id,
      expected_transition_version: 1,
      max_items: 10,
      producer_outcome: "complete",
      evidence: { producer_inverse: "verified" },
      ...BOUNDS,
    }, db);
    expect(duplicate.outcome).toBe("duplicate_of_accepted");
    db.close();
  });

  test("binds exact producer and Projects receipts, verifies the collection, and removes references before retained target", () => {
    const db = makeDb();
    const project = createWorkspace({ name: "Migration Accepted Inverse", slug: "migration-accepted-inverse" }, db);
    const planned = planProjectResourceLinkMigration({
      project_id: project.id,
      operation_id: "migration-accepted-inverse",
      step_id: "links",
      expected_project_revision: project.updated_at,
      links: migrationItems(),
      max_items: 10,
      ...BOUNDS,
    }, db);
    const producerApplied = advanceProjectResourceLinkMigration({
      project_id: project.id,
      manifest_id: planned.manifest.manifest_id,
      expected_transition_version: planned.manifest.transition_version,
      next_state: "producer_applied",
      producer_evidence: producerEvidence(),
      evidence: { producer_receipt: "todos-receipt-forward" },
      ...BOUNDS,
    }, db);
    expect(producerApplied.manifest.state).toBe("producer_applied");

    const projectsWrite = mutateProjectResourceLinks({
      project_id: project.id,
      operation_id: planned.manifest.operation_id,
      step_id: planned.manifest.step_id,
      mode: "reconcile",
      expected_revision: project.updated_at,
      links: [todosProjectLink()],
      max_items: 10,
      ...BOUNDS,
    }, db);
    expect(projectsWrite.outcome).toBe("accepted");

    const projectsApplied = advanceProjectResourceLinkMigration({
      project_id: project.id,
      manifest_id: planned.manifest.manifest_id,
      expected_transition_version: producerApplied.manifest.transition_version,
      next_state: "projects_applied",
      projects_forward_receipt_id: projectsWrite.receipt!.receipt_id,
      evidence: { projects_receipt: projectsWrite.receipt!.receipt_id },
      ...BOUNDS,
    }, db);
    expect(projectsApplied.manifest.projects_forward_receipt_id).toBe(projectsWrite.receipt!.receipt_id);

    const current = readProjectResourceLinks({
      project_id: project.id,
      max_items: 10,
      ...BOUNDS,
    }, db);
    const verified = advanceProjectResourceLinkMigration({
      project_id: project.id,
      manifest_id: planned.manifest.manifest_id,
      expected_transition_version: projectsApplied.manifest.transition_version,
      next_state: "verified",
      last_verified_projects_revision: current.current_revision,
      last_verified_projects_digest: current.collection_digest,
      evidence: { complete_readback: true },
      ...BOUNDS,
    }, db);
    expect(verified.manifest.state).toBe("verified");

    const referenceRollback = rollbackProjectResourceLinkMigration({
      project_id: project.id,
      manifest_id: planned.manifest.manifest_id,
      expected_transition_version: verified.manifest.transition_version,
      max_items: 10,
      producer_outcome: "pending",
      evidence: { producer_inverse: "not-started" },
      ...BOUNDS,
    }, db);
    expect(referenceRollback.manifest.state).toBe("rollback_in_progress");
    expect(referenceRollback.manifest.projects_reference_proof).toEqual(expect.objectContaining({
      kind: "accepted_inverse",
      forward_receipt_id: projectsWrite.receipt!.receipt_id,
      complete: true,
      truncated: false,
    }));
    expect(readProjectResourceLinks({
      project_id: project.id,
      max_items: 10,
      ...BOUNDS,
    }, db).links).toEqual([]);

    const retained = rollbackProjectResourceLinkMigration({
      project_id: project.id,
      manifest_id: planned.manifest.manifest_id,
      expected_transition_version: referenceRollback.manifest.transition_version,
      max_items: 10,
      producer_outcome: "retained_target",
      evidence: { dependent_children: 1, producer_refusal: "target-not-empty" },
      ...BOUNDS,
    }, db);
    expect(retained.manifest.state).toBe("retained_target");
    expect(retained.events.map((event) => event.to_state)).toEqual([
      "planned",
      "producer_applied",
      "projects_applied",
      "verified",
      "rollback_in_progress",
      "retained_target",
    ]);
    db.close();
  });

  test("stops on stale transition CAS and ambiguous links without a matching Projects receipt", () => {
    const db = makeDb();
    const project = createWorkspace({ name: "Migration Ambiguity", slug: "migration-ambiguity" }, db);
    const planned = planProjectResourceLinkMigration({
      project_id: project.id,
      operation_id: "migration-ambiguity",
      step_id: "links",
      expected_project_revision: project.updated_at,
      links: migrationItems(),
      max_items: 10,
      ...BOUNDS,
    }, db);
    expect(() => advanceProjectResourceLinkMigration({
      project_id: project.id,
      manifest_id: planned.manifest.manifest_id,
      expected_transition_version: 99,
      next_state: "producer_applied",
      producer_evidence: producerEvidence(),
      evidence: {},
      ...BOUNDS,
    }, db)).toThrow(/transition_version is stale/);

    mutateProjectResourceLinks({
      project_id: project.id,
      operation_id: "unbound-projects-write",
      step_id: "links",
      mode: "reconcile",
      expected_revision: project.updated_at,
      links: [todosProjectLink()],
      max_items: 10,
      ...BOUNDS,
    }, db);
    expect(() => rollbackProjectResourceLinkMigration({
      project_id: project.id,
      manifest_id: planned.manifest.manifest_id,
      expected_transition_version: planned.manifest.transition_version,
      max_items: 10,
      producer_outcome: "pending",
      evidence: {},
      ...BOUNDS,
    }, db)).toThrow(/ambiguous Projects state/);

    const unchanged = readProjectResourceLinkMigration({
      project_id: project.id,
      manifest_id: planned.manifest.manifest_id,
      max_items: 10,
      ...BOUNDS,
    }, db);
    expect(unchanged.manifest.state).toBe("planned");
    expect(unchanged.events).toHaveLength(1);
    db.close();
  });
});
