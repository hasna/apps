import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { validateEmbeddedContract } from "@hasna/contracts/validators";
import {
  createWorkspace,
  mutateProjectResourceLinks,
  readProjectResourceLinks,
  rollbackProjectResourceLinks,
  updateWorkspace,
} from "../db/workspaces.js";
import { runMigrations } from "../db/schema.js";
import {
  assertProjectResourceLinkReadContractEquality,
  normalizeProjectResourceLink,
  normalizeProjectResourceLinks,
  projectResourceLinkId,
  type ProjectResourceLinkInput,
} from "./project-resource-links.js";

type ConversationsChannelLink = Extract<
  ProjectResourceLinkInput,
  { authority: "conversations"; target_kind: "channel" }
>;
type TodosProjectLink = Extract<ProjectResourceLinkInput, { authority: "todos" }> & { target_kind: "project" };
type TodosTaskLink = Extract<ProjectResourceLinkInput, { authority: "todos" }> & { target_kind: "task" };
type OrgsOrgLink = Extract<ProjectResourceLinkInput, { authority: "orgs" }> & { target_kind: "org" };
type OrgsProjectLink = Extract<ProjectResourceLinkInput, { authority: "orgs" }> & { target_kind: "project" };
type ContactsContactLink = Extract<ProjectResourceLinkInput, { authority: "contacts" }>;

function makeDb(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys=ON");
  runMigrations(db);
  return db;
}

function conversationsChannel(
  name = "email-triage",
  id = "chn_79fa9c68937a1d020d6031dcaa3dd8d7",
): ConversationsChannelLink {
  return {
    authority: "conversations",
    service_instance: "urn:hasna:conversations:service:primary",
    source_package: "@hasna/conversations",
    target_kind: "channel",
    locator: {
      kind: "conversations_channel_id",
      value: id,
    },
    scope: "collection",
    labels: { channel_name: name },
  };
}

function todosProject(): TodosProjectLink {
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

function todosTask(): TodosTaskLink {
  return {
    authority: "todos",
    service_instance: "urn:hasna:todos:service:primary",
    source_package: "@hasna/todos",
    target_kind: "task",
    locator: {
      kind: "external_uuid",
      value: "e2f791bd-f26b-4fac-a762-2cba96202aa5",
    },
    scope: "resource",
    labels: { name: "Anchor Dubai fraud project" },
  };
}

function orgsOrg(): OrgsOrgLink {
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

function orgsProject(): OrgsProjectLink {
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

function contactsContact(): ContactsContactLink {
  return {
    authority: "contacts",
    service_instance: "urn:hasna:contacts:service:primary",
    source_package: "@hasna/contacts",
    target_kind: "contact",
    locator: {
      kind: "external_uuid",
      value: "6B68E131-ABE5-43B7-92CD-9930B04611DF",
    },
    scope: "resource",
    labels: { name: "Bianca" },
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
    } as unknown as ProjectResourceLinkInput)).toThrow(/source_package/);
    expect(() => normalizeProjectResourceLink({
      ...conversationsChannel(),
      target_kind: "message" as never,
    })).toThrow(/target_kind/);
    expect(() => normalizeProjectResourceLink({
      ...conversationsChannel(),
      unexpected: true,
    } as unknown as ProjectResourceLinkInput)).toThrow(/unknown field/);
    expect(() => normalizeProjectResourceLink({
      ...todosProject(),
      locator: {
        kind: "conversations_channel_id",
        value: "chn_79fa9c68937a1d020d6031dcaa3dd8d7",
      },
    } as unknown as ProjectResourceLinkInput)).toThrow(/only valid for Conversations channel links/);
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
    } as unknown as ProjectResourceLinkInput)).toThrow(/source_package/);
    expect(() => normalizeProjectResourceLink({
      ...orgsOrg(),
      target_kind: "team" as never,
    })).toThrow(/target_kind/);
  });

  test("accepts only immutable contact IDs owned by @hasna/contacts", () => {
    expect(normalizeProjectResourceLink(contactsContact())).toMatchObject({
      authority: "contacts",
      source_package: "@hasna/contacts",
      target_kind: "contact",
      locator: {
        kind: "external_uuid",
        value: "6b68e131-abe5-43b7-92cd-9930b04611df",
      },
      scope: "resource",
    });
    expect(() => normalizeProjectResourceLink({
      ...contactsContact(),
      source_package: "@hasna/projects",
    } as unknown as ProjectResourceLinkInput)).toThrow(/source_package/);
    expect(() => normalizeProjectResourceLink({
      ...contactsContact(),
      target_kind: "project" as never,
    })).toThrow(/target_kind/);
    expect(() => normalizeProjectResourceLink({
      ...contactsContact(),
      locator: {
        kind: "canonical_uri",
        value: "urn:hasna:contacts:contact:bianca",
      },
    } as unknown as ProjectResourceLinkInput)).toThrow(/external_uuid/);
  });

  test("accepts complete Todos task UUIDs while every other authority remains closed", () => {
    expect(normalizeProjectResourceLink(todosTask())).toMatchObject({
      authority: "todos",
      source_package: "@hasna/todos",
      target_kind: "task",
      locator: {
        kind: "external_uuid",
        value: "e2f791bd-f26b-4fac-a762-2cba96202aa5",
      },
      scope: "resource",
    });
    expect(() => normalizeProjectResourceLink({
      ...todosTask(),
      locator: { kind: "external_uuid", value: "e2f791bd" },
    })).toThrow(/complete UUID/);
    expect(() => normalizeProjectResourceLink({
      ...todosTask(),
      locator: {
        kind: "canonical_uri",
        value: "urn:hasna:todos:task:e2f791bd-f26b-4fac-a762-2cba96202aa5",
      },
    } as unknown as ProjectResourceLinkInput)).toThrow(/complete external_uuid task ID/);

    for (const foreign of [
      { authority: "conversations", source_package: "@hasna/conversations" },
      { authority: "knowledge", source_package: "@hasna/knowledge" },
      { authority: "mementos", source_package: "@hasna/mementos" },
      { authority: "orgs", source_package: "@hasna/orgs" },
      { authority: "contacts", source_package: "@hasna/contacts" },
    ] as const) {
      expect(() => normalizeProjectResourceLink({
        ...todosTask(),
        ...foreign,
      } as unknown as ProjectResourceLinkInput)).toThrow(/target_kind/);
    }
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
  test("keeps Todos task identity stable through replay, rollback, reapply, and request collisions", () => {
    const db = makeDb();
    const project = createWorkspace({ name: "Task Link", slug: "task-link" }, db);
    const task = todosTask();
    const expectedId = projectResourceLinkId(project.id, task);
    expect(projectResourceLinkId(project.id, { ...task, labels: { name: "Relabeled" } })).toBe(expectedId);
    expect(() => normalizeProjectResourceLinks([
      task,
      { ...task, labels: { name: "Duplicate identity" } },
    ])).toThrow(/duplicate resource link identity/);

    const input = {
      project_id: project.id,
      operation_id: "op-task-link",
      step_id: "task-link",
      mode: "add" as const,
      expected_revision: project.updated_at,
      links: [task],
      response_byte_limit: 64_000,
      time_budget_ms: 5_000,
    };
    const added = mutateProjectResourceLinks(input, db);
    expect(added.outcome).toBe("accepted");
    expect(added.after?.links.map((link) => link.id)).toEqual([expectedId]);

    const replay = mutateProjectResourceLinks(input, db);
    expect(replay.outcome).toBe("duplicate_of_accepted");
    expect(replay.receipt?.duplicate_of_receipt_id).toBe(added.receipt?.receipt_id);

    const rolledBack = rollbackProjectResourceLinks({
      project_id: project.id,
      operation_id: "op-task-link-rollback",
      step_id: "task-link",
      accepted_receipt_id: added.receipt!.receipt_id,
      expected_current_revision: added.after!.project.updated_at,
      response_byte_limit: 64_000,
      time_budget_ms: 5_000,
    }, db);
    expect(rolledBack.outcome).toBe("accepted");
    expect(rolledBack.after?.links).toEqual([]);

    const reapplied = mutateProjectResourceLinks({
      ...input,
      operation_id: "op-task-link-reapply",
      expected_revision: rolledBack.after!.project.updated_at,
    }, db);
    expect(reapplied.outcome).toBe("accepted");
    expect(reapplied.after?.links.map((link) => link.id)).toEqual([expectedId]);
    db.close();
  });

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
    const read = readProjectResourceLinks({
      project_id: project.id,
      max_items: 2,
      response_byte_limit: 64_000,
      time_budget_ms: 5_000,
    }, db);
    expect(read.links).toHaveLength(2);
    expect(read.contract).toEqual({
      schema: "hasna.project_resource_link_collection.v1",
      project_id: read.project_id,
      current_revision: read.current_revision,
      links: read.links,
      link_count: read.link_count,
      max_items: read.max_items,
      collection_digest: read.collection_digest,
      complete: read.complete,
      truncated: read.truncated,
    });
    expect(validateEmbeddedContract(read.contract).success).toBe(true);
    expect(() => assertProjectResourceLinkReadContractEquality({
      ...read,
      contract: { ...read.contract, collection_digest: "a".repeat(64) },
    })).toThrow(/not byte-equivalent/);
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

  test("preserves a uniquely matching channel projection when adding a second channel link", () => {
    const db = makeDb();
    const project = createWorkspace({ name: "Multi-channel Project", slug: "multi-channel-project" }, db);
    const first = conversationsChannel();
    const second = conversationsChannel(
      "incident-response",
      "chn_1234567890abcdef1234567890abcdef",
    );
    const seeded = mutateProjectResourceLinks({
      project_id: project.id,
      operation_id: "op-seed-multi-channel",
      step_id: "links",
      mode: "add",
      expected_revision: project.updated_at,
      links: [first],
      response_byte_limit: 64_000,
      time_budget_ms: 5_000,
    }, db);
    expect(seeded.outcome).toBe("accepted");

    const expanded = mutateProjectResourceLinks({
      project_id: project.id,
      operation_id: "op-add-second-channel",
      step_id: "links",
      mode: "add",
      expected_revision: seeded.after!.project.updated_at,
      links: [second],
      response_byte_limit: 64_000,
      time_budget_ms: 5_000,
    }, db);

    expect(expanded.outcome).toBe("accepted");
    expect(expanded.after?.links).toHaveLength(2);
    expect(expanded.after?.project.integrations).toEqual({
      conversations_channel: "email-triage",
    });
    db.close();
  });

  test("deletes a channel projection that matches none of several channel links", () => {
    const db = makeDb();
    const project = createWorkspace({
      name: "Unmatched Channel Projection",
      slug: "unmatched-channel-projection",
      integrations: { conversations_channel: "not-a-linked-channel" },
    }, db);
    const added = mutateProjectResourceLinks({
      project_id: project.id,
      operation_id: "op-add-unmatched-channels",
      step_id: "links",
      mode: "add",
      expected_revision: project.updated_at,
      links: [
        conversationsChannel(),
        conversationsChannel(
          "incident-response",
          "chn_1234567890abcdef1234567890abcdef",
        ),
      ],
      response_byte_limit: 64_000,
      time_budget_ms: 5_000,
    }, db);

    expect(added.outcome).toBe("accepted");
    expect(added.after?.links).toHaveLength(2);
    expect(added.after?.project.integrations).toEqual({});
    db.close();
  });

  test("deletes an ambiguous channel projection that matches several channel links", () => {
    const db = makeDb();
    const project = createWorkspace({
      name: "Ambiguous Channel Projection",
      slug: "ambiguous-channel-projection",
      integrations: { conversations_channel: "shared-channel" },
    }, db);
    const added = mutateProjectResourceLinks({
      project_id: project.id,
      operation_id: "op-add-ambiguous-channels",
      step_id: "links",
      mode: "add",
      expected_revision: project.updated_at,
      links: [
        conversationsChannel("shared-channel"),
        conversationsChannel(
          "shared-channel",
          "chn_1234567890abcdef1234567890abcdef",
        ),
      ],
      response_byte_limit: 64_000,
      time_budget_ms: 5_000,
    }, db);

    expect(added.outcome).toBe("accepted");
    expect(added.after?.links).toHaveLength(2);
    expect(added.after?.project.integrations).toEqual({});
    db.close();
  });

  test("keeps Contacts membership authoritative without projecting contact IDs into scalar integrations", () => {
    const db = makeDb();
    const project = createWorkspace({ name: "REGES / KPMG", slug: "reges-kpmg" }, db);
    const added = mutateProjectResourceLinks({
      project_id: project.id,
      operation_id: "op-add-contact-link",
      step_id: "contact-link",
      mode: "add",
      expected_revision: project.updated_at,
      links: [contactsContact()],
      response_byte_limit: 64_000,
      time_budget_ms: 5_000,
    }, db);
    expect(added.outcome).toBe("accepted");
    expect(added.after?.links).toEqual([
      expect.objectContaining({
        authority: "contacts",
        source_package: "@hasna/contacts",
        target_kind: "contact",
        locator: {
          kind: "external_uuid",
          value: "6b68e131-abe5-43b7-92cd-9930b04611df",
        },
      }),
    ]);
    expect(added.after?.project.integrations).toEqual({});
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
    const originalConversationLink = added.after!.links.find((link) => link.authority === "conversations")!;
    const reconciled = mutateProjectResourceLinks({
      project_id: project.id,
      operation_id: "op-reconcile-links",
      step_id: "links",
      mode: "reconcile",
      expected_revision: added.after!.project.updated_at,
      links: [{ ...conversationsChannel("renamed-channel"), scope: "resource" }],
      response_byte_limit: 64_000,
      time_budget_ms: 5_000,
    }, db);
    expect(reconciled.outcome).toBe("accepted");
    expect(reconciled.after?.links).toHaveLength(1);
    expect(reconciled.after?.links[0]?.labels.channel_name).toBe("renamed-channel");
    expect(reconciled.after?.links[0]?.scope).toBe("resource");
    expect(reconciled.after?.links[0]?.id).toBe(originalConversationLink.id);
    expect(reconciled.after?.links[0]?.created_at).toBe(originalConversationLink.created_at);
    expect(reconciled.after?.collection_digest).not.toBe(added.after?.collection_digest);
    expect(reconciled.after?.project.integrations).toEqual({ conversations_channel: "renamed-channel" });
    expect(() => updateWorkspace(project.id, {
      integrations: { conversations_channel: "legacy-writer-drift" },
    }, db)).toThrow(/must be changed through resource-links/);

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
