process.env["MEMENTOS_DB_PATH"] = ":memory:";

import { beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { getDatabase, resetDatabase } from "../db/database.js";
import { getProject, registerProject } from "../db/projects.js";
import { createSessionJob, getSessionJob } from "../db/session-jobs.js";
import { configureProjectAuthorityTestIdentity } from "../test-support/project-authority-identity.js";
import {
  MEMENTOS_PROJECT_GUARDED_UPDATE_ROUTE,
  createLocalMementosProjectRegistrationAuthority,
  createMementosProjectRegistrationHttpClient,
  deriveMementosProjectRegistrationIdempotencyKey,
  digestMementosProjectRegistrationValue,
  handleMementosProjectRegistrationHttpRequest,
  type MementosProjectGuardedUpdateResult,
  type MementosProjectRegistrationPathHandle,
  type MementosProjectRegistrationRequest,
} from "./index.js";

configureProjectAuthorityTestIdentity();

const PROJECT_ID = "wks_httpregistrationv1";
const PROJECT_PATH = "/tmp/http-registration";

class OwnedPathHandle implements MementosProjectRegistrationPathHandle {
  constructor(private readonly value: string) {}

  withOwnedPath<T>(consumer: (absolutePath: string) => T): T {
    return consumer(this.value);
  }
}

function acceptedGuardedResult(result: MementosProjectGuardedUpdateResult) {
  const { response_control: _responseControl, ...accepted } = result;
  return accepted;
}

beforeEach(() => {
  resetDatabase();
});

describe("Mementos project registration HTTP authority", () => {
  test("guarded update, receipt lookup, stale rejection, replay, and rollback stay private over HTTP", async () => {
    const db = getDatabase();
    const local = createLocalMementosProjectRegistrationAuthority(db, {
      packageVersion: "0.14.81-http-guarded-test",
    });
    const originalPath = "/private/http/guarded-original";
    const updatedPath = "/private/http/guarded-updated";
    const original = registerProject(
      "HTTP guarded original",
      originalPath,
      "restore exactly",
      "http_guarded_original",
      db,
    );
    const requestBodies: string[] = [];
    const responseBodies: string[] = [];
    const fetchImpl: typeof globalThis.fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.method === "POST") requestBodies.push(await request.clone().text());
      const response = await handleMementosProjectRegistrationHttpRequest(
        request,
        new URL(request.url),
        local,
      ) ?? new Response("not found", { status: 404 });
      responseBodies.push(await response.clone().text());
      return response;
    };
    const client = createMementosProjectRegistrationHttpClient({
      baseUrl: "http://mementos.test",
      fetch: fetchImpl,
    });
    const guardedClient = client;
    const capability = await client.capability();
    const updateRequest = {
      authority: "mementos",
      authority_route: MEMENTOS_PROJECT_GUARDED_UPDATE_ROUTE,
      package_version: capability.package_version,
      authority_id: capability.authority_id,
      tenant_id: capability.tenant_id,
      corpus_id: capability.corpus_id,
      operation_id: "http-guarded-update-v1",
      step_id: "mementos_project_path_repair",
      idempotency_key: "http-guarded-update-key-0001",
      expected_revision: original.updated_at,
      updates: { path: new OwnedPathHandle(updatedPath) },
      response_byte_limit: 65_536,
      time_budget_ms: 5_000,
    };

    const accepted = await guardedClient.guardedUpdateProject(original.id, updateRequest);
    const forwardReference = createSessionJob({
      session_id: "http-guarded-forward-replay-reference",
      transcript: "supported HTTP forward replay reference",
      project_id: original.id,
    }, db);
    expect(getSessionJob(forwardReference.id, db)?.project_id).toBe(original.id);
    expect(getProject(original.id, db)?.updated_at).toBe(accepted.record.revision);
    const duplicate = await guardedClient.guardedUpdateProject(original.id, updateRequest);

    const lookupRequest = {
      authority: "mementos",
      authority_route: MEMENTOS_PROJECT_GUARDED_UPDATE_ROUTE,
      package_version: capability.package_version,
      authority_id: capability.authority_id,
      tenant_id: capability.tenant_id,
      corpus_id: capability.corpus_id,
      response_byte_limit: 65_536,
      time_budget_ms: 5_000,
    };
    const lookup = await guardedClient.getGuardedProjectUpdateReceipt(
      original.id,
      accepted.receipt.receipt_id,
      lookupRequest,
    );
    expect(lookup.receipt).toEqual(accepted.receipt);

    const stalePath = "/private/http/stale-clobber";
    await expect(guardedClient.guardedUpdateProject(original.id, {
      ...updateRequest,
      idempotency_key: "http-guarded-stale-key-0001",
      updates: { path: new OwnedPathHandle(stalePath) },
    })).rejects.toMatchObject({
      code: "MEMENTOS_PROJECT_REGISTRATION_CONFLICT",
      details: { project_update_code: "PROJECT_UPDATE_STALE_REVISION" },
    });
    expect(getProject(original.id, db)?.path).toBe(updatedPath);

    const rolledBack = await guardedClient.rollbackGuardedProjectUpdate(original.id, {
      ...lookupRequest,
      operation_id: "http-guarded-update-v1",
      step_id: "mementos_project_path_rollback",
      idempotency_key: "http-guarded-rollback-key-0001",
      expected_revision: accepted.receipt.result_revision,
      accepted_receipt: accepted.receipt,
    });
    expect(rolledBack).toMatchObject({
      record: { target_id: original.id, revision: original.updated_at },
      receipt: {
        direction: "rollback",
        accepted_receipt_id: accepted.receipt.receipt_id,
      },
    });
    expect(getProject(original.id, db)).toEqual(original);
    const rollbackReadback = await guardedClient.readExact({
      resource_kind: "project",
      target_id: original.id,
      target: new OwnedPathHandle(originalPath),
      response_byte_limit: 65_536,
      time_budget_ms: 5_000,
    });
    expect(rollbackReadback).toEqual(rolledBack.record);
    const rollbackReference = createSessionJob({
      session_id: "http-guarded-rollback-replay-reference",
      transcript: "supported HTTP rollback replay reference",
      project_id: original.id,
    }, db);
    expect(getSessionJob(rollbackReference.id, db)?.project_id).toBe(original.id);
    expect(getProject(original.id, db)?.updated_at).toBe(rolledBack.record.revision);
    const rollbackDuplicate = await guardedClient.rollbackGuardedProjectUpdate(original.id, {
      ...lookupRequest,
      operation_id: "http-guarded-update-v1",
      step_id: "mementos_project_path_rollback",
      idempotency_key: "http-guarded-rollback-key-0001",
      expected_revision: accepted.receipt.result_revision,
      accepted_receipt: accepted.receipt,
    });
    const replayedPublicResults = [
      acceptedGuardedResult(duplicate),
      acceptedGuardedResult(rollbackDuplicate),
    ];
    const acceptedPublicResults = [
      acceptedGuardedResult(accepted),
      acceptedGuardedResult(rolledBack),
    ];
    expect(replayedPublicResults).toEqual(acceptedPublicResults);
    expect(JSON.stringify(replayedPublicResults)).toBe(JSON.stringify(acceptedPublicResults));
    expect(requestBodies.some((body) => body.includes(updatedPath))).toBe(true);
    expect(responseBodies.every((body) => !body.includes(originalPath))).toBe(true);
    expect(responseBodies.every((body) => !body.includes(updatedPath))).toBe(true);
    expect(responseBodies.every((body) => !body.includes(stalePath))).toBe(true);
    expect(JSON.stringify({ capability, accepted, duplicate, lookup, rolledBack }))
      .not.toContain(originalPath);
    expect(JSON.stringify({ capability, accepted, duplicate, lookup, rolledBack }))
      .not.toContain(updatedPath);
    expect(JSON.stringify(replayedPublicResults)).not.toContain(originalPath);
    expect(JSON.stringify(replayedPublicResults)).not.toContain(updatedPath);
  });

  test("round-trips the private path through the public client without returning it", async () => {
    const local = createLocalMementosProjectRegistrationAuthority(getDatabase(), {
      packageVersion: "0.14.75-http-test",
      authorityId: "mementos-http-test",
      tenantId: "tenant-http-test",
      corpusId: "corpus-http-test",
      now: () => "2026-08-07T12:00:00.000Z",
    });
    const requestBodies: string[] = [];
    const fetchImpl: typeof globalThis.fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.method === "POST") requestBodies.push(await request.clone().text());
      const response = await handleMementosProjectRegistrationHttpRequest(
        request,
        new URL(request.url),
        local,
      );
      return response ?? new Response("not found", { status: 404 });
    };
    const client = createMementosProjectRegistrationHttpClient({
      baseUrl: "http://mementos.test",
      fetch: fetchImpl,
    });
    const capability = await client.capability();
    const target = new OwnedPathHandle(PROJECT_PATH);
    const desired = {
      source_project_id: PROJECT_ID,
      source_project_slug: "http-registration",
      name: "HTTP Registration",
      target_path_digest: createHash("sha256").update(PROJECT_PATH).digest("hex"),
    };
    const requestDigest = digestMementosProjectRegistrationValue(desired);
    const preconditionDigest = digestMementosProjectRegistrationValue({
      target_selector: PROJECT_ID,
      expected: "absent",
    });
    const request: MementosProjectRegistrationRequest = {
      operation_id: "http-registration-operation-v1",
      step_id: "mementos_project",
      resource_kind: "project",
      direction: "forward",
      authority_route: capability.route,
      package_version: capability.package_version,
      authority_id: capability.authority_id,
      tenant_id: capability.tenant_id,
      corpus_id: capability.corpus_id,
      target_selector: PROJECT_ID,
      idempotency_key: deriveMementosProjectRegistrationIdempotencyKey({
        operation_id: "http-registration-operation-v1",
        step_id: "mementos_project",
        direction: "forward",
        target_selector: PROJECT_ID,
        request_digest: requestDigest,
        precondition_digest: preconditionDigest,
      }),
      request_digest: requestDigest,
      precondition_digest: preconditionDigest,
      project_id: PROJECT_ID,
      project_slug: "http-registration",
      project_name: "HTTP Registration",
      desired,
      target,
      response_byte_limit: 65_536,
      time_budget_ms: 5_000,
    };

    const accepted = await client.create(request);
    const record = await client.readExact({
      resource_kind: "project",
      target_id: accepted.target_id!,
      target,
      response_byte_limit: 65_536,
      time_budget_ms: 5_000,
    });
    const duplicate = await client.create(request);

    expect(accepted.outcome).toBe("accepted");
    expect(record).toMatchObject({
      target_id: accepted.target_id,
      revision: accepted.result_revision,
      digest: accepted.result_digest,
    });
    expect(duplicate).toMatchObject({
      outcome: "duplicate_of_accepted",
      duplicate_of_receipt_id: accepted.receipt_id,
    });
    expect(requestBodies.some((body) => body.includes(PROJECT_PATH))).toBe(true);
    expect(requestBodies.every((body) => !body.includes('"target"'))).toBe(true);
    expect(JSON.stringify({ capability, accepted, record, duplicate })).not.toContain(PROJECT_PATH);
  });

  test("fails closed when the private transport omits the canonical path", async () => {
    const local = createLocalMementosProjectRegistrationAuthority(getDatabase(), {
      packageVersion: "0.14.75-http-test",
    });
    const response = await handleMementosProjectRegistrationHttpRequest(
      new Request("http://mementos.test/v1/project-registration/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource_kind: "project" }),
      }),
      new URL("http://mementos.test/v1/project-registration/create"),
      local,
    );

    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toMatchObject({
      code: "MEMENTOS_PROJECT_REGISTRATION_INVALID_INPUT",
      authoritative: true,
    });
  });
});
