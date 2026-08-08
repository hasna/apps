import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createWorkspace, mutateProjectResourceLinks, readProjectResourceLinks, rollbackProjectResourceLinks } from "../db/workspaces.js";
import { runMigrations } from "../db/schema.js";
import {
  normalizeProjectResourceLink,
  type ProjectResourceLinkInput,
} from "./project-resource-links.js";

function makeDb(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys=ON");
  runMigrations(db);
  return db;
}

function conversationsChannel(name = "email-triage"): ProjectResourceLinkInput {
  return {
    authority: "conversations",
    service_instance: "urn:hasna:conversations:service:primary",
    source_package: "@hasna/conversations",
    target_kind: "channel",
    locator: {
      kind: "conversations_channel_id",
      value: "chn_79fa9c68937a1d020d6031dcaa3dd8d7",
    },
    scope: "collection",
    labels: { channel_name: name },
  };
}

function todosProject(): ProjectResourceLinkInput {
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

function orgsOrg(): ProjectResourceLinkInput {
  return {
    authority: "orgs",
    service_instance: "urn:hasna:orgs:service:primary",
    source_package: "@hasna/orgs",
    target_kind: "org",
    locator: {
      kind: "canonical_uri",
      value: "urn:hasna:orgs:org:hasna-family",
    },
    scope: "collection",
    labels: { name: "Hasna Family" },
  };
}

function orgsProject(): ProjectResourceLinkInput {
  return {
    authority: "orgs",
    service_instance: "urn:hasna:orgs:service:primary",
    source_package: "@hasna/orgs",
    target_kind: "project",
    locator: {
      kind: "canonical_uri",
      value: "urn:hasna:orgs:project:nanny-onboarding",
    },
    scope: "resource",
    labels: { name: "Nanny Onboarding" },
  };
}

describe("project resource-link schema", () => {
  test("accepts immutable Conversations channel IDs without relabeling them as UUIDs", () => {
    const normalized = normalizeProjectResourceLink({
      ...conversationsChannel(),
      locator: {
        kind: "conversations_channel_id",
        value: "chn_79fa9c68937a1d020d6031dcaa3dd8d7",
      },
    });
    expect(normalized.locator).toEqual({
      kind: "conversations_channel_id",
      value: "chn_79fa9c68937a1d020d6031dcaa3dd8d7",
    });
    expect(() => normalizeProjectResourceLink({
      ...conversationsChannel(),
      locator: {
        kind: "conversations_channel_id",
        value: "email-triage",
      },
    })).toThrow(/conversations channel ID/);
  });

  test("preserves external UUID locators and refuses mutable channel names or foreign packages as identity", () => {
    expect(normalizeProjectResourceLink({
      ...conversationsChannel(),
      locator: {
        kind: "external_uuid",
        value: "515FBB15-4661-4CDC-B1DF-F719797B8CAD",
      },
    }).locator).toEqual({
      kind: "external_uuid",
      value: "515fbb15-4661-4cdc-b1df-f719797b8cad",
    });
    expect(() => normalizeProjectResourceLink({
      ...conversationsChannel(),
      locator: { kind: "conversations_channel_id", value: "email-triage" },
    })).toThrow(/conversations channel ID/);
    expect(() => normalizeProjectResourceLink({
      ...conversationsChannel(),
      source_package: "@hasna/todos",
    })).toThrow(/source_package/);
    expect(() => normalizeProjectResourceLink({
      ...conversationsChannel(),
      target_kind: "message" as never,
    })).toThrow(/target_kind/);
    expect(() => normalizeProjectResourceLink({
      ...conversationsChannel(),
      unexpected: true,
    } as ProjectResourceLinkInput)).toThrow(/unknown field/);
    expect(() => normalizeProjectResourceLink({
      ...todosProject(),
      locator: {
        kind: "conversations_channel_id",
        value: "chn_79fa9c68937a1d020d6031dcaa3dd8d7",
      },
    })).toThrow(/only valid for Conversations channel links/);
  });

  test("accepts only organization and project nodes owned by @hasna/orgs", () => {
    expect(normalizeProjectResourceLink(orgsOrg())).toMatchObject({
      authority: "orgs",
      source_package: "@hasna/orgs",
      target_kind: "org",
    });
    expect(normalizeProjectResourceLink(orgsProject())).toMatchObject({
      authority: "orgs",
      source_package: "@hasna/orgs",
      target_kind: "project",
    });
    expect(() => normalizeProjectResourceLink({
      ...orgsOrg(),
      source_package: "@hasna/projects",
    })).toThrow(/source_package/);
    expect(() => normalizeProjectResourceLink({
      ...orgsOrg(),
      target_kind: "team" as never,
    })).toThrow(/target_kind/);
  });

  test("stores immutable locator columns and rejects direct identity mutation", () => {
    const db = makeDb();
    const project = createWorkspace({ name: "Immutable Links", slug: "immutable-links" }, db);
    const added = mutateProjectResourceLinks({
      project_id: project.id,
      operation_id: "op-immutable",
      step_id: "links",
      mode: "add",
      expected_revision: project.updated_at,
      links: [conversationsChannel()],
      response_byte_limit: 64_000,
      time_budget_ms: 5_000,
    }, db);
    expect(added.outcome).toBe("accepted");
    expect(() => db.run(
      "UPDATE project_resource_links SET locator_value = ? WHERE project_id = ?",
      ["different", project.id],
    )).toThrow(/immutable/);
    db.close();
  });
});

describe("project resource-link guarded lifecycle", () => {
  test("adds several resources, projects legacy scalars, and retries idempotently", () => {
    const db = makeDb();
    const project = createWorkspace({ name: "Email Triage", slug: "email-triage" }, db);
    const input = {
      project_id: project.id,
      operation_id: "op-add-links",
      step_id: "links",
      mode: "add" as const,
      expected_revision: project.updated_at,
      links: [conversationsChannel(), todosProject()],
      response_byte_limit: 64_000,
      time_budget_ms: 5_000,
    };
    const added = mutateProjectResourceLinks(input, db);
    expect(added.outcome).toBe("accepted");
    expect(added.after?.links).toHaveLength(2);
    expect(added.after?.project.integrations).toEqual({
      conversations_channel: "email-triage",
      todos_project_id: "urn:hasna:todos:project:434a687f-6d99-4896-b260-7dc51538056a",
    });
    expect(added.after?.links[0]?.id).toMatch(/^prl_[0-9a-f]{36}$/);

    const duplicate = mutateProjectResourceLinks(input, db);
    expect(duplicate.outcome).toBe("duplicate_of_accepted");
    expect(duplicate.receipt?.duplicate_of_receipt_id).toBe(added.receipt?.receipt_id);
    expect(readProjectResourceLinks({
      project_id: project.id,
      max_items: 2,
      response_byte_limit: 64_000,
      time_budget_ms: 5_000,
    }, db).links).toHaveLength(2);
    db.close();
  });

  test("projects Orgs organization and project links into compatibility integrations", () => {
    const db = makeDb();
    const project = createWorkspace({ name: "Nanny Onboarding", slug: "nanny-onboarding" }, db);
    const added = mutateProjectResourceLinks({
      project_id: project.id,
      operation_id: "op-add-orgs-links",
      step_id: "orgs-links",
      mode: "add",
      expected_revision: project.updated_at,
      links: [orgsOrg(), orgsProject()],
      response_byte_limit: 64_000,
      time_budget_ms: 5_000,
    }, db);

    expect(added.outcome).toBe("accepted");
    expect(added.after?.links).toHaveLength(2);
    expect(added.after?.project.integrations).toEqual({
      orgs_org_id: "urn:hasna:orgs:org:hasna-family",
      orgs_project_id: "urn:hasna:orgs:project:nanny-onboarding",
    });
    db.close();
  });

  test("reconciles the complete collection, updates labels, and rolls back exactly", () => {
    const db = makeDb();
    const project = createWorkspace({ name: "Reconcile Links", slug: "reconcile-links" }, db);
    const added = mutateProjectResourceLinks({
      project_id: project.id,
      operation_id: "op-seed-links",
      step_id: "links",
      mode: "add",
      expected_revision: project.updated_at,
      links: [conversationsChannel(), todosProject()],
      response_byte_limit: 64_000,
      time_budget_ms: 5_000,
    }, db);
    const reconciled = mutateProjectResourceLinks({
      project_id: project.id,
      operation_id: "op-reconcile-links",
      step_id: "links",
      mode: "reconcile",
      expected_revision: added.after!.project.updated_at,
      links: [conversationsChannel("renamed-channel")],
      response_byte_limit: 64_000,
      time_budget_ms: 5_000,
    }, db);
    expect(reconciled.outcome).toBe("accepted");
    expect(reconciled.after?.links).toHaveLength(1);
    expect(reconciled.after?.links[0]?.labels.channel_name).toBe("renamed-channel");
    expect(reconciled.after?.project.integrations).toEqual({ conversations_channel: "renamed-channel" });

    const rolledBack = rollbackProjectResourceLinks({
      project_id: project.id,
      operation_id: "op-reconcile-rollback",
      step_id: "links",
      accepted_receipt_id: reconciled.receipt!.receipt_id,
      expected_current_revision: reconciled.after!.project.updated_at,
      response_byte_limit: 64_000,
      time_budget_ms: 5_000,
    }, db);
    expect(rolledBack.outcome).toBe("accepted");
    expect(rolledBack.after?.links).toEqual(added.after?.links);
    expect(rolledBack.after?.project.integrations).toEqual(added.after?.project.integrations);
    db.close();
  });

  test("fails closed on stale revisions, changed step requests, incomplete bounds, and transaction faults", () => {
    const db = makeDb();
    const project = createWorkspace({ name: "Link Guards", slug: "link-guards" }, db);
    const accepted = mutateProjectResourceLinks({
      project_id: project.id,
      operation_id: "op-link-guards",
      step_id: "links",
      mode: "add",
      expected_revision: project.updated_at,
      links: [conversationsChannel()],
      response_byte_limit: 64_000,
      time_budget_ms: 5_000,
    }, db);

    const changed = mutateProjectResourceLinks({
      project_id: project.id,
      operation_id: "op-link-guards",
      step_id: "links",
      mode: "add",
      expected_revision: project.updated_at,
      links: [todosProject()],
      response_byte_limit: 64_000,
      time_budget_ms: 5_000,
    }, db);
    expect(changed.outcome).toBe("terminal_nonacceptance");
    expect(changed.receipt?.reason).toBe("changed_request_or_precondition_for_step");

    const stale = mutateProjectResourceLinks({
      project_id: project.id,
      operation_id: "op-stale-links",
      step_id: "links",
      mode: "add",
      expected_revision: project.updated_at,
      links: [todosProject()],
      response_byte_limit: 64_000,
      time_budget_ms: 5_000,
    }, db);
    expect(stale.outcome).toBe("terminal_nonacceptance");
    expect(stale.receipt?.reason).toBe("stale_revision");

    expect(() => readProjectResourceLinks({
      project_id: project.id,
      max_items: 0,
      response_byte_limit: 64_000,
      time_budget_ms: 5_000,
    }, db)).toThrow(/max_items/);

    db.run(`
      CREATE TRIGGER fail_resource_link_revision
      BEFORE UPDATE OF updated_at ON workspaces
      WHEN NEW.id = '${project.id}'
      BEGIN
        SELECT RAISE(ABORT, 'injected revision failure');
      END
    `);
    expect(() => mutateProjectResourceLinks({
      project_id: project.id,
      operation_id: "op-fault-links",
      step_id: "links",
      mode: "reconcile",
      expected_revision: accepted.after!.project.updated_at,
      links: [todosProject()],
      response_byte_limit: 64_000,
      time_budget_ms: 5_000,
    }, db)).toThrow(/injected revision failure/);
    expect(readProjectResourceLinks({
      project_id: project.id,
      max_items: 1,
      response_byte_limit: 64_000,
      time_budget_ms: 5_000,
    }, db).links).toEqual(accepted.after!.links);
    db.close();
  });
});
