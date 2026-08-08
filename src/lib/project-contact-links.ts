import type { ProjectStore } from "../store/project-store.js";
import type {
  GuardedProjectMutationOutcome,
  ProjectResourceLink,
  ProjectResourceLinkInput,
  ProjectResourceLinkMutationResult,
} from "../types/workspace.js";
import { sha256 } from "./guarded-project-mutation.js";
import { normalizeProjectResourceLink } from "./project-resource-links.js";

export const PROJECT_CONTACT_RESOURCE_LINK_TYPE = {
  authority: "contacts",
  source_package: "@hasna/contacts",
  target_kind: "contact",
  locator_kind: "external_uuid",
  scope: "resource",
} as const;

export const PROJECT_CONTACT_LINK_STEPS = {
  contactsMembership: "contacts-membership",
  projectsResourceLink: "projects-resource-link",
} as const;

export interface ContactProjectMembershipSnapshot {
  contact_id: string;
  project_id: string;
  linked: boolean;
  version: string;
}

export interface ContactProjectMembershipMutationResult {
  outcome: Extract<GuardedProjectMutationOutcome, "accepted" | "duplicate_of_accepted">;
  operation_id: string;
  step_id: string;
  before: ContactProjectMembershipSnapshot;
  after: ContactProjectMembershipSnapshot;
  receipt_id: string;
}

export interface ContactProjectMembershipListResult {
  project_id: string;
  contact_ids: string[];
  complete: true;
  membership_revision: string;
}

export interface ContactProjectMembershipMutationInput {
  contact_id: string;
  project_id: string;
  operation_id: string;
  step_id: string;
  expected_version: string;
}

export interface ContactProjectMembershipAuthority {
  readonly service_instance: string;
  readMembership(input: {
    contact_id: string;
    project_id: string;
  }): Promise<ContactProjectMembershipSnapshot>;
  listProjectMemberships(input: {
    project_id: string;
    max_items: number;
  }): Promise<ContactProjectMembershipListResult>;
  attach(input: ContactProjectMembershipMutationInput): Promise<ContactProjectMembershipMutationResult>;
  detach(input: ContactProjectMembershipMutationInput): Promise<ContactProjectMembershipMutationResult>;
}

export interface ProjectContactLinkDependencies {
  projects: Pick<
    ProjectStore,
    "readProjectResourceLinks" | "mutateProjectResourceLinks" | "rollbackProjectResourceLinks"
  >;
  contacts: ContactProjectMembershipAuthority;
}

export interface ProjectContactLinkBounds {
  project_id: string;
  max_items: number;
  response_byte_limit: number;
  time_budget_ms: number;
}

export interface ProjectContactLinkMutationInput extends ProjectContactLinkBounds {
  contact_id: string;
  operation_id: string;
  labels?: ProjectResourceLinkInput["labels"];
  agent_id?: string;
  source?: "cli" | "mcp" | "agent" | "migration" | "system";
  command?: string;
}

export interface ProjectContactLinkEvidence {
  system: "contacts" | "projects";
  step_id: string;
  outcome: string;
  receipt_id: string | null;
  compensated: boolean;
}

export interface ProjectContactLinkMutationOutput {
  ok: true;
  outcome: "accepted" | "duplicate_of_accepted";
  authority: "contacts";
  project_id: string;
  contact_id: string;
  membership: ContactProjectMembershipSnapshot;
  project_link: ProjectResourceLink | null;
  evidence: ProjectContactLinkEvidence[];
}

export interface ProjectContactLinkListOutput {
  ok: true;
  authority: "contacts";
  project_id: string;
  membership_revision: string;
  project_revision: string;
  contact_ids: string[];
  synchronized_contact_ids: string[];
  missing_project_link_contact_ids: string[];
  stale_project_link_contact_ids: string[];
  project_links: ProjectResourceLink[];
}

export type ProjectContactLinkErrorCode =
  | "PROJECT_CONTACT_LINK_CONTACTS_WRITE_FAILED"
  | "PROJECT_CONTACT_LINK_PROJECT_WRITE_FAILED"
  | "PROJECT_CONTACT_LINK_PROJECT_WRITE_FAILED_COMPENSATED"
  | "PROJECT_CONTACT_LINK_PARTIAL_FAILURE";

export class ProjectContactLinkOperationError extends Error {
  readonly code: ProjectContactLinkErrorCode;
  readonly stage: string;
  readonly compensated: boolean;
  readonly cause: unknown;
  readonly compensation_error: unknown;

  constructor(input: {
    code: ProjectContactLinkErrorCode;
    stage: string;
    compensated: boolean;
    cause: unknown;
    compensation_error?: unknown;
  }) {
    const causeMessage = input.cause instanceof Error ? input.cause.message : String(input.cause);
    const suffix = input.compensation_error
      ? `; compensation failed: ${
        input.compensation_error instanceof Error
          ? input.compensation_error.message
          : String(input.compensation_error)
      }`
      : input.compensated
        ? "; authoritative membership was restored"
        : "";
    super(`${input.code} at ${input.stage}: ${causeMessage}${suffix}`);
    this.name = "ProjectContactLinkOperationError";
    this.code = input.code;
    this.stage = input.stage;
    this.compensated = input.compensated;
    this.cause = input.cause;
    this.compensation_error = input.compensation_error ?? null;
  }
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function contactsMembershipStepId(
  direction: "forward" | "compensate",
  expectedVersion: string,
): string {
  return `${PROJECT_CONTACT_LINK_STEPS.contactsMembership}:${direction}:${sha256(expectedVersion).slice(0, 16)}`;
}

export function projectContactResourceLink(
  serviceInstance: string,
  contactId: string,
  labels?: ProjectResourceLinkInput["labels"],
): ProjectResourceLinkInput {
  return normalizeProjectResourceLink({
    authority: PROJECT_CONTACT_RESOURCE_LINK_TYPE.authority,
    service_instance: serviceInstance,
    source_package: PROJECT_CONTACT_RESOURCE_LINK_TYPE.source_package,
    target_kind: PROJECT_CONTACT_RESOURCE_LINK_TYPE.target_kind,
    locator: {
      kind: PROJECT_CONTACT_RESOURCE_LINK_TYPE.locator_kind,
      value: contactId,
    },
    scope: PROJECT_CONTACT_RESOURCE_LINK_TYPE.scope,
    labels,
  });
}

function isProjectContactLink(
  link: ProjectResourceLink,
  serviceInstance: string,
  contactId?: string,
): boolean {
  return link.authority === PROJECT_CONTACT_RESOURCE_LINK_TYPE.authority
    && link.source_package === PROJECT_CONTACT_RESOURCE_LINK_TYPE.source_package
    && link.target_kind === PROJECT_CONTACT_RESOURCE_LINK_TYPE.target_kind
    && link.service_instance === serviceInstance
    && link.locator.kind === PROJECT_CONTACT_RESOURCE_LINK_TYPE.locator_kind
    && (contactId === undefined || link.locator.value === contactId);
}

function resourceLinkInput(link: ProjectResourceLink): ProjectResourceLinkInput {
  const { id: _id, project_id: _projectId, created_at: _createdAt, updated_at: _updatedAt, ...input } = link;
  return input;
}

function acceptedProjectMutation(result: ProjectResourceLinkMutationResult): ProjectResourceLinkMutationResult {
  if (
    !result.ok
    || !result.after
    || (result.outcome !== "accepted" && result.outcome !== "duplicate_of_accepted")
  ) {
    throw new Error(
      `Projects resource-link mutation was not accepted: ${result.outcome}${
        result.receipt?.reason ? ` (${result.receipt.reason})` : ""
      }`,
    );
  }
  return result;
}

function projectEvidence(result: ProjectResourceLinkMutationResult): ProjectContactLinkEvidence {
  return {
    system: "projects",
    step_id: PROJECT_CONTACT_LINK_STEPS.projectsResourceLink,
    outcome: result.outcome,
    receipt_id: result.receipt?.receipt_id ?? null,
    compensated: false,
  };
}

function contactsEvidence(
  result: ContactProjectMembershipMutationResult,
  compensated = false,
): ProjectContactLinkEvidence {
  return {
    system: "contacts",
    step_id: result.step_id,
    outcome: result.outcome,
    receipt_id: result.receipt_id,
    compensated,
  };
}

async function compensateContacts(
  direction: "attach" | "detach",
  dependencies: ProjectContactLinkDependencies,
  input: ProjectContactLinkMutationInput,
  contactId: string,
  expectedVersion: string,
): Promise<ContactProjectMembershipMutationResult> {
  const mutation = direction === "attach"
    ? dependencies.contacts.attach.bind(dependencies.contacts)
    : dependencies.contacts.detach.bind(dependencies.contacts);
  return mutation({
    contact_id: contactId,
    project_id: input.project_id,
    operation_id: input.operation_id,
    step_id: contactsMembershipStepId("compensate", expectedVersion),
    expected_version: expectedVersion,
  });
}

export async function listProjectContacts(
  dependencies: ProjectContactLinkDependencies,
  input: ProjectContactLinkBounds,
): Promise<ProjectContactLinkListOutput> {
  const [membership, projectRead] = await Promise.all([
    dependencies.contacts.listProjectMemberships({
      project_id: input.project_id,
      max_items: input.max_items,
    }),
    dependencies.projects.readProjectResourceLinks({
      project_id: input.project_id,
      max_items: input.max_items,
      response_byte_limit: input.response_byte_limit,
      time_budget_ms: input.time_budget_ms,
    }),
  ]);
  const projectLinks = projectRead.links.filter((link) =>
    isProjectContactLink(link, dependencies.contacts.service_instance));
  const contactIds = uniqueSorted(membership.contact_ids);
  const projectContactIds = uniqueSorted(projectLinks.map((link) => link.locator.value));
  const authoritySet = new Set(contactIds);
  const projectSet = new Set(projectContactIds);

  return {
    ok: true,
    authority: "contacts",
    project_id: input.project_id,
    membership_revision: membership.membership_revision,
    project_revision: projectRead.current_revision,
    contact_ids: contactIds,
    synchronized_contact_ids: contactIds.filter((id) => projectSet.has(id)),
    missing_project_link_contact_ids: contactIds.filter((id) => !projectSet.has(id)),
    stale_project_link_contact_ids: projectContactIds.filter((id) => !authoritySet.has(id)),
    project_links: projectLinks,
  };
}

export async function attachProjectContact(
  dependencies: ProjectContactLinkDependencies,
  input: ProjectContactLinkMutationInput,
): Promise<ProjectContactLinkMutationOutput> {
  const desiredLink = projectContactResourceLink(
    dependencies.contacts.service_instance,
    input.contact_id,
    input.labels,
  );
  const [membershipBefore, projectRead] = await Promise.all([
    dependencies.contacts.readMembership({
      contact_id: input.contact_id,
      project_id: input.project_id,
    }),
    dependencies.projects.readProjectResourceLinks({
      project_id: input.project_id,
      max_items: input.max_items,
      response_byte_limit: input.response_byte_limit,
      time_budget_ms: input.time_budget_ms,
    }),
  ]);
  const existingLink = projectRead.links.find((link) =>
    isProjectContactLink(link, dependencies.contacts.service_instance, desiredLink.locator.value));
  if (membershipBefore.linked && existingLink) {
    return {
      ok: true,
      outcome: "duplicate_of_accepted",
      authority: "contacts",
      project_id: input.project_id,
      contact_id: desiredLink.locator.value,
      membership: membershipBefore,
      project_link: existingLink,
      evidence: [],
    };
  }

  let membershipAfter = membershipBefore;
  let membershipMutation: ContactProjectMembershipMutationResult | null = null;
  if (!membershipBefore.linked) {
    try {
      membershipMutation = await dependencies.contacts.attach({
        contact_id: desiredLink.locator.value,
        project_id: input.project_id,
        operation_id: input.operation_id,
        step_id: contactsMembershipStepId("forward", membershipBefore.version),
        expected_version: membershipBefore.version,
      });
      membershipAfter = membershipMutation.after;
    } catch (cause) {
      throw new ProjectContactLinkOperationError({
        code: "PROJECT_CONTACT_LINK_CONTACTS_WRITE_FAILED",
        stage: PROJECT_CONTACT_LINK_STEPS.contactsMembership,
        compensated: false,
        cause,
      });
    }
  }

  let rawProjectMutation: ProjectResourceLinkMutationResult;
  try {
    rawProjectMutation = await dependencies.projects.mutateProjectResourceLinks({
      project_id: input.project_id,
      operation_id: input.operation_id,
      step_id: PROJECT_CONTACT_LINK_STEPS.projectsResourceLink,
      mode: "add",
      expected_revision: projectRead.current_revision,
      links: [desiredLink],
      max_items: input.max_items,
      response_byte_limit: input.response_byte_limit,
      time_budget_ms: input.time_budget_ms,
      agent_id: input.agent_id,
      source: input.source,
      command: input.command,
    });
  } catch (cause) {
    throw new ProjectContactLinkOperationError({
      code: "PROJECT_CONTACT_LINK_PARTIAL_FAILURE",
      stage: PROJECT_CONTACT_LINK_STEPS.projectsResourceLink,
      compensated: false,
      cause,
    });
  }

  let projectMutation: ProjectResourceLinkMutationResult;
  try {
    projectMutation = acceptedProjectMutation(rawProjectMutation);
  } catch (cause) {
    if (!membershipMutation || membershipBefore.linked) {
      throw new ProjectContactLinkOperationError({
        code: "PROJECT_CONTACT_LINK_PROJECT_WRITE_FAILED",
        stage: PROJECT_CONTACT_LINK_STEPS.projectsResourceLink,
        compensated: false,
        cause,
      });
    }
    try {
      await compensateContacts(
        "detach",
        dependencies,
        input,
        desiredLink.locator.value,
        membershipAfter.version,
      );
      throw new ProjectContactLinkOperationError({
        code: "PROJECT_CONTACT_LINK_PROJECT_WRITE_FAILED_COMPENSATED",
        stage: PROJECT_CONTACT_LINK_STEPS.projectsResourceLink,
        compensated: true,
        cause,
      });
    } catch (compensationError) {
      if (
        compensationError instanceof ProjectContactLinkOperationError
        && compensationError.code === "PROJECT_CONTACT_LINK_PROJECT_WRITE_FAILED_COMPENSATED"
      ) {
        throw compensationError;
      }
      throw new ProjectContactLinkOperationError({
        code: "PROJECT_CONTACT_LINK_PARTIAL_FAILURE",
        stage: `${PROJECT_CONTACT_LINK_STEPS.contactsMembership}:compensate`,
        compensated: false,
        cause,
        compensation_error: compensationError,
      });
    }
  }

  const projectLink = projectMutation.after!.links.find((link) =>
    isProjectContactLink(link, dependencies.contacts.service_instance, desiredLink.locator.value)) ?? null;
  return {
    ok: true,
    outcome: projectMutation.outcome === "duplicate_of_accepted" && !membershipMutation
      ? "duplicate_of_accepted"
      : "accepted",
    authority: "contacts",
    project_id: input.project_id,
    contact_id: desiredLink.locator.value,
    membership: membershipAfter,
    project_link: projectLink,
    evidence: [
      ...(membershipMutation ? [contactsEvidence(membershipMutation)] : []),
      projectEvidence(projectMutation),
    ],
  };
}

export async function detachProjectContact(
  dependencies: ProjectContactLinkDependencies,
  input: ProjectContactLinkMutationInput,
): Promise<ProjectContactLinkMutationOutput> {
  const normalized = projectContactResourceLink(
    dependencies.contacts.service_instance,
    input.contact_id,
    input.labels,
  );
  const [membershipBefore, projectRead] = await Promise.all([
    dependencies.contacts.readMembership({
      contact_id: normalized.locator.value,
      project_id: input.project_id,
    }),
    dependencies.projects.readProjectResourceLinks({
      project_id: input.project_id,
      max_items: input.max_items,
      response_byte_limit: input.response_byte_limit,
      time_budget_ms: input.time_budget_ms,
    }),
  ]);
  const existingLink = projectRead.links.find((link) =>
    isProjectContactLink(link, dependencies.contacts.service_instance, normalized.locator.value));
  if (!membershipBefore.linked && !existingLink) {
    return {
      ok: true,
      outcome: "duplicate_of_accepted",
      authority: "contacts",
      project_id: input.project_id,
      contact_id: normalized.locator.value,
      membership: membershipBefore,
      project_link: null,
      evidence: [],
    };
  }

  let membershipAfter = membershipBefore;
  let membershipMutation: ContactProjectMembershipMutationResult | null = null;
  if (membershipBefore.linked) {
    try {
      membershipMutation = await dependencies.contacts.detach({
        contact_id: normalized.locator.value,
        project_id: input.project_id,
        operation_id: input.operation_id,
        step_id: contactsMembershipStepId("forward", membershipBefore.version),
        expected_version: membershipBefore.version,
      });
      membershipAfter = membershipMutation.after;
    } catch (cause) {
      throw new ProjectContactLinkOperationError({
        code: "PROJECT_CONTACT_LINK_CONTACTS_WRITE_FAILED",
        stage: PROJECT_CONTACT_LINK_STEPS.contactsMembership,
        compensated: false,
        cause,
      });
    }
  }

  let projectMutation: ProjectResourceLinkMutationResult | null = null;
  if (existingLink) {
    const desired = projectRead.links
      .filter((link) => link.id !== existingLink.id)
      .map(resourceLinkInput);
    let rawProjectMutation: ProjectResourceLinkMutationResult;
    try {
      rawProjectMutation = await dependencies.projects.mutateProjectResourceLinks({
        project_id: input.project_id,
        operation_id: input.operation_id,
        step_id: PROJECT_CONTACT_LINK_STEPS.projectsResourceLink,
        mode: "reconcile",
        expected_revision: projectRead.current_revision,
        links: desired,
        max_items: input.max_items,
        response_byte_limit: input.response_byte_limit,
        time_budget_ms: input.time_budget_ms,
        agent_id: input.agent_id,
        source: input.source,
        command: input.command,
      });
    } catch (cause) {
      throw new ProjectContactLinkOperationError({
        code: "PROJECT_CONTACT_LINK_PARTIAL_FAILURE",
        stage: PROJECT_CONTACT_LINK_STEPS.projectsResourceLink,
        compensated: false,
        cause,
      });
    }

    try {
      projectMutation = acceptedProjectMutation(rawProjectMutation);
    } catch (cause) {
      if (!membershipMutation || !membershipBefore.linked) {
        throw new ProjectContactLinkOperationError({
          code: "PROJECT_CONTACT_LINK_PROJECT_WRITE_FAILED",
          stage: PROJECT_CONTACT_LINK_STEPS.projectsResourceLink,
          compensated: false,
          cause,
        });
      }
      try {
        await compensateContacts(
          "attach",
          dependencies,
          input,
          normalized.locator.value,
          membershipAfter.version,
        );
        throw new ProjectContactLinkOperationError({
          code: "PROJECT_CONTACT_LINK_PROJECT_WRITE_FAILED_COMPENSATED",
          stage: PROJECT_CONTACT_LINK_STEPS.projectsResourceLink,
          compensated: true,
          cause,
        });
      } catch (compensationError) {
        if (
          compensationError instanceof ProjectContactLinkOperationError
          && compensationError.code === "PROJECT_CONTACT_LINK_PROJECT_WRITE_FAILED_COMPENSATED"
        ) {
          throw compensationError;
        }
        throw new ProjectContactLinkOperationError({
          code: "PROJECT_CONTACT_LINK_PARTIAL_FAILURE",
          stage: `${PROJECT_CONTACT_LINK_STEPS.contactsMembership}:compensate`,
          compensated: false,
          cause,
          compensation_error: compensationError,
        });
      }
    }
  }

  return {
    ok: true,
    outcome: projectMutation || membershipMutation ? "accepted" : "duplicate_of_accepted",
    authority: "contacts",
    project_id: input.project_id,
    contact_id: normalized.locator.value,
    membership: membershipAfter,
    project_link: null,
    evidence: [
      ...(membershipMutation ? [contactsEvidence(membershipMutation)] : []),
      ...(projectMutation ? [projectEvidence(projectMutation)] : []),
    ],
  };
}
