import { describe, expect, test } from "bun:test";
import {
  ProjectsClient,
  type GuardedProjectMutationResult,
  type LegacyVersionResponse,
  type ProjectContactLinkMutationRequest,
  type ProjectResourceLinkInput,
  type ProjectResourceLinkMigrationManifestV1,
  type ProjectResourceLinkProducerBinding,
  type UpdateWorkspace,
  type Workspace,
} from "./client.js";
import type { ProjectResourceLinkInput as WorkspaceProjectResourceLinkInput } from "../types/workspace.js";

type AssertTrue<T extends true> = T;
type AssertFalse<T extends false> = T;

type TodosTaskLinkShape = {
  authority: "todos";
  service_instance: "urn:hasna:todos:test";
  source_package: "@hasna/todos";
  target_kind: "task";
  locator: { kind: "external_uuid"; value: "e2f791bd-f26b-4fac-a762-2cba96202aa5" };
  scope: "resource";
};

type KnowledgeTaskLinkShape = {
  authority: "knowledge";
  service_instance: "urn:hasna:knowledge:test";
  source_package: "@hasna/knowledge";
  target_kind: "task";
  locator: { kind: "external_uuid"; value: "e2f791bd" };
  scope: "resource";
};

type TodosTaskCanonicalUriShape = Omit<TodosTaskLinkShape, "locator"> & {
  locator: { kind: "canonical_uri"; value: "urn:hasna:todos:task:e2f791bd" };
};

type WorkspaceContractAcceptsTodosTask = AssertTrue<
  TodosTaskLinkShape extends WorkspaceProjectResourceLinkInput ? true : false
>;
type WorkspaceContractRejectsKnowledgeTask = AssertFalse<
  KnowledgeTaskLinkShape extends WorkspaceProjectResourceLinkInput ? true : false
>;
type WorkspaceContractRejectsTaskCanonicalUri = AssertFalse<
  TodosTaskCanonicalUriShape extends WorkspaceProjectResourceLinkInput ? true : false
>;
type GeneratedSdkAcceptsTodosTask = AssertTrue<
  TodosTaskLinkShape extends ProjectResourceLinkInput ? true : false
>;
type GeneratedSdkRejectsKnowledgeTask = AssertFalse<
  KnowledgeTaskLinkShape extends ProjectResourceLinkInput ? true : false
>;
type GeneratedSdkRejectsTaskCanonicalUri = AssertFalse<
  TodosTaskCanonicalUriShape extends ProjectResourceLinkInput ? true : false
>;

const workspaceFixture: Workspace = {
  id: "wks_sdkparity0001",
  slug: "sdk-parity",
  name: "SDK Parity",
  kind: "generic",
  status: "active",
  s3_bucket: null,
  s3_prefix: null,
  last_opened_at: null,
  synced_at: null,
};

const openTimestampPatch: UpdateWorkspace = {
  last_opened_at: "2026-08-08T11:00:00.000Z",
};

const nullableProducerBinding: ProjectResourceLinkProducerBinding = {
  authority_id: "contacts",
  tenant_id: "tenant-primary",
  corpus_id: null,
  capability_digest: "sha256:contacts-capability",
};

const migrationSchemaDiscriminator: ProjectResourceLinkMigrationManifestV1["schema"] =
  "projects.project_resource_link_migration_manifest.v1";

const terminalFixture: GuardedProjectMutationResult = {
  ok: false,
  dry_run: false,
  outcome: "terminal_nonacceptance",
  idempotency_key: "gpm_sdk_parity",
  request_digest: "request",
  precondition_digest: "precondition",
  project_id: workspaceFixture.id,
  expected_revision: "2026-08-07 00:00:00",
  current_revision: "2026-08-07 00:00:00",
  before: workspaceFixture,
  after: null,
  receipt: null,
  response_control: {
    response_byte_limit: 65536,
    time_budget_ms: 10000,
    response_bytes: 1024,
    elapsed_ms: 1,
    complete: true,
    truncated: false,
  },
};

describe("generated Projects SDK server parity", () => {
  test("keeps the legacy getVersion mode type and exact response", async () => {
    const client = new ProjectsClient({
      baseUrl: "https://projects.example.test",
      fetch: (async (_input: string | URL | Request, _init?: RequestInit) =>
        Response.json({ status: "ok", version: "9.9.9", mode: "cloud" })) as typeof fetch,
    });

    const response: LegacyVersionResponse = await client.getVersion();
    const mode: string = response.mode;

    expect(response).toEqual({ status: "ok", version: "9.9.9", mode: "cloud" });
    expect(mode).toBe("cloud");
  });

  test("accepts full workspace storage timestamps and terminal nullable fields", () => {
    expect(workspaceFixture).toMatchObject({
      s3_bucket: null,
      s3_prefix: null,
      last_opened_at: null,
      synced_at: null,
    });
    expect(terminalFixture).toMatchObject({ after: null, receipt: null });
    expect(openTimestampPatch.last_opened_at).toBe("2026-08-08T11:00:00.000Z");
    expect(nullableProducerBinding.corpus_id).toBeNull();
    expect(migrationSchemaDiscriminator).toBe("projects.project_resource_link_migration_manifest.v1");
  });

  test("routes typed resource-link read, add, reconcile, and rollback with exact payloads", async () => {
    const calls: Array<{
      method: string;
      path: string;
      query: string;
      body: unknown;
      apiKey: string | null;
    }> = [];
    const client = new ProjectsClient({
      baseUrl: "https://projects.example.test",
      apiKey: "sdk-test-key",
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        const headers = new Headers(init?.headers);
        calls.push({
          method: init?.method ?? "GET",
          path: url.pathname,
          query: url.search,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
          apiKey: headers.get("x-api-key"),
        });
        return Response.json({});
      }) as typeof fetch,
    });
    const projectId = "wks_sdkparity0001";
    const link: ProjectResourceLinkInput = {
      authority: "contacts",
      service_instance: "urn:hasna:contacts:test",
      source_package: "@hasna/contacts",
      target_kind: "contact",
      locator: {
        kind: "external_uuid",
        value: "6b68e131-abe5-43b7-92cd-9930b04611df",
      },
      scope: "resource",
      labels: { name: "Bianca" },
    };
    const mutation = {
      operation_id: "sdk-resource-links",
      step_id: "links",
      expected_revision: "2026-08-08 00:00:00.000",
      links: [link],
      max_items: 10,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    };

    await client.readProjectResourceLinks(projectId, {
      max_items: 10,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    });
    await client.addProjectResourceLinks(projectId, mutation);
    await client.reconcileProjectResourceLinks(projectId, mutation);
    await client.rollbackProjectResourceLinks(projectId, {
      operation_id: "sdk-resource-links-rollback",
      step_id: "rollback-links",
      accepted_receipt_id: "gpmr_sdk_resource_links",
      expected_current_revision: "2026-08-08 00:00:01.000",
      max_items: 10,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    });

    expect(calls.map((call) => [call.method, call.path])).toEqual([
      ["GET", `/v1/projects/${projectId}/resource-links`],
      ["POST", `/v1/projects/${projectId}/resource-links/add`],
      ["POST", `/v1/projects/${projectId}/resource-links/reconcile`],
      ["POST", `/v1/projects/${projectId}/resource-links/rollback`],
    ]);
    expect(calls[0]?.query).toBe("?max_items=10&response_byte_limit=100000&time_budget_ms=5000");
    expect(calls[1]?.body).toEqual(mutation);
    expect(calls[2]?.body).toEqual(mutation);
    expect(calls[3]?.body).toEqual(expect.objectContaining({
      accepted_receipt_id: "gpmr_sdk_resource_links",
    }));
    expect(calls.every((call) => call.apiKey === "sdk-test-key")).toBe(true);
  });

  test("routes durable resource-link migration plan, read, advance, and rollback", async () => {
    const calls: Array<{ method: string; path: string; query: string; body: unknown }> = [];
    const client = new ProjectsClient({
      baseUrl: "https://projects.example.test",
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        calls.push({
          method: init?.method ?? "GET",
          path: url.pathname,
          query: url.search,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return Response.json({});
      }) as typeof fetch,
    });
    const projectId = workspaceFixture.id;
    const manifestId = "prlm_sdk_parity";
    const plan = {
      operation_id: "sdk-resource-link-migration",
      step_id: "plan",
      expected_project_revision: "2026-08-08 00:00:00.000",
      links: [{
        link: {
          authority: "contacts" as const,
          service_instance: "urn:hasna:contacts:test",
          source_package: "@hasna/contacts" as const,
          target_kind: "contact" as const,
          locator: {
            kind: "external_uuid" as const,
            value: "6b68e131-abe5-43b7-92cd-9930b04611df",
          },
          scope: "resource" as const,
        },
        producer_resource_kind: "contact",
        producer_binding: nullableProducerBinding,
      }],
      max_items: 10,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    };
    const advance = {
      expected_transition_version: 1,
      next_state: "producer_applied" as const,
      max_items: 10,
      producer_evidence: [{
        created_by_operation: true,
        forward_receipt_id: "contacts-receipt-1",
        child_link_receipt_ids: [],
        target_revision: "contacts-revision-1",
        target_digest: "contacts-digest-1",
        inverse_verified: false,
        inverse_outcome: "pending",
      }],
      evidence: { phase: "producer" },
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    };
    const rollback = {
      expected_transition_version: 2,
      max_items: 10,
      producer_outcome: "pending" as const,
      producer_evidence: [{
        ...advance.producer_evidence[0]!,
        target_revision: "contacts-revision-2",
        target_digest: "contacts-digest-2",
        inverse_verified: true,
        inverse_outcome: "complete",
      }],
      evidence: { reason: "test" },
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    };

    await client.planProjectResourceLinkMigration(projectId, plan);
    await client.readProjectResourceLinkMigration(projectId, manifestId, {
      max_items: 10,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    });
    await client.advanceProjectResourceLinkMigration(projectId, manifestId, advance);
    await client.rollbackProjectResourceLinkMigration(projectId, manifestId, rollback);

    expect(calls.map((call) => [call.method, call.path])).toEqual([
      ["POST", `/v1/projects/${projectId}/resource-link-migrations/plan`],
      ["GET", `/v1/projects/${projectId}/resource-link-migrations/${manifestId}`],
      ["POST", `/v1/projects/${projectId}/resource-link-migrations/${manifestId}/advance`],
      ["POST", `/v1/projects/${projectId}/resource-link-migrations/${manifestId}/rollback`],
    ]);
    expect(calls[0]?.body).toEqual(plan);
    expect(calls[1]?.query).toBe("?max_items=10&response_byte_limit=100000&time_budget_ms=5000");
    expect(calls[2]?.body).toEqual(advance);
    expect(calls[3]?.body).toEqual(rollback);
  });

  test("routes contact list, attach, and detach through the generated Projects client", async () => {
    const calls: Array<{ method: string; path: string; query: string; body: unknown }> = [];
    const client = new ProjectsClient({
      baseUrl: "https://projects.example.test",
      apiKey: "sdk-test-key",
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        calls.push({
          method: init?.method ?? "GET",
          path: url.pathname,
          query: url.search,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return Response.json({});
      }) as typeof fetch,
    });
    const projectId = "wks_eHb1kcLUzgQVJQt6L0CCB";
    const contactId = "6b68e131-abe5-43b7-92cd-9930b04611df";
    const bounds = {
      max_items: 1000,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    };
    const mutation: ProjectContactLinkMutationRequest = {
      operation_id: "sdk-project-contact",
      ...bounds,
    };

    await client.listProjectContacts(projectId, bounds);
    await client.attachProjectContact(projectId, contactId, mutation);
    await client.detachProjectContact(projectId, contactId, {
      ...mutation,
      operation_id: "sdk-project-contact-detach",
    });

    expect(calls).toEqual([
      {
        method: "GET",
        path: `/v1/projects/${projectId}/contacts`,
        query: "?max_items=1000&response_byte_limit=100000&time_budget_ms=5000",
        body: undefined,
      },
      {
        method: "POST",
        path: `/v1/projects/${projectId}/contacts/${contactId}/attach`,
        query: "",
        body: mutation,
      },
      {
        method: "POST",
        path: `/v1/projects/${projectId}/contacts/${contactId}/detach`,
        query: "",
        body: { ...mutation, operation_id: "sdk-project-contact-detach" },
      },
    ]);
  });
});
