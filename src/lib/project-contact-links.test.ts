import { describe, expect, test } from "bun:test";
import type { ProjectStore } from "../store/project-store.js";
import type {
  ProjectResourceLink,
  ProjectResourceLinkMutationRequest,
  ProjectResourceLinkMutationResult,
  ProjectResourceLinkReadResult,
  ProjectResourceLinkRollbackRequest,
  Workspace,
} from "../types/workspace.js";
import {
  ProjectContactLinkOperationError,
  attachProjectContact,
  detachProjectContact,
  listProjectContacts,
  type ContactProjectMembershipAuthority,
  type ContactProjectMembershipMutationResult,
  type ContactProjectMembershipSnapshot,
} from "./project-contact-links.js";

const projectId = "wks_eHb1kcLUzgQVJQt6L0CCB";
const contactId = "6b68e131-abe5-43b7-92cd-9930b04611df";
const otherContactId = "515fbb15-4661-4cdc-b1df-f719797b8cad";
const serviceInstance = "urn:hasna:contacts:service:primary";

const project: Workspace = {
  id: projectId,
  slug: "reges-kpmg",
  name: "REGES / KPMG",
  description: null,
  kind: "generic",
  status: "active",
  root_id: null,
  recipe_id: null,
  canonical_machine: null,
  primary_path: null,
  git_remote: null,
  integrations: {},
  metadata: {},
  tags: [],
  s3_bucket: null,
  s3_prefix: null,
  last_opened_at: null,
  synced_at: null,
  created_at: "2026-08-08 12:00:00",
  updated_at: "2026-08-08 12:00:00",
};

function resourceLink(id = contactId): ProjectResourceLink {
  return {
    id: `prl_${id.replaceAll("-", "").slice(0, 36)}`,
    project_id: projectId,
    authority: "contacts",
    service_instance: serviceInstance,
    source_package: "@hasna/contacts",
    target_kind: "contact",
    locator: { kind: "external_uuid", value: id },
    scope: "resource",
    labels: {},
    created_at: "2026-08-08 12:00:00",
    updated_at: "2026-08-08 12:00:00",
  };
}

function projectRead(links: ProjectResourceLink[] = [], revision = project.updated_at): ProjectResourceLinkReadResult {
  return {
    ok: true,
    project_id: projectId,
    project: { ...project, updated_at: revision },
    current_revision: revision,
    links,
    link_count: links.length,
    max_items: 1000,
    collection_digest: `digest-${links.length}-${revision}`,
    complete: true,
    truncated: false,
    response_control: {
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
      response_bytes: 1_000,
      elapsed_ms: 1,
      complete: true,
      truncated: false,
    },
  };
}

function projectMutation(
  request: ProjectResourceLinkMutationRequest,
  before: ProjectResourceLinkReadResult,
  afterLinks: ProjectResourceLink[],
): ProjectResourceLinkMutationResult {
  const nextRevision = "2026-08-08 12:00:01";
  return {
    ok: true,
    dry_run: false,
    outcome: "accepted",
    mode: request.mode,
    idempotency_key: `${request.operation_id}:${request.step_id}`,
    request_digest: "request",
    precondition_digest: "precondition",
    project_id: projectId,
    expected_revision: request.expected_revision,
    current_revision: nextRevision,
    before: {
      project: before.project,
      links: before.links,
      collection_digest: before.collection_digest,
    },
    after: {
      project: { ...before.project, updated_at: nextRevision },
      links: afterLinks,
      collection_digest: `digest-${afterLinks.length}-${nextRevision}`,
    },
    receipt: {
      receipt_id: `gpr_${request.step_id}`,
      operation_id: request.operation_id,
      step_id: request.step_id,
      direction: "forward",
      idempotency_key: `${request.operation_id}:${request.step_id}`,
      target_id: projectId,
      request_digest: "request",
      precondition_digest: "precondition",
      expected_revision: request.expected_revision,
      outcome: "accepted",
      reason: null,
      result_project_id: projectId,
      before: null,
      after: null,
      duplicate_of_receipt_id: null,
      post_revision: nextRevision,
      created_at: "2026-08-08 12:00:01",
    },
    response_control: before.response_control,
  };
}

class FakeProjectStore {
  readonly mode = "api" as const;
  readonly mutations: ProjectResourceLinkMutationRequest[] = [];
  readonly rollbacks: ProjectResourceLinkRollbackRequest[] = [];
  read = projectRead();
  failMutation: Error | null = null;

  async readProjectResourceLinks(): Promise<ProjectResourceLinkReadResult> {
    return this.read;
  }

  async mutateProjectResourceLinks(
    request: ProjectResourceLinkMutationRequest,
  ): Promise<ProjectResourceLinkMutationResult> {
    this.mutations.push(request);
    if (this.failMutation) throw this.failMutation;
    const requested = request.links.map((input) => ({
      ...input,
      id: resourceLink(input.locator.value).id,
      project_id: projectId,
      labels: input.labels ?? {},
      created_at: "2026-08-08 12:00:01",
      updated_at: "2026-08-08 12:00:01",
    }));
    const afterLinks = request.mode === "add"
      ? [...this.read.links, ...requested.filter((candidate) => (
        !this.read.links.some((existing) => existing.id === candidate.id)
      ))]
      : requested;
    return projectMutation(request, this.read, afterLinks);
  }

  async rollbackProjectResourceLinks(
    request: ProjectResourceLinkRollbackRequest,
  ): Promise<ProjectResourceLinkMutationResult> {
    this.rollbacks.push(request);
    throw new Error("project rollback should not be used by these tests");
  }
}

function membership(linked: boolean, version: string): ContactProjectMembershipSnapshot {
  return {
    contact_id: contactId,
    project_id: projectId,
    linked,
    version,
  };
}

class FakeMembershipAuthority implements ContactProjectMembershipAuthority {
  readonly service_instance = serviceInstance;
  readonly mutations: Array<{ kind: "attach" | "detach"; expected_version: string; operation_id: string; step_id: string }> = [];
  snapshot = membership(false, "contacts-v1");
  projectContactIds = [contactId];
  failCompensation = false;

  async readMembership(): Promise<ContactProjectMembershipSnapshot> {
    return this.snapshot;
  }

  async listProjectMemberships() {
    return {
      project_id: projectId,
      contact_ids: [...this.projectContactIds],
      complete: true as const,
      membership_revision: "contacts-list-v1",
    };
  }

  async attach(input: {
    expected_version: string;
    operation_id: string;
    step_id: string;
  }): Promise<ContactProjectMembershipMutationResult> {
    this.mutations.push({ kind: "attach", ...input });
    if (this.failCompensation && input.step_id.endsWith(":compensate")) {
      throw new Error("contacts compensation failed");
    }
    const before = this.snapshot;
    this.snapshot = membership(true, `${before.version}:attach`);
    return {
      outcome: before.linked ? "duplicate_of_accepted" : "accepted",
      operation_id: input.operation_id,
      step_id: input.step_id,
      before,
      after: this.snapshot,
      receipt_id: `contacts-${input.step_id}`,
    };
  }

  async detach(input: {
    expected_version: string;
    operation_id: string;
    step_id: string;
  }): Promise<ContactProjectMembershipMutationResult> {
    this.mutations.push({ kind: "detach", ...input });
    if (this.failCompensation && input.step_id.endsWith(":compensate")) {
      throw new Error("contacts compensation failed");
    }
    const before = this.snapshot;
    this.snapshot = membership(false, `${before.version}:detach`);
    return {
      outcome: before.linked ? "accepted" : "duplicate_of_accepted",
      operation_id: input.operation_id,
      step_id: input.step_id,
      before,
      after: this.snapshot,
      receipt_id: `contacts-${input.step_id}`,
    };
  }
}

function dependencies(projects: FakeProjectStore, contacts: FakeMembershipAuthority) {
  return {
    projects: projects as unknown as Pick<
      ProjectStore,
      "readProjectResourceLinks" | "mutateProjectResourceLinks" | "rollbackProjectResourceLinks"
    >,
    contacts,
  };
}

describe("project contact-link coordination", () => {
  test("lists Contacts membership as authority and reports missing or stale Projects evidence", async () => {
    const projects = new FakeProjectStore();
    projects.read = projectRead([resourceLink(contactId), resourceLink("d9a3bd8a-14b4-4e58-9fe8-6b0274f36f1f")]);
    const contacts = new FakeMembershipAuthority();
    contacts.projectContactIds = [contactId, otherContactId];

    const result = await listProjectContacts(dependencies(projects, contacts), {
      project_id: projectId,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
      max_items: 1000,
    });

    expect(result.authority).toBe("contacts");
    expect(result.contact_ids).toEqual([otherContactId, contactId]);
    expect(result.synchronized_contact_ids).toEqual([contactId]);
    expect(result.missing_project_link_contact_ids).toEqual([otherContactId]);
    expect(result.stale_project_link_contact_ids).toEqual(["d9a3bd8a-14b4-4e58-9fe8-6b0274f36f1f"]);
  });

  test("attaches membership first, then writes immutable Projects evidence with stable step IDs", async () => {
    const projects = new FakeProjectStore();
    const contacts = new FakeMembershipAuthority();

    const result = await attachProjectContact(dependencies(projects, contacts), {
      project_id: projectId,
      contact_id: contactId,
      operation_id: "attach-bianca",
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
      max_items: 1000,
    });

    expect(result.outcome).toBe("accepted");
    expect(contacts.mutations).toEqual([
      expect.objectContaining({
        kind: "attach",
        expected_version: "contacts-v1",
        operation_id: "attach-bianca",
        step_id: "contacts-membership",
      }),
    ]);
    expect(projects.mutations).toHaveLength(1);
    expect(projects.mutations[0]).toMatchObject({
      project_id: projectId,
      operation_id: "attach-bianca",
      step_id: "projects-resource-link",
      mode: "add",
      expected_revision: project.updated_at,
      links: [{
        authority: "contacts",
        service_instance: serviceInstance,
        source_package: "@hasna/contacts",
        target_kind: "contact",
        locator: { kind: "external_uuid", value: contactId },
        scope: "resource",
      }],
    });
    expect(result.evidence.map((item) => item.step_id)).toEqual([
      "contacts-membership",
      "projects-resource-link",
    ]);
  });

  test("returns duplicate without writes when authority membership and Projects evidence already exist", async () => {
    const projects = new FakeProjectStore();
    projects.read = projectRead([resourceLink()]);
    const contacts = new FakeMembershipAuthority();
    contacts.snapshot = membership(true, "contacts-v2");

    const result = await attachProjectContact(dependencies(projects, contacts), {
      project_id: projectId,
      contact_id: contactId,
      operation_id: "attach-bianca",
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
      max_items: 1000,
    });

    expect(result.outcome).toBe("duplicate_of_accepted");
    expect(contacts.mutations).toEqual([]);
    expect(projects.mutations).toEqual([]);
  });

  test("compensates Contacts when the Projects attach CAS fails", async () => {
    const projects = new FakeProjectStore();
    projects.failMutation = new Error("project resource link expected_revision conflict");
    const contacts = new FakeMembershipAuthority();

    await expect(attachProjectContact(dependencies(projects, contacts), {
      project_id: projectId,
      contact_id: contactId,
      operation_id: "attach-bianca",
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
      max_items: 1000,
    })).rejects.toMatchObject({
      name: "ProjectContactLinkOperationError",
      code: "PROJECT_CONTACT_LINK_PROJECT_WRITE_FAILED_COMPENSATED",
      stage: "projects-resource-link",
      compensated: true,
    } satisfies Partial<ProjectContactLinkOperationError>);

    expect(contacts.mutations).toEqual([
      expect.objectContaining({ kind: "attach", step_id: "contacts-membership" }),
      expect.objectContaining({
        kind: "detach",
        expected_version: "contacts-v1:attach",
        step_id: "contacts-membership:compensate",
      }),
    ]);
  });

  test("preserves an exact uncompensated Projects conflict when Contacts was already linked", async () => {
    const projects = new FakeProjectStore();
    projects.failMutation = new Error("project resource link expected_revision conflict");
    const contacts = new FakeMembershipAuthority();
    contacts.snapshot = membership(true, "contacts-v2");

    await expect(attachProjectContact(dependencies(projects, contacts), {
      project_id: projectId,
      contact_id: contactId,
      operation_id: "attach-bianca",
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
      max_items: 1000,
    })).rejects.toMatchObject({
      code: "PROJECT_CONTACT_LINK_PROJECT_WRITE_FAILED",
      stage: "projects-resource-link",
      compensated: false,
    } satisfies Partial<ProjectContactLinkOperationError>);
    expect(contacts.mutations).toEqual([]);
  });

  test("reports an uncompensated partial failure when the inverse Contacts write also fails", async () => {
    const projects = new FakeProjectStore();
    projects.failMutation = new Error("project resource link expected_revision conflict");
    const contacts = new FakeMembershipAuthority();
    contacts.failCompensation = true;

    await expect(attachProjectContact(dependencies(projects, contacts), {
      project_id: projectId,
      contact_id: contactId,
      operation_id: "attach-bianca",
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
      max_items: 1000,
    })).rejects.toMatchObject({
      code: "PROJECT_CONTACT_LINK_PARTIAL_FAILURE",
      stage: "contacts-membership:compensate",
      compensated: false,
    } satisfies Partial<ProjectContactLinkOperationError>);
  });

  test("detaches authoritative membership then reconciles only the matching Projects evidence", async () => {
    const projects = new FakeProjectStore();
    const unrelated = resourceLink(otherContactId);
    projects.read = projectRead([resourceLink(), unrelated]);
    const contacts = new FakeMembershipAuthority();
    contacts.snapshot = membership(true, "contacts-v2");

    const result = await detachProjectContact(dependencies(projects, contacts), {
      project_id: projectId,
      contact_id: contactId,
      operation_id: "detach-bianca",
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
      max_items: 1000,
    });

    expect(result.outcome).toBe("accepted");
    expect(contacts.mutations).toEqual([
      expect.objectContaining({
        kind: "detach",
        expected_version: "contacts-v2",
        step_id: "contacts-membership",
      }),
    ]);
    expect(projects.mutations[0]).toMatchObject({
      mode: "reconcile",
      expected_revision: project.updated_at,
      links: [expect.objectContaining({
        locator: { kind: "external_uuid", value: otherContactId },
      })],
    });
  });
});
