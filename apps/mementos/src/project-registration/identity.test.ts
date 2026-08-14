process.env["MEMENTOS_DB_PATH"] = ":memory:";

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { getDatabase, resetDatabase } from "../db/database.js";
import {
  applyMemoryProjectLink,
  getMemoryProjectLinkReceipt,
  previewMemoryProjectLink,
} from "../db/memory-project-link.js";
import { createMemory } from "../db/memories.js";
import {
  applyProjectUpdate,
  getProject,
  getProjectUpdateReceipt,
  previewProjectUpdate,
  registerProject,
} from "../db/projects.js";
import {
  buildMementosProjectRegistrationCapability,
  createLocalMementosProjectRegistrationAuthority,
  deriveMementosProjectRegistrationIdempotencyKey,
  digestMementosProjectRegistrationValue,
  MEMENTOS_PROJECT_AUTHORITY_ENV,
  readMementosProjectResourcePage,
  resolveMementosProjectAuthorityIdentity,
  type MementosProjectRegistrationPathHandle,
  type MementosProjectRegistrationRequest,
} from "./index.js";

const LIVE_IDENTITY = {
  authority_id: "mementos-live-authority",
  tenant_id: "tenant-live",
  corpus_id: "corpus-live",
} as const;

const savedIdentityEnv = {
  authorityId: process.env[MEMENTOS_PROJECT_AUTHORITY_ENV.authorityId],
  tenantId: process.env[MEMENTOS_PROJECT_AUTHORITY_ENV.tenantId],
  corpusId: process.env[MEMENTOS_PROJECT_AUTHORITY_ENV.corpusId],
};

class OwnedPathHandle implements MementosProjectRegistrationPathHandle {
  constructor(private readonly value: string) {}

  withOwnedPath<T>(consumer: (absolutePath: string) => T): T {
    return consumer(this.value);
  }
}

function clearIdentityEnv(): void {
  delete process.env[MEMENTOS_PROJECT_AUTHORITY_ENV.authorityId];
  delete process.env[MEMENTOS_PROJECT_AUTHORITY_ENV.tenantId];
  delete process.env[MEMENTOS_PROJECT_AUTHORITY_ENV.corpusId];
}

function setLiveIdentityEnv(): void {
  process.env[MEMENTOS_PROJECT_AUTHORITY_ENV.authorityId] = LIVE_IDENTITY.authority_id;
  process.env[MEMENTOS_PROJECT_AUTHORITY_ENV.tenantId] = LIVE_IDENTITY.tenant_id;
  process.env[MEMENTOS_PROJECT_AUTHORITY_ENV.corpusId] = LIVE_IDENTITY.corpus_id;
}

function restoreIdentityEnv(): void {
  for (const [field, envKey] of Object.entries(MEMENTOS_PROJECT_AUTHORITY_ENV)) {
    const value = savedIdentityEnv[field as keyof typeof savedIdentityEnv];
    if (value === undefined) delete process.env[envKey];
    else process.env[envKey] = value;
  }
}

function projectUpdateRequest(project: ReturnType<typeof registerProject>) {
  return {
    ...LIVE_IDENTITY,
    operation_id: "live-project-update-v1",
    step_id: "mementos_project_update",
    idempotency_key: "live-project-update-key-0001",
    expected_revision: project.updated_at,
    updates: { description: "live authority partition" },
  };
}

function memoryLinkRequest(
  memory: ReturnType<typeof createMemory>,
  project: ReturnType<typeof registerProject>,
) {
  return {
    ...LIVE_IDENTITY,
    operation_id: "live-memory-project-link-v1",
    step_id: "mementos_memory_project_link",
    idempotency_key: "live-memory-project-link-key-0001",
    expected_memory_version: memory.version,
    expected_memory_revision: memory.updated_at,
    target_project_id: project.id,
    expected_project_revision: project.updated_at,
  };
}

beforeEach(() => {
  clearIdentityEnv();
  resetDatabase();
});

afterAll(() => {
  restoreIdentityEnv();
});

describe("live Mementos project authority identity", () => {
  test("no configuration fails closed before advertisement, guarded writes, or receipts", () => {
    const project = registerProject("Unconfigured", "/projects/unconfigured");
    const memory = createMemory({
      key: "unconfigured-memory",
      value: "must remain unlinked",
      scope: "shared",
    });

    expect(() => resolveMementosProjectAuthorityIdentity())
      .toThrow(/project authority identity is not configured/i);
    expect(() => buildMementosProjectRegistrationCapability())
      .toThrow(/project authority identity is not configured/i);
    expect(() => createLocalMementosProjectRegistrationAuthority(getDatabase()))
      .toThrow(/project authority identity is not configured/i);
    expect(() => readMementosProjectResourcePage(project.id))
      .toThrow(/project authority identity is not configured/i);
    expect(() => previewProjectUpdate(project.id, {
      ...projectUpdateRequest(project),
      authority_id: "mementos",
      tenant_id: "default",
      corpus_id: "default",
    })).toThrow(/project authority identity is not configured/i);
    expect(() => previewMemoryProjectLink(memory.id, {
      ...memoryLinkRequest(memory, project),
      authority_id: "mementos",
      tenant_id: "default",
      corpus_id: "default",
    })).toThrow(/project authority identity is not configured/i);

    expect(getProject(project.id)).toEqual(project);
    expect(memory.project_id).toBeNull();
  });

  test("one explicit live tuple partitions registration, resources, and guarded receipts", async () => {
    setLiveIdentityEnv();
    expect(resolveMementosProjectAuthorityIdentity()).toEqual(LIVE_IDENTITY);
    expect(buildMementosProjectRegistrationCapability()).toMatchObject(LIVE_IDENTITY);

    const authority = createLocalMementosProjectRegistrationAuthority(getDatabase(), {
      packageVersion: "0.14.81-live-identity-test",
    });
    const capability = await authority.capability();
    const projectId = "wks_liveidentity0001";
    const projectPath = "/projects/live-identity";
    const desired = {
      source_project_id: projectId,
      source_project_slug: "live-identity",
      name: "Live identity",
      target_path_digest: createHash("sha256").update(projectPath).digest("hex"),
    };
    const requestDigest = digestMementosProjectRegistrationValue(desired);
    const preconditionDigest = digestMementosProjectRegistrationValue({
      target_selector: projectId,
      expected: "absent",
    });
    const registrationRequest: MementosProjectRegistrationRequest = {
      operation_id: "live-identity-registration-v1",
      step_id: "mementos_project",
      resource_kind: "project",
      direction: "forward",
      authority_route: capability.route,
      package_version: capability.package_version,
      authority_id: capability.authority_id,
      tenant_id: capability.tenant_id,
      corpus_id: capability.corpus_id,
      target_selector: projectId,
      idempotency_key: "",
      request_digest: requestDigest,
      precondition_digest: preconditionDigest,
      project_id: projectId,
      project_slug: "live-identity",
      project_name: "Live identity",
      desired,
      target: new OwnedPathHandle(projectPath),
      response_byte_limit: 65_536,
      time_budget_ms: 5_000,
    };
    registrationRequest.idempotency_key =
      deriveMementosProjectRegistrationIdempotencyKey(registrationRequest);
    const registrationReceipt = await authority.create(registrationRequest);
    expect(registrationReceipt).toMatchObject(LIVE_IDENTITY);

    const project = getProject(registrationReceipt.target_id!)!;
    const resourcePage = readMementosProjectResourcePage(project.id);
    expect(resourcePage.authority).toMatchObject(LIVE_IDENTITY);

    const projectUpdate = applyProjectUpdate(project.id, projectUpdateRequest(project));
    expect(projectUpdate.receipt).toMatchObject(LIVE_IDENTITY);

    const memory = createMemory({
      key: "live-identity-memory",
      value: "partitioned receipt",
      scope: "shared",
    });
    const memoryLink = applyMemoryProjectLink(
      memory.id,
      memoryLinkRequest(memory, projectUpdate.project),
    );
    expect(memoryLink.receipt).toMatchObject(LIVE_IDENTITY);

    process.env[MEMENTOS_PROJECT_AUTHORITY_ENV.tenantId] = "tenant-other";
    expect(() => getProjectUpdateReceipt(
      project.id,
      projectUpdate.receipt!.receipt_id,
      LIVE_IDENTITY,
    )).toThrow(/does not match this authority/i);
    expect(() => getMemoryProjectLinkReceipt(
      memory.id,
      memoryLink.receipt!.receipt_id,
      LIVE_IDENTITY,
    )).toThrow(/does not match this authority/i);
  });
});
