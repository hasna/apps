import { describe, expect, test } from "bun:test";
import {
  ProjectsClient,
  type GuardedProjectMutationResult,
  type ProjectResourceLinkInput,
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
  test("accepts full workspace storage timestamps and terminal nullable fields", () => {
    expect(workspaceFixture).toMatchObject({
      s3_bucket: null,
      s3_prefix: null,
      last_opened_at: null,
      synced_at: null,
    });
    expect(terminalFixture).toMatchObject({ after: null, receipt: null });
    expect(openTimestampPatch.last_opened_at).toBe("2026-08-08T11:00:00.000Z");
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
});
