import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { SYNCABLE_TABLES } from "../src/db/schema.js";
import { getDatabase } from "../src/db/database.js";
import { createIdentity, setIdentityStatus } from "../src/services/identities.js";
import {
  approveAccessRequest,
  cancelAccessRequest,
  createAccessRequest,
  failAccessRequest,
  getAccessRequest,
  listAccessRequests,
  markAccessRequestProvisioned,
} from "../src/services/access-requests.js";
import { SYSTEM_AUTHORIZATION_CONTEXT, type AuthorizationContext } from "../src/services/authorization.js";
import { InvalidTransitionError, PermissionDeniedError, ValidationError } from "../src/types/index.js";
import { cleanupTestDatabase, useTestDatabase } from "./helpers/database.js";

let dbPath: string;
let entityA: string;
let entityB: string;

beforeEach(() => {
  dbPath = useTestDatabase("access-requests");
  entityA = randomUUID();
  entityB = randomUUID();
});

afterEach(() => cleanupTestDatabase(dbPath));

function createAgent(entityId = entityA) {
  return createIdentity({ entity_id: entityId, kind: "agent", name: `agent-${entityId.slice(0, 8)}` }, SYSTEM_AUTHORIZATION_CONTEXT);
}

function readCtx(entityId = entityA): AuthorizationContext {
  return { actor_id: "agent-client", roles: ["auditor"], entity_ids: [entityId] };
}

function approverCtx(entityId = entityA): AuthorizationContext {
  return { actor_id: "approver", roles: ["approver"], entity_ids: [entityId] };
}

function writerCtx(entityId = entityA): AuthorizationContext {
  return { actor_id: "provisioner", roles: ["integration"], entity_ids: [entityId] };
}

function requestFor(identityId: string) {
  return {
    requested_by_identity_id: identityId,
    provider: "github",
    resource_kind: "repository_deploy_key",
    resource_ref: "github:hasna/access",
  };
}

function fakeRawSecret(...parts: string[]): string {
  return parts.join("");
}

describe("access request schema", () => {
  it("creates the syncable provider-backed request table", () => {
    const db = getDatabase();
    const columns = db.query("PRAGMA table_info(access_requests)").all() as Array<{ name: string }>;
    const names = columns.map((column) => column.name);
    expect(names).toContain("provider");
    expect(names).toContain("resource_kind");
    expect(names).toContain("resource_ref");
    expect(names).toContain("requested_by_identity_id");
    expect(names).toContain("policy_decision");
    expect(names).toContain("secret_ref");
    expect(names).toContain("command_preview");
    expect(names).toContain("provision_metadata");
    expect(SYNCABLE_TABLES).toContain("access_requests");
  });
});

describe("access request creation", () => {
  it("lets an active agent create a provider-backed request under the permissive default policy", () => {
    const agent = createAgent();
    const created = createAccessRequest(requestFor(agent.id), readCtx());

    expect(created.status).toBe("pending");
    expect(created.entity_id).toBe(entityA);
    expect(created.requested_by_identity_id).toBe(agent.id);
    expect(created.provider).toBe("github");
    expect(created.resource_kind).toBe("repository_deploy_key");
    expect(created.policy_mode).toBe("permissive_default");
    expect(created.policy_decision).toBe("allow");
    expect(created.secret_ref).toContain(`/github/repository_deploy_key/${created.id}`);
    expect(created.command_preview["redacted"]).toBe(true);
    expect(JSON.stringify(created.command_preview)).not.toContain("sk-");
    expect(getAccessRequest(created.id, readCtx()).id).toBe(created.id);
  });

  it("retains deny-by-default authorization for unscoped or actionless callers", () => {
    const agent = createAgent();
    const noRoleCtx: AuthorizationContext = { actor_id: "roleless", roles: [], entity_ids: [entityA] };
    const foreignCtx: AuthorizationContext = { actor_id: "reader-b", roles: ["auditor"], entity_ids: [entityB] };

    expect(() => createAccessRequest(requestFor(agent.id), noRoleCtx)).toThrow(PermissionDeniedError);
    expect(() => createAccessRequest(requestFor(agent.id), foreignCtx)).toThrow(PermissionDeniedError);
  });

  it("requires the requester to be an active agent identity", () => {
    const human = createIdentity({ entity_id: entityA, kind: "human", name: "andrei" }, SYSTEM_AUTHORIZATION_CONTEXT);
    const suspended = setIdentityStatus(createAgent().id, "suspended", SYSTEM_AUTHORIZATION_CONTEXT);

    expect(() => createAccessRequest(requestFor(human.id), readCtx())).toThrow(ValidationError);
    expect(() => createAccessRequest(requestFor(suspended.id), readCtx())).toThrow(ValidationError);
  });

  it("rejects raw secret-looking values in request and provision metadata", () => {
    const agent = createAgent();
    const fakeApiKey = fakeRawSecret("sk", "-", "ant-should-not-be-stored");
    const fakeAssignmentSecret = fakeRawSecret("token", "=", "abc123".repeat(6));

    expect(() =>
      createAccessRequest({ ...requestFor(agent.id), resource_ref: fakeApiKey }, readCtx()),
    ).toThrow(ValidationError);

    const request = approveAccessRequest(createAccessRequest(requestFor(agent.id), readCtx()).id, {}, approverCtx());
    expect(() =>
      markAccessRequestProvisioned(request.id, { provision_metadata: { provider_token: fakeApiKey } }, writerCtx()),
    ).toThrow(ValidationError);
    expect(() => markAccessRequestProvisioned(request.id, { secret_ref: "plainref" }, writerCtx())).toThrow(ValidationError);
    expect(() => failAccessRequest(request.id, { reason: fakeAssignmentSecret }, writerCtx())).toThrow(ValidationError);
  });
});

describe("access request listing and lifecycle", () => {
  it("filters lists to the caller's allowed entity set", () => {
    const agentA = createAgent(entityA);
    const agentB = createAgent(entityB);
    createAccessRequest(requestFor(agentA.id), SYSTEM_AUTHORIZATION_CONTEXT);
    createAccessRequest({ ...requestFor(agentB.id), resource_ref: "github:hasna/other" }, SYSTEM_AUTHORIZATION_CONTEXT);

    const visible = listAccessRequests({}, readCtx(entityA));
    expect(visible).toHaveLength(1);
    expect(visible[0]!.entity_id).toBe(entityA);
  });

  it("approves and marks a request provisioned without storing secret values", () => {
    const agent = createAgent();
    const request = createAccessRequest(requestFor(agent.id), readCtx());
    expect(() => markAccessRequestProvisioned(request.id, {}, writerCtx())).toThrow(InvalidTransitionError);
    const approved = approveAccessRequest(request.id, { decision_metadata: { ticket: "ACC-1" } }, approverCtx());
    expect(approved.status).toBe("approved");
    expect(approved.approved_by).toBe("approver");

    const provisioned = markAccessRequestProvisioned(
      request.id,
      { provision_metadata: { provider_request_id: "req_123", stored_secret_ref: approved.secret_ref } },
      writerCtx(),
    );
    expect(provisioned.status).toBe("provisioned");
    expect(provisioned.provision_metadata?.["provider_request_id"]).toBe("req_123");
    expect(JSON.stringify(provisioned)).not.toContain("sk-");
    expect(() => cancelAccessRequest(provisioned.id, { reason: "too late" }, writerCtx())).toThrow(InvalidTransitionError);
  });

  it("fails or cancels only pending/approved requests", () => {
    const agent = createAgent();
    const failed = failAccessRequest(createAccessRequest(requestFor(agent.id), readCtx()).id, { reason: "provider quota" }, writerCtx());
    expect(failed.status).toBe("failed");
    expect(failed.failure_reason).toBe("provider quota");

    const approved = approveAccessRequest(createAccessRequest({ ...requestFor(agent.id), resource_ref: "github:hasna/cancel" }, readCtx()).id, {}, approverCtx());
    const cancelled = cancelAccessRequest(approved.id, { reason: "no longer needed" }, writerCtx());
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancel_reason).toBe("no longer needed");
  });
});
