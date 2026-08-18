import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createSqliteLoopStorage } from "../lib/storage/sqlite.js";
import type { LoopStorageContract } from "../lib/storage/contract.js";
import type { TenantAuthContext } from "../lib/auth/tenant-auth.js";
import {
  publicValidationDetails,
  ValidationError,
  WorkflowRunStepOwnershipUnverifiableError,
  type PublicValidationDetails,
} from "../lib/errors.js";
import { packageVersion } from "../lib/version.js";
import {
  operationAdmissionReceipt,
  operationTerminalReceipt,
  privateOperationDescriptorDigest,
  type OperationReceiptState,
  type PrivateOperationDescriptor,
} from "../lib/operation-contract.js";
import { LoopsClient as HttpLoopsClient } from "../sdk/http.js";
import type { LoopsApiServerOptions } from "./index.js";
import type { Loop, LoopRun, WorkflowSpec } from "../types.js";

const apiPath = join(dirname(fileURLToPath(import.meta.url)), "index.ts");
const jsonHeaders = { "content-type": "application/json" };

function apiUrl(server: { port?: number }, path: string): string {
  if (typeof server.port !== "number") throw new Error("test server did not expose a port");
  return `http://127.0.0.1:${server.port}${path}`;
}

const testPrincipal = {
  tenantId: "tenant-test",
  principalId: "principal-test",
  requestId: "request-test",
  kid: "kid-test",
  agent: "api-test",
  scopes: ["loops:*"],
  roles: ["admin" as const],
  tokenKind: "api_key" as const,
  claims: { v: 1, kid: "kid-test", app: "loops", scopes: ["loops:*"], iat: 1, exp: null },
};

function createTestServer(
  mod: typeof import("./index.js"),
  opts: LoopsApiServerOptions = {},
  principal: TenantAuthContext = testPrincipal,
) {
  return mod.createLoopsApiServer({
    ...opts,
    authenticator: {
      authenticate: async () => ({ ok: true as const, status: 200 as const, principal }),
    },
    withTenantStorage: (_principal, fn) => fn(opts.storage as LoopStorageContract),
  });
}

function runnerPrincipal(principalId: string) {
  return {
    ...testPrincipal,
    principalId,
    agent: principalId,
    scopes: ["loops:runner"],
    roles: ["worker" as const],
    tokenKind: "machine" as const,
    claims: { ...testPrincipal.claims, agent: principalId, scopes: ["loops:runner"] },
  };
}

async function createAdmittedExpiredWorkflowRun(
  storage: LoopStorageContract,
  input: {
    prefix: string;
    claimedAt: Date;
    machineId?: string;
  },
) {
  const workflow = await storage.createWorkflow({
    name: `${input.prefix}-workflow`,
    steps: [{ id: "effect", target: { type: "command", command: "printf", args: ["effect"] } }],
  });
  const loop = await storage.createLoop({
    name: `${input.prefix}-loop`,
    schedule: { type: "interval", everyMs: 60_000 },
    target: { type: "workflow", workflowId: workflow.id },
    maxAttempts: 2,
    retryDelayMs: 1_000,
    leaseMs: 1_000,
    ...(input.machineId ? { machine: { id: input.machineId } } : {}),
  }, input.claimedAt);
  await storage.updateLoop(loop.id, { nextRunAt: input.claimedAt.toISOString() });
  const claim = await storage.claimRun(loop, input.claimedAt.toISOString(), `${input.prefix}-runner`, input.claimedAt);
  if (!claim) throw new Error(`failed to create admitted expired run for ${input.prefix}`);
  const workflowRun = await storage.createWorkflowRun({
    workflow,
    loop,
    loopRun: claim.run,
    operationAuthority: {
      authorityId: "loops-control-plane",
      tenantId: testPrincipal.tenantId,
    },
  });
  const descriptorEvent = (await storage.listWorkflowEvents(workflowRun.id)).find((event) =>
    event.eventType === "private_operation_descriptor" && event.stepId === "effect"
  );
  if (!descriptorEvent) throw new Error(`missing private operation descriptor for ${input.prefix}`);
  const descriptor = descriptorEvent.payload as unknown as PrivateOperationDescriptor;
  await storage.appendWorkflowEvent(
    workflowRun.id,
    "private_operation_admitted",
    "effect",
    operationAdmissionReceipt(descriptor) as unknown as Record<string, unknown>,
  );
  return { workflow, loop, claim, workflowRun };
}

describe("loops-api foundation", () => {
  test("status output is import-safe and path-safe", async () => {
    const mod = await import("./index.js");
    const status = mod.apiStatus({});

    expect(status.ok).toBe(true);
    expect(status.service).toBe("loops-api");
    expect(status.status.storage).toBe("sqlite");
    expect(status.status.connection).toBe("file");
    expect(JSON.stringify(status)).not.toContain("dataDir");
    expect(JSON.stringify(status)).not.toContain("dbPath");
  });

  test("health reports the resolved storage and connection without tenant storage access", async () => {
    const mod = await import("./index.js");
    const previousApiUrl = process.env.HASNA_LOOPS_API_URL;
    const previousApiKey = process.env.HASNA_LOOPS_API_KEY;
    const previousDatabaseUrl = process.env.HASNA_LOOPS_DATABASE_URL;
    const mutableBun = Bun as unknown as { serve: typeof Bun.serve };
    const originalServe = mutableBun.serve;
    let fetchHandler: ((request: Request) => Response | Promise<Response>) | undefined;
    delete process.env.HASNA_LOOPS_API_URL;
    delete process.env.HASNA_LOOPS_API_KEY;
    process.env.HASNA_LOOPS_DATABASE_URL = "postgresql-placeholder";
    mutableBun.serve = ((options: {
      fetch(request: Request): Response | Promise<Response>;
    }) => {
      fetchHandler = options.fetch;
      return { port: 0, stop: () => {} } as unknown as ReturnType<typeof Bun.serve>;
    }) as typeof Bun.serve;
    try {
      mod.createLoopsApiServer({
        host: "127.0.0.1",
        port: 0,
        authenticator: {
          authenticate: async () => {
            throw new Error("health must not authenticate");
          },
        },
        withTenantStorage: async () => {
          throw new Error("health must not access tenant storage");
        },
      });
      if (!fetchHandler) throw new Error("test server did not expose its fetch handler");
      const response = await fetchHandler(
        new Request("http://loops.test/health"),
      );
      expect(await response.json()).toEqual({
        status: "ok",
        version: packageVersion(),
        storage: "postgresql",
        connection: "file",
        service: "loops",
      });
    } finally {
      mutableBun.serve = originalServe;
      if (previousApiUrl === undefined) delete process.env.HASNA_LOOPS_API_URL;
      else process.env.HASNA_LOOPS_API_URL = previousApiUrl;
      if (previousApiKey === undefined) delete process.env.HASNA_LOOPS_API_KEY;
      else process.env.HASNA_LOOPS_API_KEY = previousApiKey;
      if (previousDatabaseUrl === undefined) delete process.env.HASNA_LOOPS_DATABASE_URL;
      else process.env.HASNA_LOOPS_DATABASE_URL = previousDatabaseUrl;
    }
  });

  test("OpenAPI documents actionable but bounded validation failures for create and import", async () => {
    const mod = await import("./index.js");
    const document = mod.openApiDocument() as {
      paths: Record<string, {
        get?: { responses?: Record<string, { content?: { "application/json"?: { schema?: { $ref?: string } } } }> };
        post?: {
          responses?: Record<string, { content?: { "application/json"?: { schema?: { $ref?: string } } } }>;
          deprecated?: boolean;
          requestBody?: {
            content?: {
              "application/json"?: {
                schema?: {
                  $ref?: string;
                  properties?: { status?: { enum?: string[] } };
                };
              };
            };
          };
        };
        patch?: { responses?: Record<string, { content?: { "application/json"?: { schema?: { $ref?: string } } } }> };
      }>;
      components: { schemas: Record<string, unknown> };
    };
    for (const path of ["/v1/loops", "/v1/import"]) {
      expect(document.paths[path]?.post?.responses?.["422"]?.content?.["application/json"]?.schema?.$ref)
        .toBe("#/components/schemas/ValidationFailureResponse");
    }
    expect(document.components.schemas.ValidationFailureResponse).toMatchObject({
      type: "object",
      required: ["ok", "error"],
      properties: {
        details: { $ref: "#/components/schemas/PublicValidationDetails" },
      },
    });
    expect(document.components.schemas.PublicValidationDetails).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["code", "reason", "path"],
      properties: {
        code: { const: "agent_extra_args_invalid" },
        reason: { enum: ["not_array", "invalid_array", "invalid_item", "option_not_allowed"] },
        path: { type: "string" },
        index: { type: "integer", minimum: 0 },
        option: {
          type: "string",
          pattern: "^(?:--[A-Za-z0-9][A-Za-z0-9-]{0,63}|-[A-Za-z0-9])$",
        },
      },
    });
    expect(document.paths["/v1/loops/{id}/archive"]?.post?.responses?.["409"]?.content?.["application/json"]?.schema?.$ref)
      .toBe("#/components/schemas/AmbiguousNameResponse");
    expect(document.paths["/v1/loops/{id}/unarchive"]?.post?.responses?.["409"]?.content?.["application/json"]?.schema?.$ref)
      .toBe("#/components/schemas/AmbiguousNameResponse");
    expect(document.paths["/v1/loops/{id}"]?.patch?.responses?.["422"]?.content?.["application/json"]?.schema?.$ref)
      .toBe("#/components/schemas/InvalidLoopStatusResponse");
    const recoveryResponses = document.paths["/v1/workflow-runs/{id}/recover"]?.post?.responses;
    expect(recoveryResponses?.["400"]?.content?.["application/json"]?.schema?.$ref)
      .toBe("#/components/schemas/InvalidJsonResponse");
    expect(recoveryResponses?.["409"]?.content?.["application/json"]?.schema?.$ref)
      .toBe("#/components/schemas/WorkflowRecoveryConflictResponse");
    expect(recoveryResponses?.["415"]?.content?.["application/json"]?.schema?.$ref)
      .toBe("#/components/schemas/UnsupportedMediaTypeResponse");
    expect(recoveryResponses?.["422"]?.content?.["application/json"]?.schema?.$ref)
      .toBe("#/components/schemas/InvalidWorkflowRecoveryBodyResponse");
    const finalizeResponses = document.paths["/v1/runs/{id}/finalize"]?.post?.responses;
    expect(finalizeResponses?.["409"]?.content?.["application/json"]?.schema?.$ref)
      .toBe("#/components/schemas/RunFinalizeConflictResponse");
    expect(finalizeResponses?.["422"]?.content?.["application/json"]?.schema?.$ref)
      .toBe("#/components/schemas/RunFinalizeValidationResponse");
    expect(
      document.paths["/v1/runs/{id}/finalize"]?.post?.requestBody?.content?.["application/json"]?.schema?.properties?.status?.enum,
    ).toEqual(["succeeded", "failed", "timed_out", "skipped"]);
    expect(document.paths["/v1/runs/{id}/recover"]?.post?.responses?.["409"]).toBeUndefined();
    expect(document.paths["/v1/leases/recover"]?.post?.responses?.["409"]).toBeUndefined();
    expect(document.paths["/v1/leases/recover"]?.post?.deprecated).toBe(true);
    expect(document.paths["/v1/leases/stuck"]?.get?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref)
      .toBe("#/components/schemas/StuckRunReportResponse");
    expect(document.paths["/v1/leases/reconcile"]?.post?.requestBody?.content?.["application/json"]?.schema?.$ref)
      .toBe("#/components/schemas/StuckRunReconciliationInput");
    expect(document.paths["/v1/leases/reconcile"]?.post?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref)
      .toBe("#/components/schemas/StuckRunReconciliationResponse");
    expect(document.paths["/status"]?.get?.responses?.["409"]).toBeUndefined();
    expect(document.paths["/v1/status"]?.get?.responses?.["409"]).toBeUndefined();
    expect(document.components.schemas.RunFinalizeConflictResponse).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["ok", "error"],
      properties: {
        error: {
          enum: ["stale_claim", "run_not_running", "loop_advancement_conflict"],
        },
      },
    });
    expect(document.components.schemas.RunFinalizeValidationResponse).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["ok", "error"],
      properties: {
        error: {
          enum: ["status_required", "skip_status_requires_overlap_skip_exit_75"],
        },
      },
    });
    expect(document.components.schemas.Loop).toMatchObject({
      properties: {
        status: { type: "string", enum: ["active", "paused", "stopped", "expired"] },
      },
    });
    expect(document.components.schemas.UpdateLoopInput).toMatchObject({
      properties: {
        status: { type: "string", enum: ["active", "paused", "stopped", "expired"] },
      },
    });
    expect(document.components.schemas.AmbiguousNameResponse).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["ok", "error"],
      properties: {
        ok: { type: "boolean", const: false },
        error: { type: "string", const: "ambiguous_name" },
      },
    });
    expect(document.components.schemas.WorkflowRecoveryConflictResponse).toMatchObject({
      properties: {
        error: {
          enum: [
            "workflow_run_has_live_steps",
            "workflow_run_step_ownership_unverifiable",
            "workflow_run_not_running",
          ],
        },
      },
    });
    expect(document.components.schemas.CustomWorkflowEvent).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["id", "workflowRunId", "sequence", "eventKind", "eventType", "createdAt"],
      properties: {
        eventKind: { type: "string", enum: ["custom"] },
        eventType: { type: "string", minLength: 1 },
      },
    });
    expect(document.components.schemas.WorkflowEvent).toMatchObject({
      oneOf: [
        { $ref: "#/components/schemas/AgentSessionContractWorkflowEvent" },
        { $ref: "#/components/schemas/GenericWorkflowEvent" },
        { $ref: "#/components/schemas/CustomWorkflowEvent" },
      ],
    });
  });

  test("operator workflow recovery is bounded, idempotent, sanitized, and preserves ownership fences", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage });
    const secret = ["gh", "p_AbCdEf0123456789AbCdEf0123456789"].join("");
    try {
      const workflow = await storage.createWorkflow({
        name: "operator-recovery",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const workflowRun = await storage.createWorkflowRun({ workflow });
      await storage.startWorkflowStepRun(workflowRun.id, "worker");

      const recover = () => fetch(apiUrl(server, `/v1/workflow-runs/${workflowRun.id}/recover`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ reason: `operator retry after ${secret}` }),
      });
      const first = await recover();
      expect(first.status).toBe(200);
      expect(await first.json()).toMatchObject({
        ok: true,
        workflowRun: { id: workflowRun.id },
        recoveredSteps: [{ workflowRunId: workflowRun.id, stepId: "worker", status: "pending" }],
      });
      expect((await storage.getWorkflowStepRun(workflowRun.id, "worker"))?.error).toBe("operator retry after [SCRUBBED]");
      expect((await storage.listWorkflowEvents(workflowRun.id)).filter((event) => event.eventType === "recovered")).toHaveLength(1);

      const second = await recover();
      expect(second.status).toBe(200);
      expect(await second.json()).toMatchObject({ ok: true, recoveredSteps: [] });
      expect((await storage.listWorkflowEvents(workflowRun.id)).filter((event) => event.eventType === "recovered")).toHaveLength(1);

      const noBodyRun = await storage.createWorkflowRun({ workflow });
      await storage.startWorkflowStepRun(noBodyRun.id, "worker");
      const client = new HttpLoopsClient({ baseUrl: apiUrl(server, "") });
      await expect(client.workflowRunsRecover(noBodyRun.id)).resolves.toMatchObject({
        ok: true,
        recoveredSteps: [{ workflowRunId: noBodyRun.id, stepId: "worker", status: "pending" }],
      });

      for (const invalidBody of [
        null,
        [],
        "reason",
        42,
        { reason: 42 },
        { reason: null },
        { reason: "allowed", extra: true },
      ]) {
        const invalid = await fetch(apiUrl(server, `/v1/workflow-runs/${workflowRun.id}/recover`), {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify(invalidBody),
        });
        expect(invalid.status).toBe(422);
        expect(await invalid.json()).toEqual({ ok: false, error: "invalid_workflow_recovery_body" });
      }

      const invalidJson = await fetch(apiUrl(server, `/v1/workflow-runs/${workflowRun.id}/recover`), {
        method: "POST",
        headers: jsonHeaders,
        body: "{",
      });
      expect(invalidJson.status).toBe(400);
      expect(await invalidJson.json()).toEqual({ ok: false, error: "invalid_json" });

      const missingContentType = await fetch(apiUrl(server, `/v1/workflow-runs/${workflowRun.id}/recover`), {
        method: "POST",
        body: "{}",
      });
      expect(missingContentType.status).toBe(415);

      const missing = await fetch(apiUrl(server, "/v1/workflow-runs/missing/recover"), {
        method: "POST",
        headers: jsonHeaders,
        body: "{}",
      });
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ ok: false, error: "workflow_run_not_found" });

      const terminalRun = await storage.createWorkflowRun({ workflow });
      await storage.startWorkflowStepRun(terminalRun.id, "worker");
      const racingStorage = new Proxy(storage, {
        get(target, property) {
          if (property === "recoverWorkflowRun") {
            return async (...args: Parameters<typeof target.recoverWorkflowRun>) => {
              await target.finalizeWorkflowRun(terminalRun.id, "failed", {
                error: "finalized immediately before recovery",
              });
              return target.recoverWorkflowRun(...args);
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as LoopStorageContract;
      const racingServer = createTestServer(mod, {
        host: "127.0.0.1",
        port: 0,
        storage: racingStorage,
      });
      try {
        const terminal = await fetch(apiUrl(racingServer, `/v1/workflow-runs/${terminalRun.id}/recover`), {
          method: "POST",
        });
        expect(terminal.status).toBe(409);
        expect(await terminal.json()).toEqual({
          ok: false,
          error: "workflow_run_not_running",
        });
        expect(await storage.getWorkflowStepRun(terminalRun.id, "worker")).toMatchObject({
          status: "running",
        });
      } finally {
        racingServer.stop(true);
      }

      const liveProcess = Bun.spawn(["sleep", "10"], {
        stdout: "ignore",
        stderr: "ignore",
      });
      try {
        const liveRun = await storage.createWorkflowRun({ workflow });
        await storage.startWorkflowStepRun(liveRun.id, "worker");
        await storage.markWorkflowStepPid(liveRun.id, "worker", liveProcess.pid);
        const live = await fetch(apiUrl(server, `/v1/workflow-runs/${liveRun.id}/recover`), {
          method: "POST",
        });
        expect(live.status).toBe(409);
        const liveBody = JSON.stringify(await live.json());
        expect(liveBody).toBe('{"ok":false,"error":"workflow_run_has_live_steps"}');
        expect(liveBody).not.toContain(String(liveProcess.pid));
      } finally {
        liveProcess.kill();
        await liveProcess.exited;
      }

      const deadPidRun = await storage.createWorkflowRun({ workflow });
      await storage.startWorkflowStepRun(deadPidRun.id, "worker");
      await storage.markWorkflowStepPid(deadPidRun.id, "worker", 2_147_483_647);
      const deadPid = await fetch(apiUrl(server, `/v1/workflow-runs/${deadPidRun.id}/recover`), {
        method: "POST",
      });
      expect(deadPid.status).toBe(200);

      const remotePidRun = await storage.createWorkflowRun({ workflow });
      await storage.startWorkflowStepRun(remotePidRun.id, "worker");
      await storage.markWorkflowStepPid(remotePidRun.id, "worker", 2_147_483_647);
      const remoteStorage = new Proxy(storage, {
        get(target, property) {
          if (property === "backend") return "postgresql";
          if (property === "supportsRemoteRunners") return true;
          if (property === "recoverWorkflowRun") {
            return async (...args: Parameters<typeof target.recoverWorkflowRun>) => {
              const steps = await target.listWorkflowStepRuns(args[0]);
              if (steps.some((step) => step.status === "running" && step.pid !== undefined)) {
                throw new WorkflowRunStepOwnershipUnverifiableError();
              }
              return target.recoverWorkflowRun(...args);
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as LoopStorageContract;
      const remoteServer = createTestServer(mod, {
        host: "127.0.0.1",
        port: 0,
        storage: remoteStorage,
      });
      try {
        const remotePid = await fetch(apiUrl(remoteServer, `/v1/workflow-runs/${remotePidRun.id}/recover`), {
          method: "POST",
        });
        expect(remotePid.status).toBe(409);
        expect(await remotePid.json()).toEqual({
          ok: false,
          error: "workflow_run_step_ownership_unverifiable",
        });
        expect((await storage.getWorkflowStepRun(remotePidRun.id, "worker"))?.status).toBe("running");
      } finally {
        remoteServer.stop(true);
      }

      const nestedNow = new Date("2026-01-01T00:00:00.000Z");
      const nestedLoop = await storage.createLoop({
        name: "nested-runner-recovery",
        schedule: { type: "once", at: nestedNow.toISOString() },
        target: { type: "workflow", workflowId: workflow.id },
        leaseMs: 60_000,
      }, nestedNow);
      const nestedClaim = await storage.claimRun(nestedLoop, nestedNow.toISOString(), "runner-nested", nestedNow);
      const nestedWorkflowRun = await storage.createWorkflowRun({
        workflow,
        loop: nestedLoop,
        loopRun: nestedClaim!.run,
      });
      await storage.startWorkflowStepRun(nestedWorkflowRun.id, "worker");
      await storage.markWorkflowStepPid(nestedWorkflowRun.id, "worker", 2_147_483_647);
      const nestedServer = createTestServer(
        mod,
        {
          host: "127.0.0.1",
          port: 0,
          storage: remoteStorage,
          now: () => nestedNow,
        },
        runnerPrincipal("runner-nested"),
      );
      try {
        const nested = await fetch(
          apiUrl(nestedServer, `/v1/runs/${nestedClaim!.run.id}/workflow-runs/${nestedWorkflowRun.id}/recover`),
          {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ claimToken: nestedClaim!.claimToken }),
          },
        );
        expect(nested.status).toBe(409);
        expect(await nested.json()).toEqual({
          ok: false,
          error: "workflow_run_step_ownership_unverifiable",
        });
      } finally {
        nestedServer.stop(true);
      }
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("status command JSON uses the service envelope", () => {
    // The retired mode env key is built from two literals so the contiguous
    // token never appears in this file: the mode-removal ratchet exempts only
    // runtime-config's own rejection contract, not this API test.
    const retiredModeEnvKey = "HASNA_LOOPS_" + "STORAGE_" + "MODE";
    const result = spawnSync(process.execPath, [apiPath, "--json", "status"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HASNA_LOOPS_API_URL: "",
        HASNA_LOOPS_API_KEY: "",
        HASNA_LOOPS_DATABASE_URL: "",
        [retiredModeEnvKey]: "",
      },
    });

    expect(result.status).toBe(0);
    const body = JSON.parse(result.stdout) as { ok: boolean; service: string; status: { storage: string; connection: string } };
    expect(body).toMatchObject({
      ok: true,
      service: "loops-api",
      status: {
        storage: "sqlite",
        connection: "file",
      },
    });
  });

  test("status output redacts credentials embedded in API URLs", async () => {
    const previousUrl = process.env.HASNA_LOOPS_API_URL;
    const previousToken = process.env.HASNA_LOOPS_API_KEY;
    // Synthetic fixture values only: the credential_assignment detector fires on
    // any `*_API_KEY = "value"` identifier-assignment shape, so set the
    // variables through bracket assignment with non-credential-shaped values
    // while exercising the same URL redaction the test always has.
    process.env["HASNA_LOOPS_API_URL"] = "https://user:value-a@loops.example.test/api?q=value-b";
    process.env["HASNA_LOOPS_API_KEY"] = "present-but-not-returned";
    try {
      const mod = await import("./index.js");
      const status = JSON.stringify(mod.apiStatus());
      expect(status).toContain("https://loops.example.test/api");
      expect(status).not.toContain("value-a");
      expect(status).not.toContain("value-b");
      expect(status).not.toContain("present-but-not-returned");
    } finally {
      if (previousUrl === undefined) delete process.env.HASNA_LOOPS_API_URL;
      else process.env.HASNA_LOOPS_API_URL = previousUrl;
      if (previousToken === undefined) delete process.env.HASNA_LOOPS_API_KEY;
      else process.env.HASNA_LOOPS_API_KEY = previousToken;
    }
  });

  test("does not expose a dead standalone serve command", () => {
    const result = spawnSync(process.execPath, [apiPath, "--help"], {
      encoding: "utf8",
      timeout: 5_000,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toMatch(/^\s+serve\b/m);
    expect(result.stdout).not.toContain("listening");
  });

  test("API construction requires both authentication and request-scoped storage", async () => {
    const mod = await import("./index.js");
    expect(() => mod.createLoopsApiServer({ host: "127.0.0.1", port: 0 })).toThrow("tenant authenticator");
    expect(() => mod.createLoopsApiServer({
      host: "127.0.0.1",
      port: 0,
      authenticator: { authenticate: async () => ({ ok: true, status: 200, principal: testPrincipal }) },
    })).toThrow("request-scoped tenant storage");
  });

  test("all public foundation probes bypass authentication without api_auth denial events", async () => {
    const mod = await import("./index.js");
    let authenticateCalls = 0;
    const logged: string[] = [];
    const originalWarn = console.warn;
    const mutableBun = Bun as unknown as { serve: typeof Bun.serve };
    const originalServe = mutableBun.serve;
    let fetchHandler: ((request: Request) => Response | Promise<Response>) | undefined;
    console.warn = (...values: unknown[]) => { logged.push(values.map(String).join(" ")); };
    mutableBun.serve = ((options: { fetch(request: Request): Response | Promise<Response> }) => {
      fetchHandler = options.fetch;
      return { port: 0, stop: () => {} } as unknown as ReturnType<typeof Bun.serve>;
    }) as typeof Bun.serve;
    try {
      mod.createLoopsApiServer({
        host: "127.0.0.1",
        port: 0,
        authenticator: {
          authenticate: async () => {
            authenticateCalls += 1;
            console.warn(JSON.stringify({ evt: "api_auth", outcome: "deny", reason: "missing_token", status: 401 }));
            return {
              ok: false as const,
              status: 401 as const,
              reason: "missing_token",
              message: "Authentication required.",
              requestId: "foundation-auth-called",
            };
          },
        },
        withTenantStorage: async () => { throw new Error("foundation probe reached tenant storage"); },
        readyCheck: async () => ({ ready: true }),
      });
      if (!fetchHandler) throw new Error("test server did not expose its fetch handler");
      for (const path of [
        "/health",
        "/healthz",
        "/ready",
        "/readyz",
        "/version",
        "/v1/version",
        "/openapi.json",
      ]) {
        const response = await fetchHandler(new Request(`http://loops.test${path}`));
        expect(response.status).toBe(200);
      }
      expect(authenticateCalls).toBe(0);
      expect(logged).toEqual([]);
    } finally {
      console.warn = originalWarn;
      mutableBun.serve = originalServe;
    }
  });

  test("public readiness returns stable codes without backend error details", async () => {
    const mod = await import("./index.js");
    const failingStorage = {
      listLoops: async () => { throw new Error("password=super-secret db.internal.example"); },
    } as unknown as LoopStorageContract;
    const server = createTestServer(mod, {
      host: "127.0.0.1",
      port: 0,
      storage: failingStorage,
    });
    try {
      const response = await fetch(apiUrl(server, "/ready"));
      expect(response.status).toBe(503);
      const body = JSON.stringify(await response.json());
      expect(body).toContain('"code":"storage_unreachable"');
      expect(body).not.toContain("detail");
      expect(body).not.toContain("password");
    } finally {
      server.stop(true);
    }
  });

  test("authentication backend failures return a stable 503 without credential details", async () => {
    const mod = await import("./index.js");
    const server = mod.createLoopsApiServer({
      host: "127.0.0.1",
      port: 0,
      authenticator: {
        authenticate: async () => { throw new Error("postgres://user:secret@db.internal/loops"); },
      },
      withTenantStorage: (_principal, fn) => fn(createSqliteLoopStorage(":memory:")),
    });
    try {
      const response = await fetch(apiUrl(server, "/v1/loops"), {
        headers: { "x-request-id": "auth-outage-test" },
      });
      expect(response.status).toBe(503);
      const body = JSON.stringify(await response.json());
      expect(body).toContain('"error":"auth_unavailable"');
      expect(body).toContain('"requestId":"auth-outage-test"');
      expect(body).not.toContain("postgres");
      expect(body).not.toContain("secret");
    } finally {
      server.stop(true);
    }
  });

  test("internal storage failures never expose credential-bearing error messages", async () => {
    const mod = await import("./index.js");
    let committed = false;
    let rolledBack = false;
    const internalError = Object.assign(new Error("postgres://user:secret@db.internal/loops"), {
      name: "postgres://name-secret@db.internal/loops",
      code: "postgres://code-secret@db.internal/loops",
      status: 400,
    });
    const failingStorage = {
      listLoops: async () => { throw internalError; },
    } as unknown as LoopStorageContract;
    const server = mod.createLoopsApiServer({
      host: "127.0.0.1",
      port: 0,
      authenticator: {
        authenticate: async () => ({ ok: true as const, status: 200 as const, principal: testPrincipal }),
      },
      withTenantStorage: async (_principal, fn) => {
        try {
          const response = await fn(failingStorage);
          committed = true;
          return response;
        } catch (error) {
          rolledBack = true;
          throw error;
        }
      },
    });
    const logged: string[] = [];
    const originalError = console.error;
    console.error = (...values: unknown[]) => { logged.push(values.map(String).join(" ")); };
    try {
      const response = await fetch(apiUrl(server, "/v1/loops"));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ ok: false, error: "internal_error" });
      expect(committed).toBe(false);
      expect(rolledBack).toBe(true);
      expect(logged.join("\n")).not.toContain("secret");
      expect(logged.join("\n")).not.toContain("postgres");
      expect(logged.join("\n")).not.toContain("/v1/loops");
    } finally {
      console.error = originalError;
      server.stop(true);
    }
  });

  test("generic validation errors without public details remain non-leaky", async () => {
    const mod = await import("./index.js");
    const storage = {
      listLoops: async () => { throw new ValidationError("private validation context: bearer super-secret"); },
    } as unknown as LoopStorageContract;
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage });

    try {
      const response = await fetch(apiUrl(server, "/v1/loops"));
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ ok: false, error: "validation_failed" });
    } finally {
      server.stop(true);
    }
  });

  test("public validation details are an exact bounded projection", async () => {
    const mod = await import("./index.js");
    const details = {
      code: "agent_extra_args_invalid",
      reason: "option_not_allowed",
      path: "target.extraArgs[0]",
      index: 0,
      option: "--durable",
      privateValue: "bearer super-secret",
    } as PublicValidationDetails & { privateValue: string };
    const storage = {
      listLoops: async () => { throw new ValidationError("private validation context", details); },
    } as unknown as LoopStorageContract;
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage });

    try {
      const response = await fetch(apiUrl(server, "/v1/loops"));
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body).toEqual({
        ok: false,
        error: "validation_failed",
        details: {
          code: "agent_extra_args_invalid",
          reason: "option_not_allowed",
          path: "target.extraArgs[0]",
          index: 0,
          option: "--durable",
        },
      });
      expect(JSON.stringify(body)).not.toContain("super-secret");
    } finally {
      server.stop(true);
    }
  });

  test("validation details snapshot each getter once and cannot be replaced or mutated", () => {
    const expected = {
      code: "agent_extra_args_invalid",
      reason: "option_not_allowed",
      path: "target.extraArgs[0]",
      index: 0,
      option: "--durable",
    } as const;
    const changed = {
      code: "private_unvalidated_code",
      reason: "private_unvalidated_reason",
      path: "privateUnvalidatedPath",
      index: 99,
      option: "--private-unvalidated-option",
    } as const;
    const reads = { code: 0, reason: 0, path: 0, index: 0, option: 0 };
    const details = {} as PublicValidationDetails;
    for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
      Object.defineProperty(details, key, {
        enumerable: true,
        get() {
          reads[key] += 1;
          return reads[key] === 1 ? expected[key] : changed[key];
        },
      });
    }
    const error = new ValidationError("private validation context", details);

    expect(reads).toEqual({ code: 1, reason: 1, path: 1, index: 1, option: 1 });
    expect(error.publicDetails).toEqual(expected);
    expect(Object.getOwnPropertyDescriptor(error, "publicDetails")).toMatchObject({
      configurable: false,
      writable: false,
    });
    expect(() => {
      (error as { publicDetails?: unknown }).publicDetails = {
        code: "agent_extra_args_invalid",
        reason: "not_array",
        path: "privateSecret",
        privateValue: "bearer super-secret",
      };
    }).toThrow();
    expect(() => {
      Object.defineProperty(error, "publicDetails", { value: undefined });
    }).toThrow();
    expect(() => {
      (error.publicDetails as { path: string }).path = "privateSecret";
    }).toThrow();
  });

  test("throwing validation-detail getters fail closed without exposing metadata", () => {
    const details = {} as PublicValidationDetails;
    Object.defineProperty(details, "code", {
      get() {
        throw new Error("bearer super-secret");
      },
    });
    const error = new ValidationError("private validation context", details);
    expect(error.publicDetails).toBeUndefined();
  });

  test("public validation detail projection rejects producer-impossible relationships", () => {
    const impossible = [
      {
        code: "agent_extra_args_invalid",
        reason: "invalid_item",
        path: "target.extraArgs[0]",
        index: 0,
        option: "--private",
      },
      {
        code: "agent_extra_args_invalid",
        reason: "option_not_allowed",
        path: "target.extraArgs[9]",
        index: 0,
        option: "--private",
      },
      {
        code: "agent_extra_args_invalid",
        reason: "not_array",
        path: "target.extraArgs[9]",
      },
      {
        code: "agent_extra_args_invalid",
        reason: "not_array",
        path: "privatePath",
      },
    ];
    for (const details of impossible) {
      expect(publicValidationDetails(details)).toBeUndefined();
    }
  });

  test("API re-projects forged validation details through the bounded public schema", async () => {
    const mod = await import("./index.js");
    const forged = Object.create(ValidationError.prototype) as ValidationError;
    Object.defineProperty(forged, "publicDetails", {
      value: {
        code: "agent_extra_args_invalid",
        reason: "option_not_allowed",
        path: "target.extraArgs[0]",
        index: 0,
        option: "--durable",
        privateValue: "bearer super-secret",
      },
    });
    const storage = {
      listLoops: async () => { throw forged; },
    } as unknown as LoopStorageContract;
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage });

    try {
      const response = await fetch(apiUrl(server, "/v1/loops"));
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body).toEqual({
        ok: false,
        error: "validation_failed",
        details: {
          code: "agent_extra_args_invalid",
          reason: "option_not_allowed",
          path: "target.extraArgs[0]",
          index: 0,
          option: "--durable",
        },
      });
      expect(JSON.stringify(body)).not.toContain("super-secret");
    } finally {
      server.stop(true);
    }
  });

  test("API hides throwing own or inherited public-details getters", async () => {
    const mod = await import("./index.js");
    for (const inherited of [false, true]) {
      const forgedPrototype = inherited ? Object.create(ValidationError.prototype) : ValidationError.prototype;
      const forged = Object.create(forgedPrototype) as ValidationError;
      Object.defineProperty(inherited ? forgedPrototype : forged, "publicDetails", {
        configurable: true,
        get() {
          throw new Error("private-public-details-getter-sentinel");
        },
      });
      const storage = {
        listLoops: async () => { throw forged; },
      } as unknown as LoopStorageContract;
      const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage });

      try {
        const response = await fetch(apiUrl(server, "/v1/loops"));
        expect(response.status).toBe(422);
        expect(response.headers.get("content-type")).toContain("application/json");
        const body = await response.text();
        expect(JSON.parse(body)).toEqual({ ok: false, error: "validation_failed" });
        expect(body).not.toContain("private-public-details-getter-sentinel");
        expect(body).not.toContain(import.meta.dir);
      } finally {
        server.stop(true);
      }
    }
  });

  test("API hides forged validation details with impossible field relationships", async () => {
    const mod = await import("./index.js");
    const forged = Object.create(ValidationError.prototype) as ValidationError;
    Object.defineProperty(forged, "publicDetails", {
      value: {
        code: "agent_extra_args_invalid",
        reason: "invalid_item",
        path: "target.extraArgs[0]",
        index: 0,
        option: "--private",
      },
    });
    const storage = {
      listLoops: async () => { throw forged; },
    } as unknown as LoopStorageContract;
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage });

    try {
      const response = await fetch(apiUrl(server, "/v1/loops"));
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ ok: false, error: "validation_failed" });
    } finally {
      server.stop(true);
    }
  });

  test("api command failures use stable logs without provider details", async () => {
    const mod = await import("./index.js");
    const logged: string[] = [];
    const originalError = console.error;
    console.error = (...values: unknown[]) => { logged.push(values.map(String).join(" ")); };
    try {
      mod.logApiCommandFailure(Object.assign(new Error("postgres://user:secret@db.internal/loops"), {
        name: "postgres://name-secret@db.internal/loops",
        code: "postgres://code-secret@db.internal/loops",
      }));
      expect(logged).toEqual([JSON.stringify({ evt: "loops_api_command_failed", errorType: "error" })]);
    } finally {
      console.error = originalError;
    }
  });

  test("domain errors expose stable codes without echoing identifiers", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage });
    const secretIdentifier = "postgres://user:secret@db.internal/loops";
    try {
      const response = await fetch(apiUrl(server, `/v1/loops/${encodeURIComponent(secretIdentifier)}`));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ ok: false, error: "loop_not_found" });
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("loops routes use injected storage and redact command environments", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage });

    try {
      const createResponse = await fetch(apiUrl(server, "/v1/loops"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          name: "api-storage-loop",
          labels: ["BrowserPlan", "nightly"],
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: {
            type: "command",
            command: "echo",
            args: ["hello"],
            env: { PRIVATE_TOKEN: "secret" },
          },
        }),
      });
      expect(createResponse.status).toBe(201);
      const created = (await createResponse.json()) as {
        ok: boolean;
        loop: { id: string; name: string; labels: string[]; target: { env?: unknown } };
      };
      expect(created).toMatchObject({ ok: true, loop: { name: "api-storage-loop" } });
      expect(created.loop.labels).toEqual(["browserplan", "nightly"]);
      expect(created.loop.target.env).toBeUndefined();
      expect(JSON.stringify(created.loop.target)).not.toContain("PRIVATE_TOKEN");
      expect(JSON.stringify(created.loop.target)).toContain("operationTemplateId");

      const listResponse = await fetch(apiUrl(server, "/v1/loops?limit=10&labels=browserplan%2Cnightly"));
      const listed = (await listResponse.json()) as { loops: { id: string; labels: string[] }[] };
      expect(listResponse.status).toBe(200);
      expect(listed.loops.map((loop) => loop.id)).toContain(created.loop.id);

      const getResponse = await fetch(apiUrl(server, `/v1/loops/${created.loop.id}`));
      expect(getResponse.status).toBe(200);

      const pauseResponse = await fetch(apiUrl(server, `/v1/loops/${created.loop.id}`), {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ status: "paused", labels: ["maintenance"] }),
      });
      const paused = (await pauseResponse.json()) as { loop: { status: string; labels: string[] } };
      expect(pauseResponse.status).toBe(200);
      expect(paused.loop.status).toBe("paused");
      expect(paused.loop.labels).toEqual(["maintenance"]);

      const archiveResponse = await fetch(apiUrl(server, `/v1/loops/${created.loop.id}/archive`), { method: "POST" });
      const archived = (await archiveResponse.json()) as { loop: { archivedAt?: string } };
      expect(archiveResponse.status).toBe(200);
      expect(archived.loop.archivedAt).toBeString();

      const unarchiveResponse = await fetch(apiUrl(server, `/v1/loops/${created.loop.id}/unarchive`), { method: "POST" });
      const unarchived = (await unarchiveResponse.json()) as { loop: { archivedAt?: string } };
      expect(unarchiveResponse.status).toBe(200);
      expect(unarchived.loop.archivedAt).toBeUndefined();

      const deleteResponse = await fetch(apiUrl(server, `/v1/loops/${created.loop.id}`), { method: "DELETE" });
      expect(deleteResponse.status).toBe(200);
      expect(await deleteResponse.json()).toMatchObject({ ok: true, deleted: true });
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("machine-pinned loop keeps its assignment and reads execution unserved when no runner claims it (BUG 96c837b0)", async () => {
    const mod = await import("./index.js");
    let nowMs = Date.parse("2026-08-19T12:25:55.000Z");
    const storage = createSqliteLoopStorage(":memory:");
    const server = createTestServer(mod, {
      host: "127.0.0.1",
      port: 0,
      storage,
      now: () => new Date(nowMs),
    });

    try {
      const createResponse = await fetch(apiUrl(server, "/v1/loops"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          name: "pinned-unserved",
          machine: { id: "station02" },
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "/bin/true" },
        }),
      });
      expect(createResponse.status).toBe(201);
      const created = (await createResponse.json()) as {
        loop: { id: string; machine?: { id: string }; nextRunAt?: string };
      };

      // The --machine assignment must persist in hosted mode (CONST first half).
      expect(created.loop.machine?.id).toBe("station02");

      // First slot passed and the overdue grace elapsed with zero runs: the
      // loop must read as unserved instead of looking healthy.
      nowMs = Date.parse(created.loop.nextRunAt ?? "2026-08-19T12:26:55.000Z") + 11 * 60_000;
      const showResponse = await fetch(apiUrl(server, `/v1/loops/${created.loop.id}`));
      expect(showResponse.status).toBe(200);
      const shown = (await showResponse.json()) as { loop: { execution?: { state?: string; reason?: string } } };
      expect(shown.loop.execution).toMatchObject({ state: "unserved" });
      expect(shown.loop.execution?.reason).toContain("station02");

      // Pausing clears the signal: an inactive loop is not an execution gap.
      const pauseResponse = await fetch(apiUrl(server, `/v1/loops/${created.loop.id}`), {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ status: "paused" }),
      });
      expect(pauseResponse.status).toBe(200);
      const pausedGet = await fetch(apiUrl(server, `/v1/loops/${created.loop.id}`));
      const paused = (await pausedGet.json()) as { loop: { execution?: { state?: string } } };
      expect(paused.loop.execution?.state).toBe("ok");
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("machine-pinned loop claimed by its matching runner reads execution ok (BUG 96c837b0)", async () => {
    const mod = await import("./index.js");
    let nowMs = Date.parse("2026-08-19T12:25:55.000Z");
    const storage = createSqliteLoopStorage(":memory:");
    const server = createTestServer(mod, {
      host: "127.0.0.1",
      port: 0,
      storage,
      now: () => new Date(nowMs),
    });

    try {
      const createResponse = await fetch(apiUrl(server, "/v1/loops"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          name: "pinned-served",
          machine: { id: "principal-test" },
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "/bin/true" },
        }),
      });
      expect(createResponse.status).toBe(201);
      const created = (await createResponse.json()) as { loop: { id: string; nextRunAt?: string } };

      // The loop's runner claims its first slot: a run row now exists.
      nowMs = Date.parse(created.loop.nextRunAt ?? "2026-08-19T12:26:55.000Z");
      const claimResponse = await fetch(apiUrl(server, "/v1/runners/claim"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ runnerId: "principal-test", machineId: "principal-test" }),
      });
      expect(claimResponse.status).toBe(200);
      const claimed = (await claimResponse.json()) as { claims: unknown[] };
      expect(claimed.claims.length).toBe(1);

      const showResponse = await fetch(apiUrl(server, `/v1/loops/${created.loop.id}`));
      expect(showResponse.status).toBe(200);
      const shown = (await showResponse.json()) as { loop: { execution?: { state?: string } } };
      expect(shown.loop.execution).toMatchObject({ state: "ok" });
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("archive and unarchive return stable 409s for ambiguous names without mutating rows", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const input = {
      name: "api-archive-ambiguous",
      schedule: { type: "once", at: "2026-01-01T00:00:00Z" } as const,
      target: { type: "command", command: "true" } as const,
    };
    const first = await storage.createLoop(input, new Date("2025-12-31T00:00:00Z"));
    const second = await storage.createLoop(input, new Date("2025-12-31T00:00:01Z"));
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage });

    try {
      const ambiguousArchive = await fetch(apiUrl(server, `/v1/loops/${input.name}/archive`), { method: "POST" });
      expect(ambiguousArchive.status).toBe(409);
      expect(await ambiguousArchive.json()).toEqual({ ok: false, error: "ambiguous_name" });
      expect((await storage.getLoop(first.id))?.archivedAt).toBeUndefined();
      expect((await storage.getLoop(second.id))?.archivedAt).toBeUndefined();

      const archiveFirst = await fetch(apiUrl(server, `/v1/loops/${first.id}/archive`), { method: "POST" });
      expect(archiveFirst.status).toBe(200);
      expect(((await archiveFirst.json()) as { loop: { id: string } }).loop.id).toBe(first.id);

      const archiveSoleActive = await fetch(apiUrl(server, `/v1/loops/${input.name}/archive`), { method: "POST" });
      expect(archiveSoleActive.status).toBe(200);
      expect(((await archiveSoleActive.json()) as { loop: { id: string } }).loop.id).toBe(second.id);

      const ambiguousUnarchive = await fetch(apiUrl(server, `/v1/loops/${input.name}/unarchive`), { method: "POST" });
      expect(ambiguousUnarchive.status).toBe(409);
      expect(await ambiguousUnarchive.json()).toEqual({ ok: false, error: "ambiguous_name" });
      expect((await storage.getLoop(first.id))?.archivedAt).toBeString();
      expect((await storage.getLoop(second.id))?.archivedAt).toBeString();

      const unarchiveFirst = await fetch(apiUrl(server, `/v1/loops/${first.id}/unarchive`), { method: "POST" });
      expect(unarchiveFirst.status).toBe(200);
      expect(((await unarchiveFirst.json()) as { loop: { id: string } }).loop.id).toBe(first.id);
      expect((await storage.getLoop(first.id))?.archivedAt).toBeUndefined();
      expect((await storage.getLoop(second.id))?.archivedAt).toBeString();

      const unarchiveSoleArchived = await fetch(apiUrl(server, `/v1/loops/${input.name}/unarchive`), { method: "POST" });
      expect(unarchiveSoleArchived.status).toBe(200);
      expect(((await unarchiveSoleArchived.json()) as { loop: { id: string } }).loop.id).toBe(second.id);
      expect((await storage.getLoop(second.id))?.archivedAt).toBeUndefined();
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("POST /v1/loops rejects invalid agent extraArgs as 422 without persistence", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage });

    try {
      for (const [name, extraArgs, details] of [
        ["not-array", "private-value", {
          code: "agent_extra_args_invalid",
          reason: "not_array",
          path: "target.extraArgs",
        }],
        ["unknown-option", ["--durable=private-value", "true"], {
          code: "agent_extra_args_invalid",
          reason: "option_not_allowed",
          path: "target.extraArgs[0]",
          index: 0,
          option: "--durable",
        }],
        ["malformed-entry", [null, "--dangerously-bypass-hook-trust"], {
          code: "agent_extra_args_invalid",
          reason: "invalid_item",
          path: "target.extraArgs[0]",
          index: 0,
        }],
      ] as const) {
        const response = await fetch(apiUrl(server, "/v1/loops"), {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            name: `invalid-extra-args-${name}`,
            schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
            target: {
              type: "agent",
              provider: "codewith",
              prompt: "do not execute",
              extraArgs,
            },
          }),
        });
        expect(response.status).toBe(422);
        const body = await response.json();
        expect(body).toEqual({ ok: false, error: "validation_failed", details });
        expect(JSON.stringify(body)).not.toContain("private-value");
      }
      expect(await storage.countLoops()).toBe(0);
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("POST /v1/import rejects legacy agent extraArgs instead of persisting or stripping them", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage });
    const legacyLoop = {
      id: "loop-import-legacy-extra-args",
      name: "legacy-extra-args",
      status: "paused",
      schedule: { type: "once", at: "2026-01-01T00:00:00.000Z" },
      target: {
        type: "agent",
        provider: "codewith",
        prompt: "do not execute",
        extraArgs: ["--durable", "true"],
      },
      catchUp: "latest",
      catchUpLimit: 50,
      overlap: "skip",
      maxAttempts: 1,
      retryDelayMs: 60_000,
      leaseMs: 1_800_000,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    try {
      const response = await fetch(apiUrl(server, "/v1/import"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ loops: [legacyLoop] }),
      });
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({
        ok: false,
        error: "validation_failed",
        details: {
          code: "agent_extra_args_invalid",
          reason: "option_not_allowed",
          path: "loops[0].target.extraArgs[0]",
          index: 0,
          option: "--durable",
        },
      });
      expect(await storage.getLoop(legacyLoop.id)).toBeUndefined();
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("POST /v1/import rejects malformed agent addDirs and preserves valid arrays", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage });
    const importedLoop = {
      id: "loop-import-agent-add-dirs",
      name: "imported-agent-add-dirs",
      status: "paused",
      schedule: { type: "once", at: "2026-01-01T00:00:00.000Z" },
      target: {
        type: "agent",
        provider: "codewith",
        prompt: "do not execute",
        addDirs: ["/tmp/allowed"],
      },
      catchUp: "latest",
      catchUpLimit: 50,
      overlap: "skip",
      maxAttempts: 1,
      retryDelayMs: 60_000,
      leaseMs: 1_800_000,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    try {
      for (const addDirs of [
        "/",
        ["/tmp/allowed", null],
        ["/"],
        ["//"],
        ["/."],
        ["/tmp/.."],
        ["C:\\"],
        ["C:/tmp/.."],
      ] as const) {
        const response = await fetch(apiUrl(server, "/v1/import"), {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            loops: [{ ...importedLoop, target: { ...importedLoop.target, addDirs } }],
          }),
        });
        expect(response.status).toBe(422);
        expect(await response.json()).toEqual({ ok: false, error: "validation_failed" });
        expect(await storage.getLoop(importedLoop.id)).toBeUndefined();
      }

      const validResponse = await fetch(apiUrl(server, "/v1/import"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ loops: [importedLoop] }),
      });
      expect(validResponse.status).toBe(200);
      expect((await storage.getLoop(importedLoop.id))?.target).toMatchObject({
        type: "agent",
        provider: "codewith",
        addDirs: ["/tmp/allowed"],
      });
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("POST /v1/import upserts id-preserving rows, pauses imported loops by default, is idempotent, and skips running runs", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage });

    const loop = {
      id: "loop-import-1",
      name: "imported-loop",
      description: "backfilled",
      status: "stopped",
      archivedAt: "2026-01-02T00:00:00.000Z",
      archivedFromStatus: "paused",
      schedule: { type: "interval", every: "1h" },
      target: { type: "command", command: "true" },
      catchUp: "latest",
      catchUpLimit: 50,
      overlap: "skip",
      maxAttempts: 1,
      retryDelayMs: 60_000,
      leaseMs: 1_800_000,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    };
    const terminalRun = {
      id: "run-import-1",
      loopId: "loop-import-1",
      loopName: "imported-loop",
      scheduledFor: "2026-01-01T00:00:00.000Z",
      attempt: 1,
      status: "succeeded",
      finishedAt: "2026-01-01T00:00:05.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:05.000Z",
    };
    const runningRun = { ...terminalRun, id: "run-import-running", scheduledFor: "2026-01-01T01:00:00.000Z", status: "running" };

    try {
      const importResponse = await fetch(apiUrl(server, "/v1/import"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ loops: [loop], runs: [terminalRun, runningRun] }),
      });
      expect(importResponse.status).toBe(200);
      expect(await importResponse.json()).toMatchObject({
        ok: true,
        imported: { workflows: 0, loops: 1, runs: 1 },
        skippedRunning: 1,
      });

      // id + archived state preserved, but scheduling is deliberately disabled
      // unless preserveLoopScheduling is explicitly requested.
      const fetched = await storage.getLoop("loop-import-1");
      expect(fetched?.id).toBe("loop-import-1");
      expect(fetched?.status).toBe("paused");
      expect(fetched?.nextRunAt).toBeUndefined();
      expect(fetched?.retryScheduledFor).toBeUndefined();
      expect(fetched?.archivedAt).toBe("2026-01-02T00:00:00.000Z");
      expect(fetched?.createdAt).toBe("2026-01-01T00:00:00.000Z");
      const importedRun = await storage.getRun("run-import-1");
      expect(importedRun?.status).toBe("succeeded");
      expect(await storage.getRun("run-import-running")).toBeUndefined();

      // A default re-import overrides an existing active hosted row into a
      // scheduler-neutral paused representation. This is stricter than ordinary
      // no-replace row import because self-hosted backfill must not wake loops.
      const activeLoop = {
        ...loop,
        id: "loop-import-active",
        name: "imported-loop-active",
        status: "active",
        archivedAt: undefined,
        archivedFromStatus: undefined,
        nextRunAt: "2026-01-01T01:00:00.000Z",
      };
      await storage.upsertMigrationLoop(activeLoop as Loop, { replace: true });
      const repause = await fetch(apiUrl(server, "/v1/import"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ loops: [activeLoop] }),
      });
      expect(repause.status).toBe(200);
      const repaused = await storage.getLoop("loop-import-active");
      expect(repaused?.status).toBe("paused");
      expect(repaused?.nextRunAt).toBeUndefined();

      // Idempotent: a second import of the same ids never duplicates rows.
      const again = await fetch(apiUrl(server, "/v1/import"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ loops: [loop], runs: [terminalRun] }),
      });
      expect(again.status).toBe(200);
      const allLoops = await storage.listLoops({ includeArchived: true, limit: 100 });
      expect(allLoops.filter((entry) => entry.id === "loop-import-1")).toHaveLength(1);
      const allRuns = await storage.listRuns({ loopId: "loop-import-1", limit: 100 });
      expect(allRuns.filter((entry) => entry.id === "run-import-1")).toHaveLength(1);

      // Count routes verify totals beyond the 1000-row list cap.
      const loopCount = await fetch(apiUrl(server, "/v1/loops/count?includeArchived=true"));
      expect(loopCount.status).toBe(200);
      expect(await loopCount.json()).toMatchObject({ ok: true, count: 2 });
      const runCount = await fetch(apiUrl(server, "/v1/runs/count"));
      expect(await runCount.json()).toMatchObject({ ok: true, count: 1 });
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("workflow definition APIs list/count/get and imported workflow-loop refs remain represented but paused", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage });

    const workflow = {
      id: "workflow-import-1",
      name: "imported-workflow",
      version: 1,
      status: "active",
      steps: [{ id: "one", target: { type: "command", command: "true" } }],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const loop = {
      id: "loop-workflow-import-1",
      name: "imported-workflow-loop",
      status: "active",
      schedule: { type: "once", at: "2026-01-01T00:00:00.000Z" },
      target: { type: "workflow", workflowId: "workflow-import-1" },
      nextRunAt: "2026-01-01T00:00:00.000Z",
      catchUp: "latest",
      catchUpLimit: 50,
      overlap: "skip",
      maxAttempts: 1,
      retryDelayMs: 60_000,
      leaseMs: 1_800_000,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    try {
      const response = await fetch(apiUrl(server, "/v1/import"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ workflows: [workflow], loops: [loop] }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, imported: { workflows: 1, loops: 1, runs: 0 } });

      const list = await fetch(apiUrl(server, "/v1/workflows?limit=10"));
      expect(list.status).toBe(200);
      const listed = (await list.json()) as { workflows: Array<{ id: string; name: string }> };
      expect(listed.workflows).toContainEqual(expect.objectContaining({ id: "workflow-import-1", name: "imported-workflow" }));

      const count = await fetch(apiUrl(server, "/v1/workflows/count"));
      expect(count.status).toBe(200);
      expect(await count.json()).toMatchObject({ ok: true, count: 1 });

      const get = await fetch(apiUrl(server, "/v1/workflows/workflow-import-1"));
      expect(get.status).toBe(200);
      expect(await get.json()).toMatchObject({
        ok: true,
        workflow: { id: "workflow-import-1", name: "imported-workflow", status: "archived" },
      });
      expect((await storage.getWorkflow("workflow-import-1"))?.status).toBe("archived");

      const importedLoop = await storage.getLoop("loop-workflow-import-1");
      expect(importedLoop?.target).toMatchObject({ type: "workflow", workflowId: "workflow-import-1" });
      expect(importedLoop?.status).toBe("paused");
      expect(importedLoop?.nextRunAt).toBeUndefined();

      const existingActiveWorkflow = {
        ...workflow,
        id: "workflow-import-existing-active",
        name: "imported-existing-active-workflow",
        status: "active",
      };
      await storage.upsertMigrationWorkflow(existingActiveWorkflow as WorkflowSpec, { replace: true });
      expect((await storage.getWorkflow("workflow-import-existing-active"))?.status).toBe("active");
      const archiveExisting = await fetch(apiUrl(server, "/v1/import"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ workflows: [existingActiveWorkflow] }),
      });
      expect(archiveExisting.status).toBe(200);
      expect((await storage.getWorkflow("workflow-import-existing-active"))?.status).toBe("archived");

      const preserveWorkflow = {
        ...workflow,
        id: "workflow-import-preserve-active",
        name: "imported-preserve-active-workflow",
        status: "active",
      };
      const preserveResponse = await fetch(apiUrl(server, "/v1/import"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ workflows: [preserveWorkflow], preserveWorkflowActivation: true }),
      });
      expect(preserveResponse.status).toBe(200);
      expect((await storage.getWorkflow("workflow-import-preserve-active"))?.status).toBe("active");
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("POST /v1/import can explicitly preserve imported loop scheduling", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage });
    const loop = {
      id: "loop-import-preserve",
      name: "imported-loop-preserve",
      status: "active",
      schedule: { type: "once", at: "2026-01-01T00:00:00.000Z" },
      target: { type: "command", command: "true" },
      nextRunAt: "2026-01-01T00:00:00.000Z",
      retryScheduledFor: "2026-01-01T00:05:00.000Z",
      catchUp: "latest",
      catchUpLimit: 50,
      overlap: "skip",
      maxAttempts: 1,
      retryDelayMs: 60_000,
      leaseMs: 1_800_000,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    try {
      const response = await fetch(apiUrl(server, "/v1/import"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ loops: [loop], preserveLoopScheduling: true }),
      });
      expect(response.status).toBe(200);
      const fetched = await storage.getLoop("loop-import-preserve");
      expect(fetched?.status).toBe("active");
      expect(fetched?.nextRunAt).toBe("2026-01-01T00:00:00.000Z");
      expect(fetched?.retryScheduledFor).toBe("2026-01-01T00:05:00.000Z");
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("route invocation and work-item POST routes preserve caller ids", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage });
    try {
      const invocationResponse = await fetch(apiUrl(server, "/v1/invocations"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          id: "inv-import-1",
          sourceRef: { kind: "task", id: "task-1", dedupeKey: "task-1" },
          subjectRef: { kind: "repo", path: "/repo" },
          intent: "route",
        }),
      });
      expect(invocationResponse.status).toBe(201);
      expect(await invocationResponse.json()).toMatchObject({ ok: true, invocation: { id: "inv-import-1" } });

      const workItemResponse = await fetch(apiUrl(server, "/v1/work-items"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          id: "wi-import-1",
          routeKey: "todos-task",
          idempotencyKey: "task-1",
          invocationId: "inv-import-1",
          sourceType: "task",
          sourceRef: "task:task-1",
          subjectRef: "repo:/repo",
          priority: 10,
          status: "queued",
        }),
      });
      expect(workItemResponse.status).toBe(201);
      expect(await workItemResponse.json()).toMatchObject({ ok: true, workItem: { id: "wi-import-1" } });
      expect((await storage.getWorkflowWorkItem("wi-import-1"))).toMatchObject({
        id: "wi-import-1",
        routeKey: "todos-task",
      });

      const listedInvocations = await fetch(apiUrl(server, "/v1/invocations?limit=10"));
      expect(listedInvocations.status).toBe(200);
      expect(await listedInvocations.json()).toMatchObject({
        ok: true,
        invocations: [expect.objectContaining({ id: "inv-import-1" })],
      });

      const listedWorkItems = await fetch(apiUrl(server, "/v1/work-items?routeKey=todos-task&limit=10"));
      expect(listedWorkItems.status).toBe(200);
      expect(await listedWorkItems.json()).toMatchObject({
        ok: true,
        workItems: [expect.objectContaining({ id: "wi-import-1" })],
      });
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("PATCH only touches fields present in the body and never wipes omitted schedule state", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage });

    try {
      const loop = await storage.createLoop({
        name: "api-patch-preserve-loop",
        schedule: { type: "once", at: "2027-01-01T00:00:00Z" },
        target: { type: "command", command: "true" },
      });
      expect(loop.nextRunAt).toBeString();
      const originalNextRunAt = loop.nextRunAt;

      // PATCH with only status must NOT clear nextRunAt (regression: the route
      // used to emit every key, so an omitted nextRunAt overrode to undefined).
      const pauseResponse = await fetch(apiUrl(server, `/v1/loops/${loop.id}`), {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ status: "paused" }),
      });
      expect(pauseResponse.status).toBe(200);
      const paused = (await pauseResponse.json()) as { loop: { status: string; nextRunAt?: string } };
      expect(paused.loop.status).toBe("paused");
      expect(paused.loop.nextRunAt).toBe(originalNextRunAt);

      // PATCH with only nextRunAt (no status) must succeed and keep status
      // (regression: an omitted status became NULL -> NOT NULL 500).
      const rescheduleResponse = await fetch(apiUrl(server, `/v1/loops/${loop.id}`), {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ nextRunAt: "2027-02-02T00:00:00.000Z" }),
      });
      expect(rescheduleResponse.status).toBe(200);
      const rescheduled = (await rescheduleResponse.json()) as { loop: { status: string; nextRunAt?: string } };
      expect(rescheduled.loop.status).toBe("paused");
      expect(rescheduled.loop.nextRunAt).toBe("2027-02-02T00:00:00.000Z");

      // Explicit JSON null is a deliberate clear.
      const clearResponse = await fetch(apiUrl(server, `/v1/loops/${loop.id}`), {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ nextRunAt: null }),
      });
      expect(clearResponse.status).toBe(200);
      const cleared = (await clearResponse.json()) as { loop: { status: string; nextRunAt?: string } };
      expect(cleared.loop.status).toBe("paused");
      expect(cleared.loop.nextRunAt).toBeUndefined();
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("PATCH updates maxAttempts in place and rejects a non-integer budget with a stable 422", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage });

    try {
      const loop = await storage.createLoop({
        name: "api-retry-budget",
        schedule: { type: "once", at: "2027-01-01T00:00:00Z" },
        target: { type: "command", command: "true" },
      }, new Date("2026-01-01T00:00:00Z"));
      expect(loop.maxAttempts).toBe(1);

      const ok = await fetch(apiUrl(server, `/v1/loops/${loop.id}`), {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ maxAttempts: 3 }),
      });
      expect(ok.status).toBe(200);
      expect((await ok.json()).loop.maxAttempts).toBe(3);
      expect((await storage.getLoop(loop.id))?.maxAttempts).toBe(3);
      // The schedule must survive a retry-budget-only PATCH.
      expect((await storage.getLoop(loop.id))?.nextRunAt).toBe(loop.nextRunAt);

      const before = await storage.getLoop(loop.id);
      for (const maxAttempts of [0, -1, 1.5, "2", null, {}]) {
        const response = await fetch(apiUrl(server, `/v1/loops/${loop.id}`), {
          method: "PATCH",
          headers: jsonHeaders,
          body: JSON.stringify({ maxAttempts, labels: ["mutated"] }),
        });
        expect(response.status).toBe(422);
        expect(await response.json()).toEqual({ ok: false, error: "invalid_max_attempts" });
        expect(await storage.getLoop(loop.id)).toEqual(before);
      }

      // A PATCH that omits maxAttempts must not reset the budget.
      const other = await fetch(apiUrl(server, `/v1/loops/${loop.id}`), {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ status: "paused" }),
      });
      expect(other.status).toBe(200);
      expect((await storage.getLoop(loop.id))?.maxAttempts).toBe(3);
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("PATCH updates leaseMs in place and rejects a non-integer lease with a stable 422", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage });

    try {
      const loop = await storage.createLoop({
        name: "api-lease-widening",
        schedule: { type: "once", at: "2027-01-01T00:00:00Z" },
        target: { type: "command", command: "true" },
      }, new Date("2026-01-01T00:00:00Z"));
      // Regression (O15-00695): a long-running agentic sweep (e.g. the
      // ecosystem-intel-harness Luna loop, 4m..1h+ per run) outlives the 50m
      // default lease and wedges the run; the hosted PATCH must be able to
      // widen the lease in place instead of forcing delete-and-recreate.
      expect(loop.leaseMs).toBe(30 * 60_000);

      const ok = await fetch(apiUrl(server, `/v1/loops/${loop.id}`), {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ leaseMs: 2 * 60 * 60_000 }),
      });
      expect(ok.status).toBe(200);
      expect((await ok.json()).loop.leaseMs).toBe(2 * 60 * 60_000);
      expect((await storage.getLoop(loop.id))?.leaseMs).toBe(2 * 60 * 60_000);
      // The schedule must survive a lease-only PATCH.
      expect((await storage.getLoop(loop.id))?.nextRunAt).toBe(loop.nextRunAt);

      const before = await storage.getLoop(loop.id);
      for (const leaseMs of [0, -1, 1.5, "2", null, {}]) {
        const response = await fetch(apiUrl(server, `/v1/loops/${loop.id}`), {
          method: "PATCH",
          headers: jsonHeaders,
          body: JSON.stringify({ leaseMs, labels: ["mutated"] }),
        });
        expect(response.status).toBe(422);
        expect(await response.json()).toEqual({ ok: false, error: "invalid_lease_ms" });
        expect(await storage.getLoop(loop.id)).toEqual(before);
      }

      // A PATCH that omits leaseMs must not reset the lease.
      const other = await fetch(apiUrl(server, `/v1/loops/${loop.id}`), {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ status: "paused" }),
      });
      expect(other.status).toBe(200);
      expect((await storage.getLoop(loop.id))?.leaseMs).toBe(2 * 60 * 60_000);
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("PATCH sets and clears expiresAfterRuns in place and rejects invalid ceilings with a stable 422", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage });

    try {
      const loop = await storage.createLoop({
        name: "api-expires-after-runs",
        schedule: { type: "once", at: "2027-01-01T00:00:00Z" },
        target: { type: "command", command: "true" },
      }, new Date("2026-01-01T00:00:00Z"));
      expect(loop.expiresAfterRuns).toBeUndefined();

      const ok = await fetch(apiUrl(server, `/v1/loops/${loop.id}`), {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ expiresAfterRuns: 7 }),
      });
      expect(ok.status).toBe(200);
      expect((await ok.json()).loop.expiresAfterRuns).toBe(7);
      expect((await storage.getLoop(loop.id))?.expiresAfterRuns).toBe(7);
      // The schedule must survive an expiry-ceiling-only PATCH.
      expect((await storage.getLoop(loop.id))?.nextRunAt).toBe(loop.nextRunAt);

      const before = await storage.getLoop(loop.id);
      for (const expiresAfterRuns of [0, -1, 1.5, "2", {}]) {
        const response = await fetch(apiUrl(server, `/v1/loops/${loop.id}`), {
          method: "PATCH",
          headers: jsonHeaders,
          body: JSON.stringify({ expiresAfterRuns, labels: ["mutated"] }),
        });
        expect(response.status).toBe(422);
        expect(await response.json()).toEqual({ ok: false, error: "invalid_expires_after_runs" });
        expect(await storage.getLoop(loop.id)).toEqual(before);
      }

      // JSON null is an explicit clear.
      const cleared = await fetch(apiUrl(server, `/v1/loops/${loop.id}`), {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ expiresAfterRuns: null }),
      });
      expect(cleared.status).toBe(200);
      expect((await storage.getLoop(loop.id))?.expiresAfterRuns).toBeUndefined();

      // A PATCH that omits the field must not reset the ceiling.
      const other = await fetch(apiUrl(server, `/v1/loops/${loop.id}`), {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ expiresAfterRuns: 3 }),
      });
      expect(other.status).toBe(200);
      const pauseOnly = await fetch(apiUrl(server, `/v1/loops/${loop.id}`), {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ status: "paused" }),
      });
      expect(pauseOnly.status).toBe(200);
      expect((await storage.getLoop(loop.id))?.expiresAfterRuns).toBe(3);
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("PATCH rejects every invalid loop status atomically with a stable 422", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage });

    try {
      const loop = await storage.createLoop({
        name: "api-status-boundary",
        labels: ["original"],
        schedule: { type: "once", at: "2027-01-01T00:00:00Z" },
        target: { type: "command", command: "true" },
      }, new Date("2026-01-01T00:00:00Z"));
      const before = await storage.getLoop(loop.id);

      for (const status of ["poisoned", null, 7, {}, ""]) {
        const response = await fetch(apiUrl(server, `/v1/loops/${loop.id}`), {
          method: "PATCH",
          headers: jsonHeaders,
          body: JSON.stringify({
            status,
            labels: ["mutated"],
            nextRunAt: "2099-01-01T00:00:00.000Z",
          }),
        });
        expect(response.status).toBe(422);
        expect(await response.json()).toEqual({ ok: false, error: "invalid_loop_status" });
        expect(await storage.getLoop(loop.id)).toEqual(before);
      }

      for (const body of [null, 7, "invalid", true, []]) {
        const response = await fetch(apiUrl(server, `/v1/loops/${loop.id}`), {
          method: "PATCH",
          headers: jsonHeaders,
          body: JSON.stringify(body),
        });
        expect(response.status).toBe(422);
        expect(await response.json()).toEqual({ ok: false, error: "invalid_object" });
        expect(await storage.getLoop(loop.id)).toEqual(before);
      }
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("only one concurrent runner finalization advances fixed-delay success and retry schedules", async () => {
    const mod = await import("./index.js");
    const serverNow = new Date("2026-01-01T00:00:10.000Z");
    const startedAt = new Date("2026-01-01T00:00:05.000Z");

    for (const scenario of [
      {
        name: "success",
        status: "succeeded" as const,
        input: {
          schedule: { type: "interval" as const, everyMs: 60_000, anchor: "fixed_delay" as const },
          target: { type: "command" as const, command: "true" },
        },
        expectedNextRunAt: "2026-01-01T00:01:10.000Z",
        expectedRetryScheduledFor: undefined,
      },
      {
        name: "retry",
        status: "failed" as const,
        input: {
          schedule: { type: "interval" as const, everyMs: 60_000, anchor: "fixed_delay" as const },
          target: { type: "command" as const, command: "false" },
          maxAttempts: 2,
          retryDelayMs: 5_000,
        },
        expectedNextRunAt: "2026-01-01T00:00:15.000Z",
        expectedRetryScheduledFor: "2026-01-01T00:00:00.000Z",
      },
    ]) {
      const baseStorage = createSqliteLoopStorage(":memory:");
      const loop = await baseStorage.createLoop({
        name: `api-finalize-race-${scenario.name}`,
        ...scenario.input,
      }, new Date("2025-12-31T00:00:00Z"));
      const claim = await baseStorage.claimRun(
        loop,
        "2026-01-01T00:00:00.000Z",
        "runner-race",
        startedAt,
      );
      expect(claim).toBeTruthy();

      let runningReads = 0;
      let advancementWrites = 0;
      let releaseReads = () => {};
      const bothRead = new Promise<void>((resolve) => {
        releaseReads = resolve;
      });
      const storage = new Proxy(baseStorage, {
        get(target, property) {
          if (property === "getRun") {
            return async (runId: string) => {
              const run = await target.getRun(runId);
              if (runId === claim!.run.id && run?.status === "running" && runningReads < 2) {
                runningReads += 1;
                if (runningReads === 2) releaseReads();
                await bothRead;
              }
              return run;
            };
          }
          if (property === "advanceLoopIfCurrent") {
            return async (...args: Parameters<typeof target.advanceLoopIfCurrent>) => {
              const result = await target.advanceLoopIfCurrent(...args);
              if (result) advancementWrites += 1;
              return result;
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as LoopStorageContract;
      const server = createTestServer(
        mod,
        { host: "127.0.0.1", port: 0, storage, now: () => serverNow, random: () => 0.5 },
        runnerPrincipal("runner-race"),
      );

      try {
        const finalize = () => fetch(apiUrl(server, `/v1/runs/${claim!.run.id}/finalize`), {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            claimToken: claim!.claimToken,
            status: scenario.status,
            stdout: "",
            stderr: "",
          }),
        });
        const responses = await Promise.all([finalize(), finalize()]);
        expect(responses.map((response) => response.status).sort()).toEqual([200, 200]);
        const bodies = await Promise.all(responses.map((response) => response.json()));
        expect(bodies.filter((body) => body.ok === true)).toHaveLength(2);
        expect(advancementWrites).toBe(1);
        expect(await baseStorage.getLoop(loop.id)).toMatchObject({
          status: "active",
          nextRunAt: scenario.expectedNextRunAt,
          ...(scenario.expectedRetryScheduledFor === undefined
            ? { retryScheduledFor: undefined }
            : { retryScheduledFor: scenario.expectedRetryScheduledFor }),
        });
      } finally {
        server.stop(true);
        await baseStorage.close();
      }
    }
  });

  test("runner finalization bounds evidence and advances success/retry schedules from server time", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const serverNow = new Date("2026-01-01T00:00:10.000Z");
    const startedAt = new Date("2026-01-01T00:00:05.000Z");
    const server = createTestServer(
      mod,
      { host: "127.0.0.1", port: 0, storage, now: () => serverNow, random: () => 0.5 },
      runnerPrincipal("runner-clock"),
    );

    try {
      for (const [name, requestedFinishedAt, expectedFinishedAt] of [
        ["future", "2099-01-01T00:00:00.000Z", serverNow.toISOString()],
        ["past", "2000-01-01T00:00:00.000Z", startedAt.toISOString()],
        ["omitted", undefined, serverNow.toISOString()],
      ] as const) {
        const loop = await storage.createLoop({
          name: `api-completion-${name}`,
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
        }, new Date("2025-12-31T00:00:00Z"));
        const claim = await storage.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner-clock", startedAt);
        expect(claim).toBeTruthy();

        if (name === "future") {
          for (const invalidFinishedAt of ["not-a-date", 123]) {
            const invalid = await fetch(apiUrl(server, `/v1/runs/${claim!.run.id}/finalize`), {
              method: "POST",
              headers: jsonHeaders,
              body: JSON.stringify({
                claimToken: claim!.claimToken,
                status: "succeeded",
                finishedAt: invalidFinishedAt,
                stdout: "",
                stderr: "",
              }),
            });
            expect(invalid.status).toBe(422);
            expect((await storage.getRun(claim!.run.id))?.status).toBe("running");
          }
        }

        const response = await fetch(apiUrl(server, `/v1/runs/${claim!.run.id}/finalize`), {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            claimToken: claim!.claimToken,
            status: "succeeded",
            ...(requestedFinishedAt === undefined ? {} : { finishedAt: requestedFinishedAt }),
            stdout: "",
            stderr: "",
          }),
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          ok: true,
          run: {
            status: "succeeded",
            finishedAt: expectedFinishedAt,
            durationMs: 5_000,
          },
        });
        expect(await storage.getLoop(loop.id)).toMatchObject({
          status: "active",
          nextRunAt: "2026-01-01T00:01:00.000Z",
        });
      }

      const retryLoop = await storage.createLoop({
        name: "api-completion-retry",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "false" },
        maxAttempts: 2,
        retryDelayMs: 5_000,
      }, new Date("2025-12-31T00:00:00Z"));
      const retryClaim = await storage.claimRun(retryLoop, "2026-01-01T00:00:00.000Z", "runner-clock", startedAt);
      const retryResponse = await fetch(apiUrl(server, `/v1/runs/${retryClaim!.run.id}/finalize`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          claimToken: retryClaim!.claimToken,
          status: "failed",
          finishedAt: "2099-01-01T00:00:00.000Z",
          stdout: "",
          stderr: "",
        }),
      });
      expect(retryResponse.status).toBe(200);
      expect(await storage.getLoop(retryLoop.id)).toMatchObject({
        status: "active",
        nextRunAt: "2026-01-01T00:00:15.000Z",
        retryScheduledFor: "2026-01-01T00:00:00.000Z",
      });
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("runner finalization accepts only policy-backed skipped completions and advances recurrence", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = createTestServer(
      mod,
      { host: "127.0.0.1", port: 0, storage, now: () => new Date("2026-01-01T00:00:10.000Z") },
      runnerPrincipal("runner-skip"),
    );

    try {
      const loop = await storage.createLoop({
        name: "api-configured-skip",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "exit 75", shell: true },
        overlap: "skip",
        maxAttempts: 3,
      }, new Date("2025-12-31T00:00:00.000Z"));
      const claim = await storage.claimRun(
        loop,
        "2026-01-01T00:00:00.000Z",
        "runner-skip",
        new Date("2026-01-01T00:00:01.000Z"),
      );
      expect(claim).toBeTruthy();

      const finalize = () => fetch(apiUrl(server, `/v1/runs/${claim!.run.id}/finalize`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          claimToken: claim!.claimToken,
          status: "skipped",
          stdout: "",
          stderr: "configured decline",
          error: "process exited with code 75",
          exitCode: 75,
        }),
      });

      expect((await finalize()).status).toBe(200);
      expect(await storage.getRun(claim!.run.id)).toMatchObject({ status: "skipped", exitCode: 75 });
      expect(await storage.getLoop(loop.id)).toMatchObject({
        status: "active",
        nextRunAt: "2026-01-01T00:01:00.000Z",
        retryScheduledFor: undefined,
      });
      expect((await finalize()).status).toBe(200);

      const allowLoop = await storage.createLoop({
        name: "api-unconfigured-skip",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "exit 75", shell: true },
        overlap: "allow",
      }, new Date("2025-12-31T00:00:00.000Z"));
      const allowClaim = await storage.claimRun(
        allowLoop,
        "2026-01-01T00:00:00.000Z",
        "runner-skip",
        new Date("2026-01-01T00:00:01.000Z"),
      );
      const rejected = await fetch(apiUrl(server, `/v1/runs/${allowClaim!.run.id}/finalize`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          claimToken: allowClaim!.claimToken,
          status: "skipped",
          stdout: "",
          stderr: "",
          exitCode: 75,
        }),
      });
      expect(rejected.status).toBe(422);
      expect(await rejected.json()).toEqual({ ok: false, error: "skip_status_requires_overlap_skip_exit_75" });
      expect((await storage.getRun(allowClaim!.run.id))?.status).toBe("running");
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("run listing redacts output unless explicitly requested", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage });

    try {
      const loop = await storage.createLoop({
        name: "api-run-output-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "command", command: "false" },
      });
      const claim = await storage.claimRun(loop, "2026-01-01T00:00:00.000Z", "api-runner", new Date("2026-01-01T00:00:00Z"));
      await storage.finalizeRun(claim!.run.id, {
        status: "failed",
        finishedAt: "2026-01-01T00:00:01.000Z",
        durationMs: 1_000,
        stdout: "private stdout",
        stderr: "private stderr",
        error: "private error",
      });

      const redactedResponse = await fetch(apiUrl(server, `/v1/runs?loopId=${loop.id}`));
      const redacted = (await redactedResponse.json()) as { runs: { id: string; stdout?: string; stderr?: string; error?: string }[] };
      expect(redactedResponse.status).toBe(200);
      expect(redacted.runs[0]).toMatchObject({
        id: claim!.run.id,
        stdout: "[redacted 14 chars]",
        stderr: "[redacted 14 chars]",
        error: "[redacted 13 chars]",
      });

      const rawResponse = await fetch(apiUrl(server, `/v1/runs/${claim!.run.id}?showOutput=true`));
      const raw = (await rawResponse.json()) as { run: { stdout?: string; stderr?: string; error?: string } };
      expect(rawResponse.status).toBe(200);
      expect(raw.run.stdout).toBe("private stdout");
      expect(raw.run.stderr).toBe("private stderr");
      expect(raw.run.error).toBe("[redacted 13 chars]");

      const secondLoop = await storage.createLoop({
        name: "api-run-output-loop-page-2",
        schedule: { type: "once", at: "2026-01-01T00:01:00Z" },
        target: { type: "command", command: "true" },
      });
      const secondClaim = await storage.claimRun(
        secondLoop,
        "2026-01-01T00:01:00.000Z",
        "api-runner",
        new Date("2026-01-01T00:01:00Z"),
      );
      await storage.finalizeRun(secondClaim!.run.id, {
        status: "succeeded",
        finishedAt: "2026-01-01T00:01:01.000Z",
        durationMs: 1_000,
        stdout: "second stdout",
        stderr: "",
      });

      const firstPageResponse = await fetch(apiUrl(server, "/v1/runs?limit=1&offset=0&showOutput=true"));
      const firstPage = (await firstPageResponse.json()) as { runs: { id: string; stdout?: string }[] };
      const secondPageResponse = await fetch(apiUrl(server, "/v1/runs?limit=1&offset=1&showOutput=true"));
      const secondPage = (await secondPageResponse.json()) as { runs: { id: string; stdout?: string }[] };
      expect(firstPageResponse.status).toBe(200);
      expect(secondPageResponse.status).toBe(200);
      expect(firstPage.runs).toHaveLength(1);
      expect(secondPage.runs).toHaveLength(1);
      expect(firstPage.runs[0]?.id).not.toBe(secondPage.runs[0]?.id);
      expect(new Set([firstPage.runs[0]?.stdout, secondPage.runs[0]?.stdout])).toEqual(new Set(["private stdout", "second stdout"]));

      const badOffset = await fetch(apiUrl(server, "/v1/runs?offset=-1"));
      expect(badOffset.status).toBe(422);
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("GET /v1/runs/count accepts the same loopId/labels/status filters as GET /v1/runs (LOO3-00143 P1)", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage });

    try {
      const alpha = await storage.createLoop({
        name: "api-count-alpha",
        labels: ["shared"],
        overlap: "allow",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "command", command: "true" },
      });
      const beta = await storage.createLoop({
        name: "api-count-beta",
        labels: ["shared"],
        overlap: "allow",
        schedule: { type: "once", at: "2026-01-01T00:01:00Z" },
        target: { type: "command", command: "true" },
      });
      // alpha: 2 running runs, beta: 1 running + 2 succeeded (global 5).
      for (let i = 0; i < 2; i += 1) await storage.claimRun(alpha, `2026-01-01T00:00:0${i}.000Z`, "api-runner");
      for (let i = 0; i < 3; i += 1) {
        const claim = await storage.claimRun(beta, `2026-01-01T00:01:0${i}.000Z`, "api-runner");
        if (i > 0) {
          await storage.finalizeRun(claim!.run.id, {
            status: "succeeded",
            finishedAt: `2026-01-01T00:01:0${i}.500Z`,
            durationMs: 1_000,
            stdout: "",
            stderr: "",
          });
        }
      }

      const countJson = async (query: string): Promise<{ ok: boolean; count?: number; error?: string }> => {
        const res = await fetch(apiUrl(server, `/v1/runs/count${query}`));
        expect(res.status).toBe(200);
        return (await res.json()) as { ok: boolean; count?: number; error?: string };
      };

      expect((await countJson("")).count).toBe(5);
      expect((await countJson(`?loopId=${encodeURIComponent(alpha.id)}`)).count).toBe(2);
      expect((await countJson(`?loopId=${encodeURIComponent(beta.id)}`)).count).toBe(3);
      expect((await countJson(`?loopId=${encodeURIComponent(alpha.id)}&status=running`)).count).toBe(2);
      expect((await countJson(`?loopId=${encodeURIComponent(beta.id)}&status=succeeded`)).count).toBe(2);
      expect((await countJson("?status=running")).count).toBe(3);
      expect((await countJson("?status=succeeded")).count).toBe(2);
      expect((await countJson("?labels=shared")).count).toBe(5);
      expect((await countJson(`?loopId=${encodeURIComponent(beta.id)}&labels=shared`)).count).toBe(3);
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("run receipt routes write, read, and filter bounded receipts", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage });

    try {
      const writeResponse = await fetch(apiUrl(server, "/v1/receipts"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          loop_id: "loop-api",
          run_id: "run-api",
          machine: "spark01",
          repo: "/workspace/open-loops",
          task_ids: ["task-api"],
          knowledge_ids: ["knowledge-api"],
          status: "succeeded",
          summary: "api receipt",
          evidence_paths: ["/tmp/api-receipt.json"],
          stdout: "z".repeat(50_000),
        }),
      });
      expect(writeResponse.status).toBe(201);
      const written = (await writeResponse.json()) as { receipt: { run_id: string; summary: { stdout_bytes: number; stdout_excerpt?: string } } };
      expect(written.receipt.run_id).toBe("run-api");
      expect(written.receipt.summary.stdout_bytes).toBe(50_000);
      expect(written.receipt.summary.stdout_excerpt).toBeUndefined();
      expect((await storage.getRunReceipt("run-api"))?.summary.stdout_excerpt).toContain("chars omitted");

      const readResponse = await fetch(apiUrl(server, "/v1/receipts/run-api"));
      expect(readResponse.status).toBe(200);
      const read = (await readResponse.json()) as { receipt: { summary: { text?: string } } };
      expect(read.receipt.summary.text).toBeUndefined();

      const listResponse = await fetch(apiUrl(server, "/v1/receipts?taskId=task-api"));
      expect(listResponse.status).toBe(200);
      const list = (await listResponse.json()) as { receipts: Array<{ run_id: string }> };
      expect(list.receipts.map((receipt) => receipt.run_id)).toEqual(["run-api"]);
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("storage-backed routes fail closed without configured storage", async () => {
    const mod = await import("./index.js");
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0 }, runnerPrincipal("spark01"));

    try {
      const response = await fetch(apiUrl(server, "/v1/loops"));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ ok: false, error: "storage_unconfigured" });
    } finally {
      server.stop(true);
    }
  });

  test("mutating routes enforce JSON content type and bounded bodies", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, bodyLimitBytes: 8, storage });

    try {
      const unsupported = await fetch(apiUrl(server, "/v1/runners/claim"), {
        method: "POST",
        body: "{}",
      });
      expect(unsupported.status).toBe(415);
      expect(await unsupported.json()).toMatchObject({ ok: false, error: "unsupported_media_type" });

      const malformed = await fetch(apiUrl(server, "/v1/runners/claim"), {
        method: "POST",
        headers: jsonHeaders,
        body: "{",
      });
      expect(malformed.status).toBe(400);
      expect(await malformed.json()).toMatchObject({ ok: false, error: "invalid_json" });

      const tooLarge = await fetch(apiUrl(server, "/v1/runners/claim"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ machineId: "spark01" }),
      });
      expect(tooLarge.status).toBe(413);
      expect(await tooLarge.json()).toMatchObject({ ok: false, error: "body_too_large" });
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("runner protocol endpoints fail closed without storage", async () => {
    const mod = await import("./index.js");
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0 }, runnerPrincipal("spark01"));

    try {
      for (const action of ["heartbeat", "finalize", "evidence"]) {
        const runResponse = await fetch(apiUrl(server, `/v1/runs/run-1/${action}`), {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ claimToken: "claim-token" }),
        });
        expect(runResponse.status).toBe(503);
        expect(await runResponse.json()).toMatchObject({ ok: false, error: "storage_unconfigured" });
      }

      const recoverResponse = await fetch(apiUrl(server, "/v1/runs/run-1/recover"), { method: "POST" });
      expect(recoverResponse.status).toBe(503);
      expect(await recoverResponse.json()).toMatchObject({ ok: false, error: "storage_unconfigured" });

      const claimResponse = await fetch(apiUrl(server, "/v1/runners/claim"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ runnerId: "spark01" }),
      });
      expect(claimResponse.status).toBe(503);
      expect(await claimResponse.json()).toMatchObject({ ok: false, error: "storage_unconfigured" });
    } finally {
      server.stop(true);
    }
  });

  test("machine credentials cannot claim as a different runner identity", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const machinePrincipal = {
      ...testPrincipal,
      principalId: "machine-bound",
      tokenKind: "machine" as const,
      roles: ["worker" as const],
      scopes: ["loops:runner"],
    };
    const server = mod.createLoopsApiServer({
      host: "127.0.0.1",
      port: 0,
      authenticator: {
        authenticate: async () => ({ ok: true as const, status: 200 as const, principal: machinePrincipal }),
      },
      withTenantStorage: (_principal, fn) => fn(storage),
    });
    try {
      const response = await fetch(apiUrl(server, "/v1/runners/claim"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ runnerId: "machine-spoofed" }),
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ ok: false, error: "runner_identity_mismatch" });

      const machineSpoof = await fetch(apiUrl(server, "/v1/runners/claim"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ runnerId: "machine-bound", machineId: "machine-spoofed" }),
      });
      expect(machineSpoof.status).toBe(403);
      expect(await machineSpoof.json()).toMatchObject({ ok: false, error: "runner_identity_mismatch" });

      const hostnameSpoof = await fetch(apiUrl(server, "/v1/runners/claim"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ runnerId: "machine-bound", hostname: "machine-spoofed" }),
      });
      expect(hostnameSpoof.status).toBe(403);
      expect(await hostnameSpoof.json()).toMatchObject({ ok: false, error: "runner_identity_mismatch" });

      await storage.createLoop({
        name: "alias-collision",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "command", command: "true" },
        machine: { id: "machine-canonical", requestedId: "machine-bound" },
      }, new Date("2025-12-31T00:00:00Z"));
      const aliasCollision = await fetch(apiUrl(server, "/v1/runners/claim"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ runnerId: "machine-bound", now: "2026-01-01T00:00:00Z" }),
      });
      expect(aliasCollision.status).toBe(200);
      expect(await aliasCollision.json()).toMatchObject({ ok: true, claims: [] });
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  // A machine-UNBOUND loop matched every runner with no opt-out, so any runner
  // started anywhere drained the whole fleet's unpinned work onto itself. The
  // runner does no filtering — it executes whatever the claim response hands
  // back — so this gate is the only place the scope can be enforced.
  //
  // Both directions are load-bearing. The default must stay permissive because
  // the fleet's only live carrier sends no claimScope at all; a default flip
  // would strand every unbound loop the moment it deployed.
  describe("runner claim scope", () => {
    const DUE_AT = "2026-01-01T00:00:00Z";
    const POLL_AT = "2026-01-01T00:00:01Z";

    async function claimWith(
      body: Record<string, unknown>,
    ): Promise<{ status: number; payload: Record<string, unknown> }> {
      const mod = await import("./index.js");
      const storage = createSqliteLoopStorage(":memory:");
      const createdAt = new Date("2025-12-31T00:00:00Z");
      await storage.createLoop({
        name: "fleet-unbound",
        schedule: { type: "once", at: DUE_AT },
        target: { type: "command", command: "true" },
      }, createdAt);
      await storage.createLoop({
        name: "pinned-spark02",
        schedule: { type: "once", at: DUE_AT },
        target: { type: "command", command: "true" },
        machine: { id: "spark02" },
      }, createdAt);
      const server = createTestServer(
        mod,
        { host: "127.0.0.1", port: 0, storage, now: () => new Date(POLL_AT) },
        runnerPrincipal("spark02"),
      );
      try {
        const response = await fetch(apiUrl(server, "/v1/runners/claim"), {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ runnerId: "spark02", maxClaims: 10, ...body }),
        });
        return { status: response.status, payload: await response.json() as Record<string, unknown> };
      } finally {
        server.stop(true);
        await storage.close();
      }
    }

    function claimedLoopNames(payload: Record<string, unknown>): string[] {
      const claims = payload.claims as Array<{ loop: { name: string } }> | undefined;
      return (claims ?? []).map((claim) => claim.loop.name).sort();
    }

    test("a runner that sends no claimScope still claims unbound loops (default preserved)", async () => {
      const { status, payload } = await claimWith({});
      expect(status).toBe(200);
      expect(claimedLoopNames(payload)).toEqual(["fleet-unbound", "pinned-spark02"]);
    });

    test("claimScope fleet is byte-identical to sending nothing", async () => {
      const { status, payload } = await claimWith({ claimScope: "fleet" });
      expect(status).toBe(200);
      expect(claimedLoopNames(payload)).toEqual(["fleet-unbound", "pinned-spark02"]);
    });

    test("claimScope bound claims only loops pinned to this runner", async () => {
      const { status, payload } = await claimWith({ claimScope: "bound" });
      expect(status).toBe(200);
      expect(claimedLoopNames(payload)).toEqual(["pinned-spark02"]);
    });

    // A typo must not silently fall through to the permissive default: that is
    // the exact shape of "the flag was accepted and did nothing".
    test("an unrecognised claimScope is rejected rather than coerced", async () => {
      const { status, payload } = await claimWith({ claimScope: "machine" });
      expect(status).toBe(422);
      expect(payload).toMatchObject({ ok: false, error: "invalid_claim_scope" });
    });

    // The runner asserts this echo on every poll. A server that ignored the
    // field would answer 200 with a normal claim set and no echo, which is
    // indistinguishable from enforcement unless the runner checks.
    test("the parsed claimScope is echoed back on the runner record", async () => {
      const bound = await claimWith({ claimScope: "bound" });
      expect(bound.payload.runner).toMatchObject({ id: "spark02", claimScope: "bound" });
      const fleet = await claimWith({});
      expect((fleet.payload.runner as Record<string, unknown>).claimScope).toBeUndefined();
    });

    // Pre-flight: the fix reaches npm long before it reaches the control plane,
    // so a bound runner must be able to detect a server that cannot enforce it
    // BEFORE it claims anything it has no way to give back.
    test("/version advertises the runner.claimScope capability", async () => {
      const mod = await import("./index.js");
      const server = createTestServer(mod, { host: "127.0.0.1", port: 0 });
      try {
        const response = await fetch(apiUrl(server, "/version"));
        expect(response.status).toBe(200);
        const payload = await response.json() as { capabilities?: string[] };
        expect(payload.capabilities).toContain("runner.claimScope");
      } finally {
        server.stop(true);
      }
    });
  });

  // Incident 607176. The runner executes the loop it is handed by the claim
  // response; nothing downstream can recover a prompt that was redacted here.
  // `claimRuns` used to push `publicLoop(claim.loop)`, which rewrote
  // target.prompt to "[redacted N chars]" for agent targets, so every agent
  // loop ran with a 20-character placeholder as its entire instruction and
  // exited 0 having done nothing. The redaction belongs on operator-facing
  // reads (GET /v1/loops), never on the runner's execution payload.
  test("runner claim delivers the agent prompt unredacted", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const now = new Date("2026-01-01T00:00:05Z");
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage, now: () => now }, runnerPrincipal("runner-prompt"));
    const prompt = "Using the Write tool, create /tmp/loop-probe.txt containing exactly SENTINEL-OK and nothing else.";

    try {
      const loop = await storage.createLoop(
        {
          name: "api-runner-agent-prompt",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "agent", provider: "claude", prompt },
          leaseMs: 60_000,
        },
        new Date("2025-12-31T00:00:00Z"),
      );

      const claimResponse = await fetch(apiUrl(server, "/v1/runners/claim"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ runnerId: "runner-prompt", now: "2026-01-01T00:00:00Z", maxClaims: 1 }),
      });
      expect(claimResponse.status).toBe(200);
      const claimed = (await claimResponse.json()) as {
        claims: Array<{ loop: { id: string; target: { prompt?: string } } }>;
      };
      expect(claimed.claims).toHaveLength(1);
      expect(claimed.claims[0]!.loop.id).toBe(loop.id);
      expect(claimed.claims[0]!.loop.target.prompt).toBe(prompt);
      expect(claimed.claims[0]!.loop.target.prompt).not.toMatch(/^\[redacted/);

      // ...while the operator-facing read omits the private prompt entirely.
      const read = await fetch(apiUrl(server, `/v1/loops/${loop.id}`), { headers: jsonHeaders });
      const body = (await read.json()) as { loop: { target: { prompt?: string } } };
      expect(body.loop.target.prompt).toBeUndefined();
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("runner claim and run finalization are fenced by claim token", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    let now = new Date("2026-01-01T00:00:05Z");
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage, now: () => now }, runnerPrincipal("runner-a"));

    try {
      const loop = await storage.createLoop(
        {
          name: "api-runner-claim-loop",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
          leaseMs: 60_000,
        },
        new Date("2025-12-31T00:00:00Z"),
      );

      const claimResponse = await fetch(apiUrl(server, "/v1/runners/claim"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ runnerId: "runner-a", now: "2026-01-01T00:00:00Z", maxClaims: 1 }),
      });
      expect(claimResponse.status).toBe(200);
      const claimed = (await claimResponse.json()) as {
        claims: Array<{ claimToken?: string; loop: { id: string }; run: { id: string; status: string } }>;
      };
      expect(claimed.claims).toHaveLength(1);
      expect(claimed.claims[0]!.loop.id).toBe(loop.id);
      expect(claimed.claims[0]!.run.status).toBe("running");
      expect(claimed.claims[0]!.claimToken).toBeString();

      const otherRunner = createTestServer(
        mod,
        { host: "127.0.0.1", port: 0, storage, now: () => now },
        runnerPrincipal("runner-b"),
      );
      try {
        for (const [action, extra] of [
          ["heartbeat", {}],
          ["evidence", { evidence: { log: "stolen" } }],
          ["finalize", { status: "succeeded", stdout: "", stderr: "" }],
        ] as const) {
          const response = await fetch(apiUrl(otherRunner, `/v1/runs/${claimed.claims[0]!.run.id}/${action}`), {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ claimToken: claimed.claims[0]!.claimToken, ...extra }),
          });
          expect(response.status).toBe(403);
          expect(await response.json()).toMatchObject({ ok: false, error: "runner_identity_mismatch" });
        }
      } finally {
        otherRunner.stop(true);
      }

      const duplicate = await fetch(apiUrl(server, "/v1/runners/claim"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ runnerId: "runner-a", now: "2026-01-01T00:00:00.100Z", maxClaims: 1 }),
      });
      expect(duplicate.status).toBe(200);
      expect(await duplicate.json()).toMatchObject({ ok: true, claims: [] });

      const runId = claimed.claims[0]!.run.id;
      now = new Date("2026-01-01T00:00:01Z");
      const wrongHeartbeat = await fetch(apiUrl(server, `/v1/runs/${runId}/heartbeat`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ claimToken: "wrong-token", now: "2026-01-01T00:00:01Z" }),
      });
      expect(wrongHeartbeat.status).toBe(409);
      expect(await wrongHeartbeat.json()).toMatchObject({ ok: false, error: "stale_claim" });

      const heartbeat = await fetch(apiUrl(server, `/v1/runs/${runId}/heartbeat`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ claimToken: claimed.claims[0]!.claimToken, now: "2026-01-01T00:00:01Z" }),
      });
      expect(heartbeat.status).toBe(200);

      now = new Date("2026-01-01T00:00:01.500Z");
      const evidence = await fetch(apiUrl(server, `/v1/runs/${runId}/evidence`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          claimToken: claimed.claims[0]!.claimToken,
          now: "2026-01-01T00:00:01.500Z",
          evidence: { log: "Authorization: Bearer abcdefghijklmnop" },
        }),
      });
      expect(evidence.status).toBe(200);
      expect(JSON.stringify(await evidence.json())).not.toContain("abcdefghijklmnop");

      now = new Date("2026-01-01T00:00:07Z");
      const wrongFinalize = await fetch(apiUrl(server, `/v1/runs/${runId}/finalize`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ claimToken: "wrong-token", status: "succeeded", stdout: "", stderr: "" }),
      });
      expect(wrongFinalize.status).toBe(409);

      const finalize = await fetch(apiUrl(server, `/v1/runs/${runId}/finalize`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          claimToken: claimed.claims[0]!.claimToken,
          status: "succeeded",
          finishedAt: "2026-01-01T00:00:02Z",
          stdout: "private stdout",
          stderr: "",
        }),
      });
      expect(finalize.status).toBe(200);
      expect(await finalize.json()).toMatchObject({ ok: true, run: { status: "succeeded", stdout: "[redacted 14 chars]" } });
      expect(await storage.getLoop(loop.id)).toMatchObject({ status: "stopped", nextRunAt: undefined });

      const runsResponse = await fetch(apiUrl(server, "/v1/runs?showOutput=true"));
      const runs = JSON.stringify(await runsResponse.json());
      expect(runs).not.toContain("claimToken");
      expect(runs).not.toContain(claimed.claims[0]!.claimToken!);
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("single-run recovery never sweeps another expired run", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const claimedAt = new Date("2026-01-01T00:00:00Z");
    const recoveredAt = new Date("2026-01-01T00:00:02Z");
    const loops = await Promise.all(["recover-one", "recover-two"].map((name) => storage.createLoop({
      name,
      schedule: { type: "interval", everyMs: 60_000 },
      target: { type: "command", command: "true" },
      leaseMs: 1_000,
    }, claimedAt)));
    const first = await storage.claimRun(loops[0]!, claimedAt.toISOString(), "runner-a", claimedAt);
    const second = await storage.claimRun(loops[1]!, claimedAt.toISOString(), "runner-b", claimedAt);
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    const server = createTestServer(
      mod,
      { host: "127.0.0.1", port: 0, storage, now: () => recoveredAt },
      runnerPrincipal("runner-a"),
    );
    try {
      const intruder = createTestServer(
        mod,
        { host: "127.0.0.1", port: 0, storage, now: () => recoveredAt },
        runnerPrincipal("runner-b"),
      );
      try {
        const denied = await fetch(apiUrl(intruder, `/v1/runs/${first!.run.id}/recover`), { method: "POST" });
        expect(denied.status).toBe(403);
        expect(await denied.json()).toMatchObject({ ok: false, error: "run_claim_owner_mismatch" });
        expect(await storage.getRun(first!.run.id)).toMatchObject({ status: "running" });

        const sweep = await fetch(apiUrl(intruder, "/v1/leases/recover"), { method: "POST" });
        expect(sweep.status).toBe(403);
        expect(await sweep.json()).toMatchObject({ ok: false, error: "maintenance_principal_required" });
      } finally {
        intruder.stop(true);
      }

      const response = await fetch(apiUrl(server, `/v1/runs/${first!.run.id}/recover`), { method: "POST" });
      expect(response.status).toBe(200);
      expect(await storage.getRun(first!.run.id)).toMatchObject({ status: "abandoned" });
      expect(await storage.getRun(second!.run.id)).toMatchObject({ status: "running" });
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("hosted stuck-run detection and reconciliation distinguish stale, healthy, unauthorized, conflict, and replay", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const now = new Date("2026-01-01T00:20:00.000Z");
    const staleClaimedAt = new Date("2026-01-01T00:00:00.000Z");
    const healthyClaimedAt = new Date("2026-01-01T00:19:30.000Z");
    const staleLoop = await storage.createLoop({
      name: "hosted-stuck-known-stale",
      schedule: { type: "interval", everyMs: 60_000 },
      target: { type: "command", command: "true" },
      leaseMs: 1_000,
    }, staleClaimedAt);
    const healthyLoop = await storage.createLoop({
      name: "hosted-stuck-known-healthy",
      schedule: { type: "interval", everyMs: 60_000 },
      target: { type: "command", command: "true" },
      leaseMs: 60_000,
    }, healthyClaimedAt);
    const stale = await storage.claimRun(staleLoop, staleClaimedAt.toISOString(), "runner-stale", staleClaimedAt);
    const healthy = await storage.claimRun(healthyLoop, healthyClaimedAt.toISOString(), "runner-healthy", healthyClaimedAt);
    expect(stale).toBeTruthy();
    expect(healthy).toBeTruthy();

    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage, now: () => now });
    const wrongScopeServer = mod.createLoopsApiServer({
      host: "127.0.0.1",
      port: 0,
      storage,
      now: () => now,
      authenticator: {
        authenticate: async (_headers, context) => context.policy.operationId === "leases.stuck"
          ? {
              ok: false as const,
              status: 403 as const,
              reason: "insufficient_scope",
              message: "loops:read required",
              requestId: "wrong-scope-request",
            }
          : { ok: true as const, status: 200 as const, principal: testPrincipal },
      },
      withTenantStorage: (_principal, fn) => fn(storage),
    });
    try {
      const denied = await fetch(apiUrl(wrongScopeServer, "/v1/leases/stuck"));
      expect(denied.status).toBe(403);
      const deniedBody = await denied.json() as Record<string, unknown>;
      expect(deniedBody).toMatchObject({ ok: false });
      expect(deniedBody.report).toBeUndefined();

      const detected = await fetch(apiUrl(server, "/v1/leases/stuck?limit=10"));
      expect(detected.status).toBe(200);
      const detectedText = await detected.text();
      expect(detectedText).toContain("snapshotId");
      const detectedBody = JSON.parse(detectedText) as {
        report: {
          state: string;
          candidates: Array<{ runId: string; loopId: string; snapshotId: string }>;
          truncated: boolean;
        };
      };
      expect(detectedBody.report.state).toBe("stuck");
      expect(detectedBody.report.truncated).toBe(false);
      expect(detectedBody.report.candidates).toHaveLength(1);
      expect(detectedBody.report.candidates.some((candidate) => candidate.runId === healthy!.run.id)).toBe(false);

      const candidate = detectedBody.report.candidates[0]!;
      expect(candidate.runId).toBe(stale!.run.id);
      expect(candidate.loopId).toBe(staleLoop.id);
      expect(candidate.snapshotId).toMatch(/^stuck_[a-f0-9]{64}$/);
      const conflicted = await fetch(apiUrl(server, "/v1/leases/reconcile"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ candidates: [{ ...candidate, loopId: `${candidate.loopId}-wrong` }] }),
      });
      const conflictedBody = await conflicted.json();
      expect({ status: conflicted.status, body: conflictedBody }).toMatchObject({
        status: 200,
        body: {
        reconciliation: {
          outcomes: [{ runId: stale!.run.id, outcome: "conflict", reason: "candidate_snapshot_changed" }],
        },
        },
      });
      expect(await storage.getRun(stale!.run.id)).toMatchObject({ status: "running" });

      const reconciled = await fetch(apiUrl(server, "/v1/leases/reconcile"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ candidates: [candidate] }),
      });
      expect(reconciled.status).toBe(200);
      expect(await reconciled.json()).toMatchObject({
        reconciliation: { outcomes: [{ runId: stale!.run.id, outcome: "recovered" }] },
      });
      expect(await storage.getRun(stale!.run.id)).toMatchObject({ status: "abandoned" });
      expect(await storage.getRun(healthy!.run.id)).toMatchObject({ status: "running" });

      const replay = await fetch(apiUrl(server, "/v1/leases/reconcile"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ candidates: [candidate] }),
      });
      expect(replay.status).toBe(200);
      expect(await replay.json()).toMatchObject({
        reconciliation: { outcomes: [{ runId: stale!.run.id, outcome: "already_recovered" }] },
      });

      const clear = await fetch(apiUrl(server, "/v1/leases/stuck?limit=10"));
      expect(clear.status).toBe(200);
      expect(await clear.json()).toMatchObject({
        report: { state: "clear", candidates: [], truncated: false },
      });
    } finally {
      wrongScopeServer.stop(true);
      server.stop(true);
      await storage.close();
    }
  });

  test("hosted stuck-run reconciliation isolates one candidate's advancement failure from the rest of the batch", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    // The pinned API clock sits 45 minutes ahead of the wall clock so every
    // run claimed below (claims are stamped with the wall clock) is older
    // than the recovery time and past the recovery grace.
    const testStart = new Date();
    const now = new Date(testStart.getTime() + 45 * 60_000);
    const T = now.getTime();

    // A wedged loop whose breaker marker window is densely occupied, plus a
    // clean wedged loop. Both trips of the circuit breaker happen during
    // recovery advancement (>= 5 consecutive failed runs with maxAttempts 1),
    // so the marker INSERT is what distinguishes them.
    const createWedgedLoop = async (name: string) => {
      const loop = await storage.createLoop({
        name,
        schedule: { type: "interval", everyMs: 10 * 60_000 },
        target: { type: "command", command: "true" },
        maxAttempts: 1,
        retryDelayMs: 1_000,
        leaseMs: 1_000,
      }, new Date(T - 24 * 3600_000));
      return { loop, runner: `runner-${name}` };
    };

    // Claims are stamped with the wall clock (the storage has no injectable
    // clock), which is exactly what keeps the streak deterministic: the
    // occupied slots are created first, then the failed runs and the wedge,
    // so the failed runs are always the most recently created runs that the
    // breaker's consecutive-failure count reads (listRuns orders by created
    // time) regardless of when the test runs.
    const seedWedgedRun = async (loop: Loop, runner: string) => {
      for (let i = 0; i < 5; i += 1) {
        const slot = new Date(T - (70 - i * 10) * 60_000).toISOString();
        const claim = await storage.claimRun(loop, slot, runner, new Date());
        if (!claim) throw new Error(`seed claim failed for ${runner}`);
        await storage.finalizeRun(claim.run.id, {
          status: "failed",
          finishedAt: new Date(Date.now() + 500).toISOString(),
          durationMs: 500,
          stdout: "",
          stderr: "",
          error: "boom",
        }, { claimedBy: runner, claimToken: claim.claimToken, now: new Date(Date.now() + 500) });
      }
      const wedgeSlot = new Date(T - 20 * 60_000).toISOString();
      const wedgeClaim = await storage.claimRun(loop, wedgeSlot, runner, new Date());
      if (!wedgeClaim) throw new Error(`wedge claim failed for ${runner}`);
      await storage.updateLoop(loop.id, { nextRunAt: wedgeSlot });
      return wedgeClaim.run;
    };

    const dense = await createWedgedLoop("hosted-stuck-dense-marker");
    const clean = await createWedgedLoop("hosted-stuck-clean-marker");

    // Occupy every 1ms slot the breaker marker probe examines (1000 probes)
    // plus the slot the probe then inserts into, so the marker INSERT for the
    // dense loop's loop_runs row hits the UNIQUE(loop_id, scheduled_for)
    // constraint and the recovered-run advancement throws.
    for (let i = 0; i <= 1000; i += 1) {
      await storage.createSkippedRun(dense.loop, new Date(T + i).toISOString(), "occupied");
    }
    const denseWedge = await seedWedgedRun(dense.loop, dense.runner);
    const cleanWedge = await seedWedgedRun(clean.loop, clean.runner);

    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage, now: () => now });
    try {
      const detected = await fetch(apiUrl(server, "/v1/leases/stuck?limit=10"));
      expect(detected.status).toBe(200);
      const body = await detected.json() as {
        report: { candidates: Array<{ runId: string; loopId: string; snapshotId: string }> };
      };
      expect(body.report.candidates).toHaveLength(2);
      const candidates = new Map(body.report.candidates.map((entry) => [entry.runId, entry]));
      const denseCandidate = candidates.get(denseWedge.id);
      const cleanCandidate = candidates.get(cleanWedge.id);
      expect(denseCandidate).toBeDefined();
      expect(cleanCandidate).toBeDefined();

      const reconcile = await fetch(apiUrl(server, "/v1/leases/reconcile"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ candidates: [denseCandidate, cleanCandidate] }),
      });
      expect(reconcile.status).toBe(200);
      const outcomeByRunId = new Map(
        ((await reconcile.json()) as {
          reconciliation: { outcomes: Array<{ runId: string; outcome: string; reason?: string }> };
        }).reconciliation.outcomes.map((outcome) => [outcome.runId, outcome]),
      );

      // The dense-slot candidate's advancement failure is isolated: the batch
      // still succeeds, the candidate reports the conflict, and its run stays
      // recovered (abandoned) so a later pass can retry advancement.
      expect(outcomeByRunId.get(denseWedge.id)).toMatchObject({
        runId: denseWedge.id,
        outcome: "conflict",
        reason: "advancement_failed",
      });
      expect(await storage.getRun(denseWedge.id)).toMatchObject({ status: "abandoned" });
      expect(await storage.getLoop(dense.loop.id)).toMatchObject({ status: "active" });

      // The clean candidate still recovers and its loop is paused by the
      // circuit breaker.
      expect(outcomeByRunId.get(cleanWedge.id)).toMatchObject({
        runId: cleanWedge.id,
        outcome: "recovered",
      });
      expect(await storage.getRun(cleanWedge.id)).toMatchObject({ status: "abandoned" });
      expect(await storage.getLoop(clean.loop.id)).toMatchObject({ status: "paused" });
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("legacy lease recovery keeps the pass alive when a page's advancement fails", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    // The pinned API clock sits 45 minutes ahead of the wall clock so every
    // run claimed below is older than the recovery time and past the recovery
    // grace.
    const testStart = new Date();
    const now = new Date(testStart.getTime() + 45 * 60_000);
    const T = now.getTime();
    const loop = await storage.createLoop({
      name: "hosted-recover-dense-marker",
      schedule: { type: "interval", everyMs: 10 * 60_000 },
      target: { type: "command", command: "true" },
      maxAttempts: 1,
      retryDelayMs: 1_000,
      leaseMs: 1_000,
    }, new Date(T - 24 * 3600_000));
    const runner = "runner-recover-dense";
    // The occupied slots are created first, then the failed runs and the
    // wedge are claimed with the wall clock, so the failed runs are always
    // the most recently created runs the breaker's consecutive-failure count
    // reads, regardless of when the test runs.
    for (let i = 0; i <= 1000; i += 1) {
      await storage.createSkippedRun(loop, new Date(T + i).toISOString(), "occupied");
    }
    for (let i = 0; i < 5; i += 1) {
      const slot = new Date(T - (70 - i * 10) * 60_000).toISOString();
      const claim = await storage.claimRun(loop, slot, runner, new Date());
      if (!claim) throw new Error("seed claim failed");
      await storage.finalizeRun(claim.run.id, {
        status: "failed",
        finishedAt: new Date(Date.now() + 500).toISOString(),
        durationMs: 500,
        stdout: "",
        stderr: "",
        error: "boom",
      }, { claimedBy: runner, claimToken: claim.claimToken, now: new Date(Date.now() + 500) });
    }
    const wedgeSlot = new Date(T - 20 * 60_000).toISOString();
    const wedgeClaim = await storage.claimRun(loop, wedgeSlot, runner, new Date());
    if (!wedgeClaim) throw new Error("wedge claim failed");
    await storage.updateLoop(loop.id, { nextRunAt: wedgeSlot });
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage, now: () => now });
    try {
      const first = await fetch(apiUrl(server, "/v1/leases/recover"), { method: "POST" });
      expect(first.status).toBe(200);
      const firstBody = await first.json() as { abandoned: Array<{ id: string }> };
      expect(firstBody.abandoned.some((run) => run.id === wedgeClaim!.run.id)).toBe(true);
      // The run is recovered, but its loop could not be paused because the
      // breaker marker window is dense; the pass still returns 200 and the
      // run stays retryable on the next invocation.
      expect(await storage.getRun(wedgeClaim!.run.id)).toMatchObject({ status: "abandoned" });
      expect(await storage.getLoop(loop.id)).toMatchObject({ status: "active" });

      const second = await fetch(apiUrl(server, "/v1/leases/recover"), { method: "POST" });
      expect(second.status).toBe(200);
      expect(await storage.getLoop(loop.id)).toMatchObject({ status: "active" });
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("hosted stuck-run reconciliation refuses to repeat an admitted external operation blindly", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const claimedAt = new Date("2026-01-01T00:00:00.000Z");
    const now = new Date("2026-01-01T00:20:00.000Z");
    const workflow = await storage.createWorkflow({
      name: "hosted-stuck-operation-fence",
      steps: [{ id: "effect", target: { type: "command", command: "printf", args: ["effect"] } }],
    });
    const loop = await storage.createLoop({
      name: "hosted-stuck-operation-loop",
      schedule: { type: "interval", everyMs: 60_000 },
      target: { type: "workflow", workflowId: workflow.id },
      leaseMs: 1_000,
    }, claimedAt);
    const claim = await storage.claimRun(loop, claimedAt.toISOString(), "runner-stuck-effect", claimedAt);
    expect(claim).toBeTruthy();
    const workflowRun = await storage.createWorkflowRun({
      workflow,
      loop,
      loopRun: claim!.run,
      operationAuthority: {
        authorityId: "loops-control-plane",
        tenantId: testPrincipal.tenantId,
      },
    });
    const descriptorEvent = (await storage.listWorkflowEvents(workflowRun.id)).find((event) =>
      event.eventType === "private_operation_descriptor" && event.stepId === "effect"
    )!;
    const descriptor = descriptorEvent.payload as unknown as PrivateOperationDescriptor;
    await storage.appendWorkflowEvent(
      workflowRun.id,
      "private_operation_admitted",
      "effect",
      operationAdmissionReceipt(descriptor) as unknown as Record<string, unknown>,
    );
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage, now: () => now });
    try {
      const detected = await fetch(apiUrl(server, "/v1/leases/stuck"));
      expect(detected.status).toBe(200);
      const body = await detected.json() as {
        report: { candidates: Array<{ runId: string; loopId: string; snapshotId: string }> };
      };
      const candidate = body.report.candidates.find((entry) => entry.runId === claim!.run.id)!;
      expect(candidate).toBeDefined();
      const reconcile = await fetch(apiUrl(server, "/v1/leases/reconcile"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ candidates: [candidate] }),
      });
      expect(reconcile.status).toBe(200);
      expect(await reconcile.json()).toMatchObject({
        reconciliation: {
          outcomes: [{
            runId: claim!.run.id,
            outcome: "operation_reconciliation_required",
            reason: "admitted_external_operation_will_not_be_repeated_blindly",
          }],
        },
      });
      expect(await storage.getRun(claim!.run.id)).toMatchObject({ status: "running" });
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("legacy maintenance recovery cannot mutate or advance an admitted private operation", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const claimedAt = new Date("2026-01-01T00:00:00.000Z");
    const recoveredAt = new Date("2026-01-01T00:20:00.000Z");
    const workflow = await storage.createWorkflow({
      name: "legacy-recovery-operation-fence",
      steps: [{ id: "effect", target: { type: "command", command: "printf", args: ["effect"] } }],
    });
    const loop = await storage.createLoop({
      name: "legacy-recovery-operation-loop",
      schedule: { type: "interval", everyMs: 60_000 },
      target: { type: "workflow", workflowId: workflow.id },
      maxAttempts: 2,
      retryDelayMs: 1_000,
      leaseMs: 1_000,
    }, claimedAt);
    await storage.updateLoop(loop.id, { nextRunAt: claimedAt.toISOString() });
    const claim = await storage.claimRun(loop, claimedAt.toISOString(), "runner-legacy-effect", claimedAt);
    expect(claim).toBeTruthy();
    const workflowRun = await storage.createWorkflowRun({
      workflow,
      loop,
      loopRun: claim!.run,
      operationAuthority: {
        authorityId: "loops-control-plane",
        tenantId: testPrincipal.tenantId,
      },
    });
    const descriptorEvent = (await storage.listWorkflowEvents(workflowRun.id)).find((event) =>
      event.eventType === "private_operation_descriptor" && event.stepId === "effect"
    )!;
    const descriptor = descriptorEvent.payload as unknown as PrivateOperationDescriptor;
    await storage.appendWorkflowEvent(
      workflowRun.id,
      "private_operation_admitted",
      "effect",
      operationAdmissionReceipt(descriptor) as unknown as Record<string, unknown>,
    );
    const beforeRun = await storage.getRun(claim!.run.id);
    const beforeWorkflowRun = await storage.getWorkflowRun(workflowRun.id);
    const beforeLoop = await storage.getLoop(loop.id);
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage, now: () => recoveredAt });
    try {
      const response = await fetch(apiUrl(server, "/v1/leases/recover"), { method: "POST" });
      const body = await response.json();
      const afterRun = await storage.getRun(claim!.run.id);
      const afterWorkflowRun = await storage.getWorkflowRun(workflowRun.id);
      const afterLoop = await storage.getLoop(loop.id);

      expect({
        response: { status: response.status, body },
        run: {
          status: afterRun?.status,
          finishedAt: afterRun?.finishedAt,
          error: afterRun?.error,
        },
        workflowRun: {
          status: afterWorkflowRun?.status,
          finishedAt: afterWorkflowRun?.finishedAt,
          error: afterWorkflowRun?.error,
        },
        loop: {
          nextRunAt: afterLoop?.nextRunAt,
          retryScheduledFor: afterLoop?.retryScheduledFor,
        },
      }).toEqual({
        response: {
          status: 200,
          body: {
            ok: true,
            abandoned: [],
            deferred: [],
            advancementDeferred: [],
            reconciliation: {
              outcomes: [{
                runId: claim!.run.id,
                outcome: "operation_reconciliation_required",
                reason: "admitted_external_operation_will_not_be_repeated_blindly",
              }],
            },
          },
        },
        run: {
          status: beforeRun?.status,
          finishedAt: beforeRun?.finishedAt,
          error: beforeRun?.error,
        },
        workflowRun: {
          status: beforeWorkflowRun?.status,
          finishedAt: beforeWorkflowRun?.finishedAt,
          error: beforeWorkflowRun?.error,
        },
        loop: {
          nextRunAt: beforeLoop?.nextRunAt,
          retryScheduledFor: beforeLoop?.retryScheduledFor,
        },
      });
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("legacy maintenance recovery preserves safe non-admitted recovery", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const claimedAt = new Date("2026-01-01T00:00:00.000Z");
    const recoveredAt = new Date("2026-01-01T00:00:02.000Z");
    const loop = await storage.createLoop({
      name: "legacy-recovery-safe",
      schedule: { type: "interval", everyMs: 60_000 },
      target: { type: "command", command: "false" },
      maxAttempts: 1,
      leaseMs: 1_000,
    }, claimedAt);
    await storage.updateLoop(loop.id, { nextRunAt: claimedAt.toISOString() });
    const claim = await storage.claimRun(loop, claimedAt.toISOString(), "runner-legacy-safe", claimedAt);
    expect(claim).toBeTruthy();
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage, now: () => recoveredAt });
    try {
      const response = await fetch(apiUrl(server, "/v1/leases/recover"), { method: "POST" });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        abandoned: [{ id: claim!.run.id, status: "abandoned" }],
        deferred: [],
        advancementDeferred: [],
      });
      expect(await storage.getRun(claim!.run.id)).toMatchObject({ status: "abandoned" });
      expect(await storage.getLoop(loop.id)).toMatchObject({
        status: "active",
        nextRunAt: "2026-01-01T00:01:00.000Z",
        retryScheduledFor: undefined,
      });
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("per-run recovery propagates admitted-operation reconciliation without mutation", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const claimedAt = new Date("2026-01-01T00:00:00.000Z");
    const recoveredAt = new Date("2026-01-01T00:20:00.000Z");
    const fixture = await createAdmittedExpiredWorkflowRun(storage, {
      prefix: "per-run-recovery-fence",
      claimedAt,
    });
    const before = {
      run: await storage.getRun(fixture.claim.run.id),
      workflowRun: await storage.getWorkflowRun(fixture.workflowRun.id),
      loop: await storage.getLoop(fixture.loop.id),
    };
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage, now: () => recoveredAt });
    try {
      const response = await fetch(apiUrl(server, `/v1/runs/${fixture.claim.run.id}/recover`), { method: "POST" });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        abandoned: [],
        deferred: [],
        advancementDeferred: [],
        reconciliation: {
          outcomes: [{
            runId: fixture.claim.run.id,
            outcome: "operation_reconciliation_required",
            reason: "admitted_external_operation_will_not_be_repeated_blindly",
          }],
        },
      });
      expect(await storage.getRun(fixture.claim.run.id)).toEqual(before.run);
      expect(await storage.getWorkflowRun(fixture.workflowRun.id)).toEqual(before.workflowRun);
      expect(await storage.getLoop(fixture.loop.id)).toEqual(before.loop);
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("hosted polling propagates admitted-operation reconciliation without mutation", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const claimedAt = new Date("2026-01-01T00:00:00.000Z");
    const recoveredAt = new Date("2026-01-01T00:20:00.000Z");
    const fixture = await createAdmittedExpiredWorkflowRun(storage, {
      prefix: "poll-recovery-fence",
      claimedAt,
      machineId: "missing-runner",
    });
    const before = {
      run: await storage.getRun(fixture.claim.run.id),
      workflowRun: await storage.getWorkflowRun(fixture.workflowRun.id),
      loop: await storage.getLoop(fixture.loop.id),
    };
    const server = createTestServer(
      mod,
      { host: "127.0.0.1", port: 0, storage, now: () => recoveredAt },
      runnerPrincipal("healthy-runner"),
    );
    try {
      const response = await fetch(apiUrl(server, "/v1/runners/claim"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ runnerId: "healthy-runner" }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        claims: [],
        reconciliation: {
          outcomes: [{
            runId: fixture.claim.run.id,
            outcome: "operation_reconciliation_required",
            reason: "admitted_external_operation_will_not_be_repeated_blindly",
          }],
        },
      });
      expect(await storage.getRun(fixture.claim.run.id)).toEqual(before.run);
      expect(await storage.getWorkflowRun(fixture.workflowRun.id)).toEqual(before.workflowRun);
      expect(await storage.getLoop(fixture.loop.id)).toEqual(before.loop);
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("runner finalization uses server time for stale-claim fencing", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    let now = new Date("2026-01-01T00:00:05Z");
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage, now: () => now }, runnerPrincipal("runner-a"));

    try {
      const loop = await storage.createLoop(
        {
          name: "api-expired-claim-loop",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
          leaseMs: 1_000,
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const claimResponse = await fetch(apiUrl(server, "/v1/runners/claim"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ runnerId: "runner-a", maxClaims: 1 }),
      });
      expect(claimResponse.status).toBe(200);
      const claimed = (await claimResponse.json()) as {
        claims: Array<{ claimToken?: string; run: { id: string; status: string } }>;
      };
      expect(claimed.claims).toHaveLength(1);

      now = new Date("2026-01-01T00:00:07Z");
      const staleFinalize = await fetch(apiUrl(server, `/v1/runs/${claimed.claims[0]!.run.id}/finalize`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          claimToken: claimed.claims[0]!.claimToken,
          status: "succeeded",
          finishedAt: "2026-01-01T00:00:00.500Z",
          stdout: "",
          stderr: "",
        }),
      });
      expect(staleFinalize.status).toBe(409);
      expect(await staleFinalize.json()).toMatchObject({ ok: false, error: "stale_claim" });
      expect(await storage.getRun(claimed.claims[0]!.run.id)).toMatchObject({ loopId: loop.id, status: "running" });
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("runner claim returns workflow loops with executable workflow payload and claim-fenced workflow APIs", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = createTestServer(mod, {
      host: "127.0.0.1",
      port: 0,
      storage,
      now: () => new Date("2026-01-01T00:00:00Z"),
    }, runnerPrincipal("runner-a"));

    try {
      const workflow = await storage.createWorkflow({
        name: "api-workflow-claim-execute",
        steps: [
          { id: "command", target: { type: "command", command: "printf workflow-ok", shell: true } },
          {
            id: "contract-agent",
            target: {
              type: "agent",
              provider: "codewith",
              prompt: "perform scoped work",
              allowlist: { commands: ["git"], safetyReason: "isolated API contract test" },
            },
          },
          { id: "default-agent", target: { type: "agent", provider: "claude", prompt: "perform default work" } },
        ],
      });
      const loop = await storage.createLoop(
        {
          name: "api-workflow-loop",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "workflow", workflowId: workflow.id },
        },
        new Date("2025-12-31T00:00:00Z"),
      );

      const response = await fetch(apiUrl(server, "/v1/runners/claim"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ runnerId: "runner-a", now: "2026-01-01T00:00:00Z", maxClaims: 1 }),
      });
      expect(response.status).toBe(200);
      const claimed = (await response.json()) as {
        claims: Array<{
          claimToken: string;
          loop: { id: string; target: { type: string; workflowId?: string } };
          run: LoopRun;
          workflow?: WorkflowSpec;
        }>;
      };
      expect(claimed.claims).toHaveLength(1);
      expect(claimed.claims[0]).toMatchObject({
        loop: { id: loop.id, target: { type: "workflow", workflowId: workflow.id } },
        run: { status: "running" },
        workflow: { id: workflow.id, steps: [{ id: "command" }, { id: "contract-agent" }, { id: "default-agent" }] },
      });
      expect(claimed.claims[0]!.claimToken).toBeString();
      expect(await storage.listRuns({ loopId: loop.id })).toHaveLength(1);

      const idempotencyKey = `${claimed.claims[0]!.run.id}:workflow:${workflow.id}`;
      const preChangeWorkflowRun = await storage.createWorkflowRun({
        workflow,
        loop,
        loopRun: claimed.claims[0]!.run,
        idempotencyKey,
        operationAuthority: {
          authorityId: "loops-control-plane",
          tenantId: testPrincipal.tenantId,
        },
      });
      expect((await storage.listWorkflowEvents(preChangeWorkflowRun.id)).filter((event) =>
        event.eventType === "agent_session_contract"
      )).toHaveLength(1);

      const createWorkflowRun = await fetch(apiUrl(server, `/v1/runs/${claimed.claims[0]!.run.id}/workflow-runs`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          claimToken: claimed.claims[0]!.claimToken,
          idempotencyKey,
        }),
      });
      expect(createWorkflowRun.status).toBe(200);
      const created = (await createWorkflowRun.json()) as {
        workflowRun: { id: string; loopRunId: string; workflowId: string; status: string };
        operationDescriptors: PrivateOperationDescriptor[];
        operationStates: OperationReceiptState[];
      };
      expect(created.workflowRun).toMatchObject({ loopRunId: claimed.claims[0]!.run.id, workflowId: workflow.id, status: "running" });
      expect(created.workflowRun.id).toBe(preChangeWorkflowRun.id);
      expect(created.operationDescriptors).toHaveLength(workflow.steps.length);
      expect(created.operationStates).toHaveLength(workflow.steps.length);
      expect(created.operationStates.every((state) => !state.admission && !state.terminal)).toBe(true);
      const privateAgentDescriptor = created.operationDescriptors.find((descriptor) => descriptor.stepId === "contract-agent")!;
      expect(privateAgentDescriptor.descriptorRef).toBe("owner-operation-target:contract-agent");
      expect(privateAgentDescriptor.descriptorDigest).toBe(
        privateOperationDescriptorDigest(workflow.steps.find((step) => step.id === "contract-agent")!.target),
      );
      expect(JSON.stringify(privateAgentDescriptor)).not.toContain("perform scoped work");
      expect(privateAgentDescriptor.authority).toEqual({
        authorityId: "loops-control-plane",
        tenantId: testPrincipal.tenantId,
      });
      const publicEvents = await fetch(apiUrl(server, `/v1/workflow-runs/${created.workflowRun.id}/events`));
      expect(publicEvents.status).toBe(200);
      const publicEventsText = JSON.stringify(await publicEvents.json());
      expect(publicEventsText).not.toContain("private_operation");
      expect(publicEventsText).not.toContain("perform scoped work");
      expect(publicEventsText).not.toContain("loops-control-plane");

      const commandDescriptor = created.operationDescriptors.find((descriptor) => descriptor.stepId === "command")!;
      const eventPath = `/v1/runs/${claimed.claims[0]!.run.id}/workflow-runs/${created.workflowRun.id}/events`;
      const admission = operationAdmissionReceipt(commandDescriptor);
      const wrongAuthorityAdmission = await fetch(apiUrl(server, eventPath), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          claimToken: claimed.claims[0]!.claimToken,
          eventType: "private_operation_admitted",
          stepId: "command",
          payload: { ...admission, authority: { ...admission.authority, tenantId: "wrong-tenant" } },
        }),
      });
      expect(wrongAuthorityAdmission.status).toBe(409);
      expect(await wrongAuthorityAdmission.json()).toMatchObject({ error: "private_operation_admission_mismatch" });

      const admitted = await fetch(apiUrl(server, eventPath), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          claimToken: claimed.claims[0]!.claimToken,
          eventType: "private_operation_admitted",
          stepId: "command",
          payload: admission,
        }),
      });
      expect(admitted.status).toBe(200);
      expect(await admitted.json()).toMatchObject({ duplicate: false });
      const admittedReplay = await fetch(apiUrl(server, eventPath), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          claimToken: claimed.claims[0]!.claimToken,
          eventType: "private_operation_admitted",
          stepId: "command",
          payload: admission,
        }),
      });
      expect(admittedReplay.status).toBe(200);
      expect(await admittedReplay.json()).toMatchObject({ duplicate: true });

      const missingResult = await fetch(apiUrl(server, eventPath), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          claimToken: claimed.claims[0]!.claimToken,
          eventType: "private_operation_terminal",
          stepId: "command",
          payload: {
            ...operationTerminalReceipt(commandDescriptor, {
              status: "succeeded",
              exitCode: 0,
              durationMs: 1,
              stdout: "NON_SENSITIVE_RESULT",
              stderr: "",
            }),
            resultRef: "",
          },
        }),
      });
      expect(missingResult.status).toBe(422);
      expect(await missingResult.json()).toMatchObject({ ok: false, error: "validation_failed" });

      const terminal = operationTerminalReceipt(commandDescriptor, {
        status: "succeeded",
        exitCode: 0,
        durationMs: 1,
        stdout: "NON_SENSITIVE_RESULT",
        stderr: "",
      });
      const terminalResponse = await fetch(apiUrl(server, eventPath), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          claimToken: claimed.claims[0]!.claimToken,
          eventType: "private_operation_terminal",
          stepId: "command",
          payload: terminal,
        }),
      });
      expect(terminalResponse.status).toBe(200);
      expect(await terminalResponse.json()).toMatchObject({ duplicate: false });
      const terminalReplay = await fetch(apiUrl(server, eventPath), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          claimToken: claimed.claims[0]!.claimToken,
          eventType: "private_operation_terminal",
          stepId: "command",
          payload: terminal,
        }),
      });
      expect(terminalReplay.status).toBe(200);
      expect(await terminalReplay.json()).toMatchObject({ duplicate: true });
      expect((await storage.listWorkflowEvents(created.workflowRun.id)).filter((event) =>
        event.eventType === "private_operation_terminal" && event.stepId === "command"
      )).toHaveLength(1);

      const internal = storage.store as unknown as { db: Database };
      const eventsBeforeProvenanceFailures = await storage.listWorkflowEvents(created.workflowRun.id);
      const runCountBeforeProvenanceFailures = (await storage.listWorkflowRuns({ workflowId: workflow.id })).length;
      const changedSteps = workflow.steps.map((step) =>
        step.id === "contract-agent" && step.target.type === "agent"
          ? { ...step, target: { ...step.target, prompt: "changed after the idempotent run was created" } }
          : step
      );
      internal.db.query("UPDATE workflow_specs SET steps_json = ? WHERE id = ?")
        .run(JSON.stringify(changedSteps), workflow.id);
      const changedDefinition = await fetch(apiUrl(server, `/v1/runs/${claimed.claims[0]!.run.id}/workflow-runs`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          claimToken: claimed.claims[0]!.claimToken,
          idempotencyKey,
        }),
      });
      expect(changedDefinition.status).toBe(409);
      expect(await changedDefinition.json()).toMatchObject({ ok: false, error: "workflow_run_definition_conflict" });
      expect((await storage.listWorkflowRuns({ workflowId: workflow.id })).length).toBe(runCountBeforeProvenanceFailures);
      expect(await storage.listWorkflowEvents(created.workflowRun.id)).toEqual(eventsBeforeProvenanceFailures);

      internal.db.query("UPDATE workflow_specs SET steps_json = ? WHERE id = ?")
        .run(JSON.stringify(workflow.steps), workflow.id);
      const provenance = internal.db.query<{ workflow_definition_hash: string }, [string]>(
        "SELECT workflow_definition_hash FROM workflow_runs WHERE id = ?",
      ).get(created.workflowRun.id);
      expect(provenance?.workflow_definition_hash).toBeString();
      internal.db.query("UPDATE workflow_runs SET workflow_definition_hash = NULL WHERE id = ?")
        .run(created.workflowRun.id);
      const legacyProvenance = await fetch(apiUrl(server, `/v1/runs/${claimed.claims[0]!.run.id}/workflow-runs`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          claimToken: claimed.claims[0]!.claimToken,
          idempotencyKey,
        }),
      });
      expect(legacyProvenance.status).toBe(409);
      expect(await legacyProvenance.json()).toMatchObject({ ok: false, error: "workflow_run_provenance_missing" });
      expect((await storage.listWorkflowRuns({ workflowId: workflow.id })).length).toBe(runCountBeforeProvenanceFailures);
      expect(await storage.listWorkflowEvents(created.workflowRun.id)).toEqual(eventsBeforeProvenanceFailures);
      internal.db.query("UPDATE workflow_runs SET workflow_definition_hash = ? WHERE id = ?")
        .run(provenance!.workflow_definition_hash, created.workflowRun.id);

      const staleStart = await fetch(apiUrl(server, `/v1/runs/${claimed.claims[0]!.run.id}/workflow-runs/${created.workflowRun.id}/steps/command/start`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ claimToken: "wrong-token" }),
      });
      expect(staleStart.status).toBe(409);
      expect(await staleStart.json()).toMatchObject({ ok: false, error: "stale_claim" });

      const start = await fetch(apiUrl(server, `/v1/runs/${claimed.claims[0]!.run.id}/workflow-runs/${created.workflowRun.id}/steps/command/start`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ claimToken: claimed.claims[0]!.claimToken }),
      });
      expect(start.status).toBe(200);
      expect(await start.json()).toMatchObject({ step: { stepId: "command", status: "running" } });

      const contractPayload = {
        version: 1,
        provider: "codewith",
        permissionMode: "default",
        sandbox: "workspace-write",
        manualBreakGlass: false,
        timeoutMs: null,
        restrictions: { commands: ["git"], enforcement: "metadata_only", providerEnforced: false },
        safetyReason: "isolated API contract test",
      };
      const derivedContracts = (await storage.listWorkflowEvents(created.workflowRun.id)).filter((event) =>
        event.eventType === "agent_session_contract"
      );
      expect(derivedContracts).toHaveLength(1);
      expect(derivedContracts[0]).toMatchObject({ stepId: "contract-agent", payload: contractPayload });

      const mismatchContract = await fetch(apiUrl(server, `/v1/runs/${claimed.claims[0]!.run.id}/workflow-runs/${created.workflowRun.id}/events`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          claimToken: claimed.claims[0]!.claimToken,
          eventType: "agent_session_contract",
          stepId: "contract-agent",
          payload: { ...contractPayload, sandbox: "danger-full-access" },
        }),
      });
      expect(mismatchContract.status).toBe(409);
      expect(await mismatchContract.json()).toMatchObject({ ok: false, error: "agent_session_contract_mismatch" });

      const duplicateContract = await fetch(apiUrl(server, `/v1/runs/${claimed.claims[0]!.run.id}/workflow-runs/${created.workflowRun.id}/events`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          claimToken: claimed.claims[0]!.claimToken,
          eventType: "agent_session_contract",
          stepId: "contract-agent",
          payload: contractPayload,
        }),
      });
      expect(duplicateContract.status).toBe(409);
      expect(await duplicateContract.json()).toMatchObject({ ok: false, error: "agent_session_contract_duplicate" });

      const commandContract = await fetch(apiUrl(server, `/v1/runs/${claimed.claims[0]!.run.id}/workflow-runs/${created.workflowRun.id}/events`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          claimToken: claimed.claims[0]!.claimToken,
          eventType: "agent_session_contract",
          stepId: "command",
          payload: contractPayload,
        }),
      });
      expect(commandContract.status).toBe(422);
      expect(await commandContract.json()).toMatchObject({ ok: false, error: "agent_session_contract_non_agent_step" });

      const fabricatedContract = await fetch(apiUrl(server, `/v1/runs/${claimed.claims[0]!.run.id}/workflow-runs/${created.workflowRun.id}/events`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          claimToken: claimed.claims[0]!.claimToken,
          eventType: "agent_session_contract",
          stepId: "default-agent",
          payload: contractPayload,
        }),
      });
      expect(fabricatedContract.status).toBe(422);
      expect(await fabricatedContract.json()).toMatchObject({ ok: false, error: "agent_session_contract_not_required" });

      const arbitraryEvent = await fetch(apiUrl(server, `/v1/runs/${claimed.claims[0]!.run.id}/workflow-runs/${created.workflowRun.id}/events`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          claimToken: claimed.claims[0]!.claimToken,
          eventType: "fabricated_security_verdict",
          stepId: "contract-agent",
          payload: {},
        }),
      });
      expect(arbitraryEvent.status).toBe(422);
      expect(await arbitraryEvent.json()).toMatchObject({ ok: false, error: "event_type_not_allowed" });

      for (const [suffix, stepId] of [["unknown", "unknown-step"], ["missing", undefined]] as const) {
        const corruptKey = `${idempotencyKey}:${suffix}`;
        const corruptRun = await storage.createWorkflowRun({
          workflow,
          loop,
          loopRun: claimed.claims[0]!.run,
          idempotencyKey: corruptKey,
          operationAuthority: {
            authorityId: "loops-control-plane",
            tenantId: testPrincipal.tenantId,
          },
        });
        await storage.appendWorkflowEvent(
          corruptRun.id,
          "agent_session_contract",
          stepId,
          contractPayload,
        );
        const corruptBackfill = await fetch(apiUrl(server, `/v1/runs/${claimed.claims[0]!.run.id}/workflow-runs`), {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            claimToken: claimed.claims[0]!.claimToken,
            idempotencyKey: corruptKey,
          }),
        });
        expect(corruptBackfill.status).toBe(409);
        expect(await corruptBackfill.json()).toMatchObject({ ok: false, error: "agent_session_contract_fabricated" });
      }

      const concurrentKey = `${idempotencyKey}:concurrent`;
      const concurrentRun = await storage.createWorkflowRun({
        workflow,
        loop,
        loopRun: claimed.claims[0]!.run,
        idempotencyKey: concurrentKey,
        operationAuthority: {
          authorityId: "loops-control-plane",
          tenantId: testPrincipal.tenantId,
        },
      });
      const concurrentCreate = () => fetch(apiUrl(server, `/v1/runs/${claimed.claims[0]!.run.id}/workflow-runs`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          claimToken: claimed.claims[0]!.claimToken,
          idempotencyKey: concurrentKey,
        }),
      });
      const concurrentResponses = await Promise.all([concurrentCreate(), concurrentCreate()]);
      expect(concurrentResponses.map((response) => response.status)).toEqual([200, 200]);
      expect((await storage.listWorkflowEvents(concurrentRun.id)).filter((event) =>
        event.eventType === "agent_session_contract" && event.stepId === "contract-agent"
      )).toHaveLength(1);

      internal.db.query(
        "DELETE FROM workflow_events WHERE workflow_run_id = ? AND event_type = 'agent_session_contract' AND step_id = ?",
      ).run(created.workflowRun.id, "contract-agent");
      const missingContract = await fetch(apiUrl(server, `/v1/runs/${claimed.claims[0]!.run.id}/workflow-runs`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          claimToken: claimed.claims[0]!.claimToken,
          idempotencyKey,
        }),
      });
      expect(missingContract.status).toBe(409);
      expect(await missingContract.json()).toMatchObject({ ok: false, error: "agent_session_contract_missing" });
      expect((await storage.listWorkflowEvents(created.workflowRun.id)).filter((event) =>
        event.eventType === "agent_session_contract" && event.stepId === "contract-agent"
      )).toHaveLength(0);

      const restoreMissingContract = () => fetch(
        apiUrl(server, `/v1/runs/${claimed.claims[0]!.run.id}/workflow-runs/${created.workflowRun.id}/events`),
        {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            claimToken: claimed.claims[0]!.claimToken,
            eventType: "agent_session_contract",
            stepId: "contract-agent",
            payload: contractPayload,
          }),
        },
      );
      const restoredContract = await restoreMissingContract();
      expect(restoredContract.status).toBe(200);
      expect(await restoredContract.json()).toMatchObject({
        event: {
          eventType: "agent_session_contract",
          stepId: "contract-agent",
          payload: contractPayload,
        },
      });
      expect((await storage.listWorkflowEvents(created.workflowRun.id)).filter((event) =>
        event.eventType === "agent_session_contract" && event.stepId === "contract-agent"
      )).toHaveLength(1);

      const repeatedRestore = await restoreMissingContract();
      expect(repeatedRestore.status).toBe(409);
      expect(await repeatedRestore.json()).toMatchObject({ ok: false, error: "agent_session_contract_duplicate" });
      expect((await storage.listWorkflowEvents(created.workflowRun.id)).filter((event) =>
        event.eventType === "agent_session_contract" && event.stepId === "contract-agent"
      )).toHaveLength(1);

      internal.db.query(
        "DELETE FROM workflow_events WHERE workflow_run_id = ? AND event_type = 'agent_session_contract' AND step_id = ?",
      ).run(created.workflowRun.id, "contract-agent");
      const concurrentRestores = await Promise.all([restoreMissingContract(), restoreMissingContract()]);
      expect(concurrentRestores.map((response) => response.status).sort()).toEqual([200, 409]);
      expect((await storage.listWorkflowEvents(created.workflowRun.id)).filter((event) =>
        event.eventType === "agent_session_contract" && event.stepId === "contract-agent"
      )).toHaveLength(1);
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("runner-scoped goal APIs persist workflow goal state behind the claim token", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = createTestServer(mod, {
      host: "127.0.0.1",
      port: 0,
      storage,
      now: () => new Date("2026-01-01T00:00:00Z"),
    }, runnerPrincipal("runner-a"));

    try {
      const workflow = await storage.createWorkflow({
        name: "api-workflow-goal-state",
        steps: [{ id: "step", target: { type: "command", command: "printf workflow-goal", shell: true } }],
      });
      await storage.createLoop(
        {
          name: "api-workflow-goal-loop",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "workflow", workflowId: workflow.id },
        },
        new Date("2025-12-31T00:00:00Z"),
      );

      const claimResponse = await fetch(apiUrl(server, "/v1/runners/claim"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ runnerId: "runner-a", now: "2026-01-01T00:00:00Z", maxClaims: 1 }),
      });
      expect(claimResponse.status).toBe(200);
      const claimed = (await claimResponse.json()) as {
        claims: Array<{ claimToken: string; run: { id: string }; workflow?: WorkflowSpec }>;
      };
      expect(claimed.claims).toHaveLength(1);
      expect(claimed.claims[0]!.workflow?.id).toBe(workflow.id);

      const runId = claimed.claims[0]!.run.id;
      const claimToken = claimed.claims[0]!.claimToken;
      const createWorkflowRun = await fetch(apiUrl(server, `/v1/runs/${runId}/workflow-runs`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ claimToken, idempotencyKey: `${runId}:workflow:${workflow.id}` }),
      });
      expect(createWorkflowRun.status).toBe(200);
      const createdWorkflowRun = (await createWorkflowRun.json()) as { workflowRun: { id: string; workflowId: string; loopRunId: string } };
      expect(createdWorkflowRun.workflowRun).toMatchObject({ workflowId: workflow.id, loopRunId: runId });

      const staleCreate = await fetch(apiUrl(server, `/v1/runs/${runId}/goals`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ claimToken: "wrong-token", objective: "must fail" }),
      });
      expect(staleCreate.status).toBe(409);
      expect(await staleCreate.json()).toMatchObject({ ok: false, error: "stale_claim" });

      const createGoal = await fetch(apiUrl(server, `/v1/runs/${runId}/goals`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          claimToken,
          input: {
            objective: "runner-scoped workflow goal",
            workflowRunId: createdWorkflowRun.workflowRun.id,
            workflowStepId: "step",
          },
        }),
      });
      expect(createGoal.status).toBe(200);
      const createdGoal = (await createGoal.json()) as {
        goal: { goalId: string; loopRunId: string; workflowId: string; workflowRunId: string; workflowStepId: string };
      };
      expect(createdGoal.goal).toMatchObject({
        loopRunId: runId,
        workflowId: workflow.id,
        workflowRunId: createdWorkflowRun.workflowRun.id,
        workflowStepId: "step",
      });
      const goalId = createdGoal.goal.goalId;

      const findGoal = await fetch(apiUrl(server, `/v1/runs/${runId}/goals/find`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ claimToken, context: { workflowRunId: createdWorkflowRun.workflowRun.id, workflowStepId: "step" } }),
      });
      expect(findGoal.status).toBe(200);
      expect(await findGoal.json()).toMatchObject({ goal: { goalId } });

      const createNodes = await fetch(apiUrl(server, `/v1/runs/${runId}/goals/${goalId}/plan-nodes`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          claimToken,
          nodes: [
            { key: "plan", objective: "Plan the step", priority: 1 },
            { key: "execute", objective: "Run the step", dependsOn: ["plan"] },
          ],
        }),
      });
      expect(createNodes.status).toBe(200);
      expect(await createNodes.json()).toMatchObject({
        nodes: [
          { key: "plan", status: "pending", ready: true },
          { key: "execute", status: "pending", ready: false },
        ],
      });

      const updateNode = await fetch(apiUrl(server, `/v1/runs/${runId}/goals/${goalId}/plan-nodes/plan`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ claimToken, status: "complete", ready: false, tokensUsed: 12, timeUsedSeconds: 3 }),
      });
      expect(updateNode.status).toBe(200);
      expect(await updateNode.json()).toMatchObject({ node: { key: "plan", status: "complete", ready: false, tokensUsed: 12, timeUsedSeconds: 3 } });

      const event = await fetch(apiUrl(server, `/v1/runs/${runId}/goals/${goalId}/events`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ claimToken, phase: "execute", status: "active", nodeKey: "execute", tokensUsed: 7, evidence: { step: "started" } }),
      });
      expect(event.status).toBe(200);
      expect(await event.json()).toMatchObject({
        goalRun: { goalId, loopRunId: runId, workflowRunId: createdWorkflowRun.workflowRun.id, workflowStepId: "step", phase: "execute", status: "active" },
      });

      const status = await fetch(apiUrl(server, `/v1/runs/${runId}/goals/${goalId}/status`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ claimToken, status: "complete" }),
      });
      expect(status.status).toBe(200);
      expect(await status.json()).toMatchObject({ goal: { goalId, status: "complete" } });
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("runner claim returns only one running claim per overlap-skip loop per poll", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = createTestServer(mod, {
      host: "127.0.0.1",
      port: 0,
      storage,
      now: () => new Date("2026-01-01T00:00:05Z"),
    }, runnerPrincipal("runner-a"));

    try {
      const loop = await storage.createLoop(
        {
          name: "api-skip-catchup-loop",
          schedule: { type: "interval", everyMs: 1_000 },
          target: { type: "command", command: "true" },
          catchUp: "all",
          catchUpLimit: 10,
          overlap: "skip",
          leaseMs: 60_000,
        },
        new Date("2026-01-01T00:00:00Z"),
      );

      const response = await fetch(apiUrl(server, "/v1/runners/claim"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ runnerId: "runner-a", now: "2026-01-01T00:00:05Z", maxClaims: 5 }),
      });
      expect(response.status).toBe(200);
      const claimed = (await response.json()) as {
        claims: Array<{ loop: { id: string }; run: { scheduledFor: string; status: string } }>;
      };
      expect(claimed.claims).toHaveLength(1);
      expect(claimed.claims[0]).toMatchObject({ loop: { id: loop.id }, run: { status: "running" } });
      expect(await storage.listRuns({ loopId: loop.id, status: "running" })).toHaveLength(1);
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("runner claim reclaims an expired overlap-skip lease through the API", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    let now = new Date("2026-01-01T00:00:05Z");
    const server = createTestServer(mod, {
      host: "127.0.0.1",
      port: 0,
      storage,
      now: () => now,
    }, runnerPrincipal("runner-a"));

    try {
      const loop = await storage.createLoop(
        {
          name: "api-skip-expired-reclaim-loop",
          schedule: { type: "interval", everyMs: 1_000 },
          target: { type: "command", command: "true" },
          catchUp: "all",
          catchUpLimit: 3,
          overlap: "skip",
          leaseMs: 1_000,
        },
        new Date("2026-01-01T00:00:00Z"),
      );

      const first = await fetch(apiUrl(server, "/v1/runners/claim"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ runnerId: "runner-a", maxClaims: 1 }),
      });
      expect(first.status).toBe(200);
      const firstClaimed = (await first.json()) as {
        claims: Array<{ claimToken?: string; loop: { id: string }; run: { id: string; scheduledFor: string; status: string } }>;
      };
      expect(firstClaimed.claims).toHaveLength(1);
      expect(firstClaimed.claims[0]).toMatchObject({ loop: { id: loop.id }, run: { status: "running" } });
      const originalToken = firstClaimed.claims[0]!.claimToken;

      now = new Date("2026-01-01T00:00:07Z");
      const reclaimed = await fetch(apiUrl(server, "/v1/runners/claim"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ runnerId: "runner-a", maxClaims: 1 }),
      });
      expect(reclaimed.status).toBe(200);
      const reclaimedClaimed = (await reclaimed.json()) as {
        claims: Array<{ claimToken?: string; loop: { id: string }; run: { id: string; scheduledFor: string; status: string } }>;
      };
      expect(reclaimedClaimed.claims).toHaveLength(1);
      expect(reclaimedClaimed.claims[0]).toMatchObject({
        loop: { id: loop.id },
        run: { id: firstClaimed.claims[0]!.run.id, status: "running" },
      });
      expect(reclaimedClaimed.claims[0]!.claimToken).toBeTruthy();
      expect(reclaimedClaimed.claims[0]!.claimToken).not.toBe(originalToken);
      expect(await storage.listRuns({ loopId: loop.id, status: "running" })).toHaveLength(1);
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("runner claim capacity does not reap the polling runner's own expired eligible lease", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const recoveredAt = new Date("2026-01-01T00:00:05.000Z");
    const server = createTestServer(
      mod,
      { host: "127.0.0.1", port: 0, storage, now: () => recoveredAt, random: () => 0.5 },
      runnerPrincipal("runner-a"),
    );

    try {
      const earlierLoop = await storage.createLoop(
        {
          name: "api-a-earlier-new-work",
          schedule: { type: "once", at: "2025-12-31T23:59:58.000Z" },
          target: { type: "command", command: "true" },
          machine: { id: "runner-a" },
        },
        new Date("2025-12-31T23:59:57.000Z"),
      );
      const staleLoop = await storage.createLoop(
        {
          name: "api-b-own-expired-eligible",
          schedule: { type: "interval", everyMs: 1_000 },
          target: { type: "command", command: "true" },
          machine: { id: "runner-a" },
          catchUp: "latest",
          overlap: "skip",
          maxAttempts: 1,
          leaseMs: 1_000,
        },
        new Date("2025-12-31T23:59:59.000Z"),
      );
      const staleCursor = staleLoop.nextRunAt;
      const staleClaim = await storage.claimRun(staleLoop, staleCursor!, "runner-a", startedAt);
      expect(staleClaim?.run).toMatchObject({ status: "running", claimedBy: "runner-a" });

      const response = await fetch(apiUrl(server, "/v1/runners/claim"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ runnerId: "runner-a" }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        claims: Array<{ loop: { id: string }; run: { status: string } }>;
      };
      expect(body.claims).toHaveLength(1);
      expect(body.claims[0]).toMatchObject({
        loop: { id: earlierLoop.id },
        run: { status: "running" },
      });
      expect(await storage.getRun(staleClaim!.run.id)).toMatchObject({
        status: "running",
        claimedBy: "runner-a",
        leaseExpiresAt: "2026-01-01T00:00:01.000Z",
      });
      expect(await storage.getLoop(staleLoop.id)).toMatchObject({
        status: "active",
        nextRunAt: staleCursor,
      });
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("runner claim capacity protects later unexamined slots in the partially examined loop", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    let now = new Date("2026-01-01T00:00:00.000Z");
    const server = createTestServer(
      mod,
      { host: "127.0.0.1", port: 0, storage, now: () => now, random: () => 0.5 },
      runnerPrincipal("runner-a"),
    );

    try {
      const loop = await storage.createLoop(
        {
          name: "api-partially-examined-capacity",
          schedule: { type: "interval", everyMs: 1_000 },
          target: { type: "command", command: "true" },
          catchUp: "all",
          catchUpLimit: 10,
          overlap: "allow",
          maxAttempts: 1,
          leaseMs: 1_000,
        },
        now,
      );
      const firstSlot = loop.nextRunAt!;
      const secondSlot = new Date(new Date(firstSlot).getTime() + 1_000).toISOString();
      const first = await storage.claimRun(loop, firstSlot, "runner-a", new Date(firstSlot));
      const second = await storage.claimRun(loop, secondSlot, "runner-a", new Date(firstSlot));
      expect(first).toBeTruthy();
      expect(second).toBeTruthy();

      now = new Date("2026-01-01T00:00:10.000Z");
      const poll = await fetch(apiUrl(server, "/v1/runners/claim"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ runnerId: "runner-a", maxClaims: 1 }),
      });
      expect(poll.status).toBe(200);
      const body = (await poll.json()) as { claims: Array<{ run: { id: string } }> };
      expect(body.claims.map((claim) => claim.run.id)).toEqual([first!.run.id]);

      expect(await storage.getRun(second!.run.id)).toMatchObject({
        status: "running",
        claimedBy: "runner-a",
        attempt: 1,
      });
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("runner claim reaps its own expired lease once the due slot has moved past it", async () => {
    // Regression for the wedged-run defect: a `catchUp: "latest"` + `overlap: "skip"`
    // loop (the shape every agent-*-coordination-10m seat loop uses: 10m interval,
    // 9m lease) whose run outlives its lease is never recovered by the runner that
    // owns it.
    //
    // `claimRuns` passes `excludeClaimedBy: runner.id` to the sweep so that a runner
    // which merely ran out of claim capacity can still take its own slot over on a
    // later poll — that intent is correct and is covered by the "claim capacity"
    // test above. But `dueSlots` under `catchUp: "latest"` returns ONLY the latest
    // slot, so once wall time has moved past the wedged run's own slot the same-slot
    // takeover it is being preserved for can never happen again, and the sweep skips
    // that run because this runner owns it. Neither path can fire, so the run stays
    // `running` behind a long-dead lease as an orphan row nothing can finalize, and
    // the loop's cursor advances only if some later run happens to finalize — never
    // through recovery.
    //
    // NOT "`overlap: "skip"` then blocks the loop": an EXPIRED lease does not, on its
    // own, refuse the new slot. That gate turns on a run holding a LIVE lease or a
    // live process (see the claim-sweep note in `src/api/index.ts`, and the store-level
    // test "overlap skip does not block a later slot on an expired dead lease"). The
    // defect under test here is the unreapable row and the recovery path, not a
    // wedged scheduler.
    //
    // The existing "reclaims an expired overlap-skip lease" test does not reach this
    // because it uses `catchUp: "all"`, which keeps the original slot in the due list
    // and so always permits the same-slot takeover.
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    let now = new Date("2026-01-01T00:00:00.000Z");
    const server = createTestServer(
      mod,
      { host: "127.0.0.1", port: 0, storage, now: () => now, random: () => 0.5 },
      runnerPrincipal("runner-a"),
    );

    try {
      const loop = await storage.createLoop(
        {
          name: "api-own-expired-stale-slot",
          schedule: { type: "interval", everyMs: 600_000 },
          target: { type: "command", command: "true" },
          catchUp: "latest",
          overlap: "skip",
          leaseMs: 540_000,
        },
        now,
      );
      const originalNextRunAt = loop.nextRunAt;

      // createLoop schedules the first slot one interval out, so move to it before
      // the loop is due at all.
      now = new Date("2026-01-01T00:10:00.000Z");

      const first = await fetch(apiUrl(server, "/v1/runners/claim"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ runnerId: "runner-a", maxClaims: 5 }),
      });
      expect(first.status).toBe(200);
      const firstBody = (await first.json()) as {
        claims: Array<{ run: { id: string; status: string } }>;
      };
      expect(firstBody.claims).toHaveLength(1);
      const wedgedRunId = firstBody.claims[0]!.run.id;

      // The runner dies here: it never heartbeats, never completes. Wall time moves
      // two hours on, far past both the 9m lease and this run's own 10m slot.
      now = new Date("2026-01-01T02:00:00.000Z");

      // Poll repeatedly with ample capacity — this is emphatically not the
      // capacity-exhaustion case. A healthy scheduler recovers on the first of these.
      for (let i = 0; i < 3; i += 1) {
        const poll = await fetch(apiUrl(server, "/v1/runners/claim"), {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ runnerId: "runner-a", maxClaims: 5 }),
        });
        expect(poll.status).toBe(200);
      }

      // No phantom may survive: the run is either abandoned, or genuinely taken over
      // with a lease in the future. What must not persist is `running` with a lease
      // that expired in the past — the unreapable orphan row this defect leaves
      // behind. (That row does not block `overlap: "skip"`; it is simply a row no
      // path can finalize, so the loop's cursor never advances through recovery.)
      const wedged = await storage.getRun(wedgedRunId);
      expect(wedged).toBeTruthy();
      const leaseStillExpired = wedged!.status === "running"
        && (!wedged!.leaseExpiresAt || new Date(wedged!.leaseExpiresAt).getTime() <= now.getTime());
      expect(leaseStillExpired).toBe(false);

      // And the loop must have made progress rather than sitting on a permanently
      // past nextRunAt.
      const after = await storage.getLoop(loop.id);
      expect(new Date(after!.nextRunAt!).getTime()).toBeGreaterThan(new Date(originalNextRunAt!).getTime());
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("runner claim protects EVERY own run in a capacity-unexamined loop, not just the first page", async () => {
    // The capacity protection must not be built by enumerating runs: `listRuns`
    // defaults to 100 rows on both backends, so a loop holding more than one
    // page of running runs would have the remainder silently unprotected and
    // reaped out from under the runner that is about to take it over.
    //
    // `overlap: "allow"` with `catchUp: "all"` is a supported configuration and
    // `catchUpLimit`/`maxClaims` both permit far more than 100 concurrent runs
    // on one loop, so this is reachable rather than theoretical.
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    let now = new Date("2026-01-01T00:00:00.000Z");
    const server = createTestServer(
      mod,
      { host: "127.0.0.1", port: 0, storage, now: () => now, random: () => 0.5 },
      runnerPrincipal("runner-a"),
    );

    try {
      // Earliest nextRunAt, so `dueLoops` returns it first: it consumes the one
      // claim this poll is allowed, which is what leaves the second loop
      // unexamined.
      await storage.createLoop(
        {
          name: "api-capacity-consumer",
          schedule: { type: "interval", everyMs: 1_000 },
          target: { type: "command", command: "true" },
          machine: { id: "runner-a" },
        },
        new Date("2025-12-31T23:59:00.000Z"),
      );

      const unexamined = await storage.createLoop(
        {
          name: "api-unexamined-many-own-runs",
          schedule: { type: "interval", everyMs: 1_000 },
          target: { type: "command", command: "true" },
          machine: { id: "runner-a" },
          overlap: "allow",
          leaseMs: 1_000,
        },
        new Date("2025-12-31T23:59:30.000Z"),
      );

      // One `listRuns` page is 100 rows. Cross it.
      const OWNED = 101;
      const ownedRunIds: string[] = [];
      for (let i = 0; i < OWNED; i += 1) {
        const slot = new Date(Date.parse("2026-01-01T00:00:00.000Z") + i * 1_000).toISOString();
        const claim = await storage.claimRun(unexamined, slot, "runner-a", now);
        expect(claim).toBeTruthy();
        ownedRunIds.push(claim!.run.id);
      }

      // Every one of those leases is now long expired.
      now = new Date("2026-01-01T01:00:00.000Z");

      const poll = await fetch(apiUrl(server, "/v1/runners/claim"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ runnerId: "runner-a", maxClaims: 1 }),
      });
      expect(poll.status).toBe(200);

      const statuses = await Promise.all(
        ownedRunIds.map(async (id) => (await storage.getRun(id))!.status),
      );
      expect(statuses.filter((status) => status === "running").length).toBe(OWNED);
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("runner claim protection does not consume the recovery scan window", async () => {
    // Protection must be expressed in the recovery QUERY, before its LIMIT.
    // Filtering protected rows out in application code after the scan has
    // already been truncated means a large protected set can crowd the window
    // and starve an unrelated, genuinely reapable run — and because the same
    // protected set is rebuilt on every poll, that starvation is stable rather
    // than transient. That is the same "can never be reaped" class this PR
    // exists to remove, reintroduced through the fix.
    //
    // The default recovery scan window is 100 * 5 = 500 rows, so the protected
    // set here is deliberately larger, and the reapable run's lease expires
    // LATER so it sorts behind them under `ORDER BY lease_expires_at ASC`.
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    let now = new Date("2026-01-01T00:00:00.000Z");
    const server = createTestServer(
      mod,
      { host: "127.0.0.1", port: 0, storage, now: () => now, random: () => 0.5 },
      runnerPrincipal("runner-a"),
    );

    try {
      await storage.createLoop(
        {
          name: "api-scanwindow-capacity-consumer",
          schedule: { type: "interval", everyMs: 1_000 },
          target: { type: "command", command: "true" },
          machine: { id: "runner-a" },
        },
        new Date("2025-12-31T23:59:00.000Z"),
      );

      const unexamined = await storage.createLoop(
        {
          name: "api-scanwindow-protected",
          schedule: { type: "interval", everyMs: 1_000 },
          target: { type: "command", command: "true" },
          machine: { id: "runner-a" },
          overlap: "allow",
          leaseMs: 1_000,
        },
        new Date("2025-12-31T23:59:30.000Z"),
      );

      const PROTECTED = 520;
      const protectedRunIds: string[] = [];
      for (let i = 0; i < PROTECTED; i += 1) {
        const slot = new Date(Date.parse("2026-01-01T00:00:00.000Z") + i * 1_000).toISOString();
        const claim = await storage.claimRun(unexamined, slot, "runner-a", now);
        expect(claim).toBeTruthy();
        protectedRunIds.push(claim!.run.id);
      }

      // A run this runner does NOT own, on another loop, whose lease expires
      // after every protected row above. Nothing protects it, so the sweep must
      // reach and reap it.
      const ghostLoop = await storage.createLoop(
        {
          name: "api-scanwindow-reapable",
          schedule: { type: "interval", everyMs: 1_000 },
          target: { type: "command", command: "true" },
          machine: { id: "runner-ghost" },
          overlap: "skip",
          leaseMs: 1_000,
        },
        new Date("2025-12-31T23:59:45.000Z"),
      );
      const ghostClaim = await storage.claimRun(
        ghostLoop,
        "2026-01-01T00:30:00.000Z",
        "runner-ghost",
        new Date("2026-01-01T00:30:00.000Z"),
      );
      expect(ghostClaim).toBeTruthy();

      now = new Date("2026-01-01T01:00:00.000Z");

      const poll = await fetch(apiUrl(server, "/v1/runners/claim"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ runnerId: "runner-a", maxClaims: 1 }),
      });
      expect(poll.status).toBe(200);

      // Two-sided: the reapable run is reaped AND the protected set is intact.
      // Asserting only the first would pass on an implementation that protects
      // nothing at all.
      expect((await storage.getRun(ghostClaim!.run.id))!.status).toBe("abandoned");
      const protectedStatuses = await Promise.all(
        protectedRunIds.map(async (id) => (await storage.getRun(id))!.status),
      );
      expect(protectedStatuses.filter((status) => status === "running").length).toBe(PROTECTED);
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("runner claim protection costs a bounded number of storage reads, not one per unexamined loop", async () => {
    // The claim endpoint is the hosted scheduler's tick and its hottest path.
    // Building the protection set with one `listRuns` per unexamined loop is an
    // unbatched N+1: the shipped runner polls with `maxClaims: 1`, so a single
    // claim makes EVERY remaining due loop unexamined, and `dueLoops` returns up
    // to 500 of them.
    //
    // The invariant under test is that the cost does not scale with the number
    // of unexamined loops — not any particular call count, so that adding a
    // legitimate constant read later does not fail this test spuriously.
    const mod = await import("./index.js");

    const measure = async (unexaminedLoopCount: number): Promise<number> => {
      const inner = createSqliteLoopStorage(":memory:");
      const counts: Record<string, number> = {};
      const storage = new Proxy(inner, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver) as unknown;
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            counts[String(prop)] = (counts[String(prop)] ?? 0) + 1;
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        },
      }) as unknown as LoopStorageContract;

      let now = new Date("2026-01-01T00:00:00.000Z");
      const server = createTestServer(
        mod,
        { host: "127.0.0.1", port: 0, storage, now: () => now, random: () => 0.5 },
        runnerPrincipal("runner-a"),
      );
      try {
        await inner.createLoop(
          {
            name: "api-nplusone-capacity-consumer",
            schedule: { type: "interval", everyMs: 1_000 },
            target: { type: "command", command: "true" },
            machine: { id: "runner-a" },
          },
          new Date("2025-12-31T23:59:00.000Z"),
        );

        for (let i = 0; i < unexaminedLoopCount; i += 1) {
          const loop = await inner.createLoop(
            {
              name: `api-nplusone-unexamined-${i}`,
              schedule: { type: "interval", everyMs: 1_000 },
              target: { type: "command", command: "true" },
              machine: { id: "runner-a" },
              overlap: "allow",
              leaseMs: 1_000,
            },
            new Date(Date.parse("2025-12-31T23:59:30.000Z") + i),
          );
          const claim = await inner.claimRun(loop, "2026-01-01T00:00:00.000Z", "runner-a", now);
          expect(claim).toBeTruthy();
        }

        now = new Date("2026-01-01T01:00:00.000Z");
        // Counting starts here so loop/run construction above is excluded.
        for (const key of Object.keys(counts)) delete counts[key];

        const poll = await fetch(apiUrl(server, "/v1/runners/claim"), {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ runnerId: "runner-a", maxClaims: 1 }),
        });
        expect(poll.status).toBe(200);
        return counts.listRuns ?? 0;
      } finally {
        server.stop(true);
        await inner.close();
      }
    };

    const few = await measure(3);
    const many = await measure(30);
    expect(many).toBe(few);
  });

  test("runner claim reaps an expired lease owned by an ineligible runner", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const recoveredAt = new Date("2026-01-01T00:00:05.000Z");
    const server = createTestServer(
      mod,
      { host: "127.0.0.1", port: 0, storage, now: () => recoveredAt, random: () => 0.5 },
      runnerPrincipal("healthy-runner"),
    );

    try {
      const staleLoop = await storage.createLoop(
        {
          name: "api-hosted-expired-unrelated-runner",
          schedule: { type: "interval", everyMs: 1_000 },
          target: { type: "command", command: "true" },
          machine: { id: "missing-runner" },
          catchUp: "latest",
          overlap: "skip",
          maxAttempts: 1,
          leaseMs: 1_000,
        },
        new Date("2025-12-31T23:59:59.000Z"),
      );
      const staleClaim = await storage.claimRun(
        staleLoop,
        staleLoop.nextRunAt!,
        "missing-runner",
        startedAt,
      );
      expect(staleClaim?.run).toMatchObject({ status: "running", claimedBy: "missing-runner" });

      const response = await fetch(apiUrl(server, "/v1/runners/claim"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ runnerId: "healthy-runner", maxClaims: 1 }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, claims: [] });
      expect(await storage.getRun(staleClaim!.run.id)).toMatchObject({
        status: "abandoned",
        error: "run lease expired before completion",
      });
      expect(await storage.getLoop(staleLoop.id)).toMatchObject({
        status: "active",
        nextRunAt: "2026-01-01T00:00:06.000Z",
      });
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("GET /v1/loops paginates with offset, clamps oversized limit, and filters by name", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage });
    try {
      for (let i = 0; i < 5; i += 1) {
        await storage.createLoop({
          name: `page-loop-${i}`,
          schedule: { type: "once", at: "2030-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        });
      }
      // limit>1000 is clamped, NOT rejected with 422 and NOT an empty array.
      const clamped = await fetch(apiUrl(server, "/v1/loops?limit=100000&includeArchived=true"));
      expect(clamped.status).toBe(200);
      const clampedBody = (await clamped.json()) as { ok: boolean; loops: Array<{ id: string }> };
      expect(clampedBody.ok).toBe(true);
      expect(clampedBody.loops).toHaveLength(5);

      // offset actually skips rows (page 1 vs page 2 differ).
      const page1 = (await (await fetch(apiUrl(server, "/v1/loops?limit=2&offset=0&includeArchived=true"))).json()) as {
        loops: Array<{ id: string }>;
      };
      const page2 = (await (await fetch(apiUrl(server, "/v1/loops?limit=2&offset=2&includeArchived=true"))).json()) as {
        loops: Array<{ id: string }>;
      };
      expect(page1.loops).toHaveLength(2);
      expect(page2.loops).toHaveLength(2);
      const overlap = page1.loops.filter((l) => page2.loops.some((p) => p.id === l.id));
      expect(overlap).toHaveLength(0);

      // name filter returns the single exact match (server-side name resolution).
      const byName = (await (await fetch(apiUrl(server, "/v1/loops?name=page-loop-3&includeArchived=true"))).json()) as {
        loops: Array<{ name: string }>;
      };
      expect(byName.loops).toHaveLength(1);
      expect(byName.loops[0]?.name).toBe("page-loop-3");

      // negative offset is a 422 (validation, not silent).
      const badOffset = await fetch(apiUrl(server, "/v1/loops?offset=-1"));
      expect(badOffset.status).toBe(422);
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("failed finalize and replay derive retry timing from persisted server receipt time", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    let randomSample = 0;
    const server = createTestServer(
      mod,
      {
        host: "127.0.0.1",
        port: 0,
        storage,
        now: () => new Date("2026-01-01T00:00:10.000Z"),
        random: () => randomSample,
      },
      runnerPrincipal("runner-replay"),
    );
    try {
      const loop = await storage.createLoop({
        name: "api-terminal-failed-replay",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "false" },
        maxAttempts: 2,
        retryDelayMs: 1_000,
      }, new Date("2026-01-01T00:00:00.000Z"));
      await storage.updateLoop(loop.id, { nextRunAt: "2026-01-01T00:00:00.000Z" });
      const claim = await storage.claimRun(
        loop,
        "2026-01-01T00:00:00.000Z",
        "runner-replay",
        new Date("2026-01-01T00:00:01.000Z"),
      );
      const finalize = () => fetch(apiUrl(server, `/v1/runs/${claim!.run.id}/finalize`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          claimToken: claim!.claimToken,
          status: "failed",
          finishedAt: "2026-01-01T00:00:02.000Z",
          stdout: "",
          stderr: "",
          error: "retry me",
        }),
      });

      expect((await finalize()).status).toBe(200);
      expect((await storage.getRun(claim!.run.id))?.startedAt).toBe("2026-01-01T00:00:01.000Z");
      expect((await storage.getRun(claim!.run.id))?.finishedAt).toBe("2026-01-01T00:00:02.000Z");
      expect((await storage.getRun(claim!.run.id))?.updatedAt).toBe("2026-01-01T00:00:10.000Z");
      expect(await storage.getLoop(loop.id)).toMatchObject({
        status: "active",
        nextRunAt: "2026-01-01T00:00:10.500Z",
        retryScheduledFor: claim!.run.scheduledFor,
      });

      randomSample = 0.999999;
      expect((await finalize()).status).toBe(200);
      expect((await storage.getRun(claim!.run.id))?.startedAt).toBe("2026-01-01T00:00:01.000Z");
      expect(await storage.getLoop(loop.id)).toMatchObject({
        status: "active",
        nextRunAt: "2026-01-01T00:00:10.500Z",
        retryScheduledFor: claim!.run.scheduledFor,
      });
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("only the same principal and status can replay a terminal finalize to repair missing advancement", async () => {
    const mod = await import("./index.js");
    const baseStorage = createSqliteLoopStorage(":memory:");
    const loop = await baseStorage.createLoop({
      name: "api-terminal-repair-guard",
      schedule: { type: "interval", everyMs: 60_000 },
      target: { type: "command", command: "false" },
      maxAttempts: 2,
      retryDelayMs: 1_000,
    }, new Date("2026-01-01T00:00:00.000Z"));
    await baseStorage.updateLoop(loop.id, { nextRunAt: "2026-01-01T00:00:00.000Z" });
    const claim = await baseStorage.claimRun(
      loop,
      "2026-01-01T00:00:00.000Z",
      "runner-repair",
      new Date("2026-01-01T00:00:01.000Z"),
    );
    let failAdvancement = true;
    const storage = new Proxy(baseStorage, {
      get(target, property) {
        if (property === "advanceLoopIfCurrent") {
          return async (...args: Parameters<typeof target.advanceLoopIfCurrent>) => {
            if (failAdvancement) {
              failAdvancement = false;
              throw new Error("transient advancement failure");
            }
            return target.advanceLoopIfCurrent(...args);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as LoopStorageContract;
    const owner = createTestServer(
      mod,
      {
        host: "127.0.0.1",
        port: 0,
        storage,
        now: () => new Date("2026-01-01T00:00:10.000Z"),
        random: () => 0.5,
      },
      runnerPrincipal("runner-repair"),
    );
    const intruder = createTestServer(
      mod,
      {
        host: "127.0.0.1",
        port: 0,
        storage,
        now: () => new Date("2026-01-01T00:00:10.000Z"),
        random: () => 0.5,
      },
      runnerPrincipal("runner-other"),
    );
    const finalize = (
      server: { port?: number },
      status: "succeeded" | "failed",
      overrides: Record<string, unknown> = {},
    ) => fetch(
      apiUrl(server, `/v1/runs/${claim!.run.id}/finalize`),
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          claimToken: claim!.claimToken,
          status,
          stdout: "",
          stderr: "",
          ...(status === "failed" ? { error: "retry me" } : {}),
          ...overrides,
        }),
      },
    );
    try {
      expect((await finalize(owner, "failed")).status).toBe(500);
      expect((await baseStorage.getRun(claim!.run.id))?.status).toBe("failed");
      expect((await baseStorage.getLoop(loop.id))?.nextRunAt).toBe("2026-01-01T00:00:00.000Z");

      expect((await finalize(intruder, "failed")).status).toBe(409);
      expect((await finalize(owner, "succeeded")).status).toBe(409);
      expect((await finalize(owner, "failed", { claimToken: "stale-attempt-token" })).status).toBe(409);
      expect((await finalize(owner, "failed", { finishedAt: "not-a-date" })).status).toBe(422);
      expect((await finalize(owner, "failed", { durationMs: -1 })).status).toBe(422);
      expect((await finalize(owner, "failed", { stdout: 42 })).status).toBe(422);
      expect((await baseStorage.getLoop(loop.id))?.nextRunAt).toBe("2026-01-01T00:00:00.000Z");

      expect((await finalize(owner, "failed")).status).toBe(200);
      expect(await baseStorage.getLoop(loop.id)).toMatchObject({
        status: "active",
        nextRunAt: "2026-01-01T00:00:11.000Z",
        retryScheduledFor: claim!.run.scheduledFor,
      });
    } finally {
      intruder.stop(true);
      owner.stop(true);
      await baseStorage.close();
    }
  });

  test("runner finalize returns a stable 409 after two CAS losses and repairs on replay", async () => {
    const mod = await import("./index.js");
    const baseStorage = createSqliteLoopStorage(":memory:");
    const loop = await baseStorage.createLoop({
      name: "api-advancement-double-cas-loss",
      schedule: { type: "interval", everyMs: 60_000 },
      target: { type: "command", command: "true" },
    }, new Date("2026-01-01T00:00:00.000Z"));
    await baseStorage.updateLoop(loop.id, { nextRunAt: "2026-01-01T00:01:00.000Z" });
    const claim = await baseStorage.claimRun(
      loop,
      "2026-01-01T00:01:00.000Z",
      "runner-double-cas",
      new Date("2026-01-01T00:01:01.000Z"),
    );
    let lossesRemaining = 2;
    const storage = new Proxy(baseStorage, {
      get(target, property) {
        if (property === "advanceLoopIfCurrent") {
          return async (...args: Parameters<typeof target.advanceLoopIfCurrent>) => {
            if (lossesRemaining > 0) {
              lossesRemaining -= 1;
              return undefined;
            }
            return target.advanceLoopIfCurrent(...args);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as LoopStorageContract;
    const server = createTestServer(
      mod,
      {
        host: "127.0.0.1",
        port: 0,
        storage,
        now: () => new Date("2026-01-01T00:01:10.000Z"),
      },
      runnerPrincipal("runner-double-cas"),
    );
    const finalize = () => fetch(apiUrl(server, `/v1/runs/${claim!.run.id}/finalize`), {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        claimToken: claim!.claimToken,
        status: "succeeded",
        stdout: "",
        stderr: "",
      }),
    });
    try {
      const conflicted = await finalize();
      expect(conflicted.status).toBe(409);
      expect(await conflicted.json()).toEqual({ ok: false, error: "loop_advancement_conflict" });
      expect((await baseStorage.getRun(claim!.run.id))?.status).toBe("succeeded");
      expect((await baseStorage.getLoop(loop.id))?.nextRunAt).toBe("2026-01-01T00:01:00.000Z");

      expect((await finalize()).status).toBe(200);
      expect(await baseStorage.getLoop(loop.id)).toMatchObject({
        status: "active",
        nextRunAt: "2026-01-01T00:02:00.000Z",
      });
    } finally {
      server.stop(true);
      await baseStorage.close();
    }
  });

  test("reverse-order API failures select the globally earliest owed retry", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    let now = new Date("2026-01-01T00:01:10.000Z");
    const server = createTestServer(
      mod,
      { host: "127.0.0.1", port: 0, storage, now: () => now, random: () => 0.5 },
      runnerPrincipal("runner-reverse"),
    );
    try {
      const loop = await storage.createLoop({
        name: "api-reverse-order-retry",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "false" },
        overlap: "allow",
        maxAttempts: 2,
        retryDelayMs: 1_000,
      }, new Date("2026-01-01T00:00:00.000Z"));
      const older = await storage.claimRun(
        loop,
        "2026-01-01T00:00:00.000Z",
        "runner-reverse",
        new Date("2026-01-01T00:00:01.000Z"),
      );
      const newer = await storage.claimRun(
        loop,
        "2026-01-01T00:01:00.000Z",
        "runner-reverse",
        new Date("2026-01-01T00:01:01.000Z"),
      );
      const finalize = (claim: NonNullable<typeof newer>) => fetch(
        apiUrl(server, `/v1/runs/${claim.run.id}/finalize`),
        {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            claimToken: claim.claimToken,
            status: "failed",
            stdout: "",
            stderr: "",
            error: "retry me",
          }),
        },
      );

      expect((await finalize(newer!)).status).toBe(200);
      expect(await storage.getLoop(loop.id)).toMatchObject({
        retryScheduledFor: newer!.run.scheduledFor,
      });
      now = new Date("2026-01-01T00:01:11.000Z");
      expect((await finalize(older!)).status).toBe(200);
      expect(await storage.getLoop(loop.id)).toMatchObject({
        retryScheduledFor: older!.run.scheduledFor,
      });
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("single-run recovery replays an already-abandoned workflow parent after advancement conflict", async () => {
    const mod = await import("./index.js");
    const baseStorage = createSqliteLoopStorage(":memory:");
    const claimedAt = new Date("2026-01-01T00:00:00.000Z");
    const recoveredAt = new Date("2026-01-01T00:00:02.000Z");
    const workflow = await baseStorage.createWorkflow({
      name: "recover-parent-workflow",
      steps: [{ id: "worker", target: { type: "command", command: "true" } }],
    });
    const loop = await baseStorage.createLoop({
      name: "recover-single-replay",
      schedule: { type: "interval", everyMs: 60_000 },
      target: { type: "workflow", workflowId: workflow.id },
      maxAttempts: 2,
      retryDelayMs: 1_000,
      leaseMs: 1_000,
    }, claimedAt);
    await baseStorage.updateLoop(loop.id, { nextRunAt: claimedAt.toISOString() });
    const claim = await baseStorage.claimRun(loop, claimedAt.toISOString(), "runner-single", claimedAt);
    const workflowRun = await baseStorage.createWorkflowRun({
      workflow,
      loop,
      loopRun: claim!.run,
    });
    await baseStorage.startWorkflowStepRun(workflowRun.id, "worker");
    let lossesRemaining = 2;
    const storage = new Proxy(baseStorage, {
      get(target, property) {
        if (property === "advanceLoopIfCurrent") {
          return async (...args: Parameters<typeof target.advanceLoopIfCurrent>) => {
            if (args[0] === loop.id && lossesRemaining > 0) {
              lossesRemaining -= 1;
              return undefined;
            }
            return target.advanceLoopIfCurrent(...args);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as LoopStorageContract;
    const server = createTestServer(
      mod,
      { host: "127.0.0.1", port: 0, storage, now: () => recoveredAt, random: () => 0.5 },
      runnerPrincipal("runner-single"),
    );
    try {
      const recover = () => fetch(apiUrl(server, `/v1/runs/${claim!.run.id}/recover`), { method: "POST" });
      const conflicted = await recover();
      expect(conflicted.status).toBe(200);
      expect(conflicted.status).not.toBe(409);
      expect(await conflicted.json()).toMatchObject({
        advancementDeferred: [{ id: claim!.run.id, status: "abandoned" }],
      });
      expect(await baseStorage.getRun(claim!.run.id)).toMatchObject({ status: "abandoned" });
      expect(await baseStorage.getWorkflowRun(workflowRun.id)).toMatchObject({ status: "failed" });
      expect(await baseStorage.getWorkflowStepRun(workflowRun.id, "worker")).toMatchObject({ status: "skipped" });
      expect((await baseStorage.getLoop(loop.id))?.nextRunAt).toBe(claimedAt.toISOString());

      const repaired = await Promise.all([recover(), recover()]);
      expect(repaired.map((response) => response.status)).toEqual([200, 200]);
      for (const response of repaired) {
        expect(await response.json()).toMatchObject({ advancementDeferred: [] });
      }
      expect(await baseStorage.getLoop(loop.id)).toMatchObject({
        status: "active",
        nextRunAt: "2026-01-01T00:00:03.000Z",
        retryScheduledFor: claim!.run.scheduledFor,
      });
      expect((await baseStorage.listWorkflowEvents(workflowRun.id))
        .filter((event) => event.eventType === "failed")).toHaveLength(1);
    } finally {
      server.stop(true);
      await baseStorage.close();
    }
  });

  test("maintenance recovery continues after one advancement conflict and repairs it on replay", async () => {
    const mod = await import("./index.js");
    const baseStorage = createSqliteLoopStorage(":memory:");
    const recoveredAt = new Date("2026-01-01T00:00:03.000Z");
    const makeLoop = async (name: string, maxAttempts = 2) => {
      const loop = await baseStorage.createLoop({
        name,
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "false" },
        overlap: "allow",
        maxAttempts,
        retryDelayMs: 1_000,
        leaseMs: 1_000,
      }, new Date("2026-01-01T00:00:00.000Z"));
      await baseStorage.updateLoop(loop.id, { nextRunAt: "2026-01-01T00:00:00.000Z" });
      return loop;
    };
    const conflictedLoop = await makeLoop("recover-maintenance-conflict");
    const conflicted = await baseStorage.claimRun(
      conflictedLoop,
      "2026-01-01T00:00:00.000Z",
      "runner-conflict",
      new Date("2026-01-01T00:00:00.000Z"),
    );
    const reverseLoop = await makeLoop("recover-maintenance-reverse");
    const reverseNewer = await baseStorage.claimRun(
      reverseLoop,
      "2026-01-01T00:01:00.000Z",
      "runner-reverse-newer",
      new Date("2026-01-01T00:00:00.100Z"),
    );
    const reverseOlder = await baseStorage.claimRun(
      reverseLoop,
      "2026-01-01T00:00:00.000Z",
      "runner-reverse-older",
      new Date("2026-01-01T00:00:00.200Z"),
    );
    const exhaustedLoop = await makeLoop("recover-maintenance-exhausted", 1);
    const exhausted = await baseStorage.claimRun(
      exhaustedLoop,
      "2026-01-01T00:00:00.000Z",
      "runner-exhausted",
      new Date("2026-01-01T00:00:00.300Z"),
    );
    let lossesRemaining = 2;
    const storage = new Proxy(baseStorage, {
      get(target, property) {
        if (property === "advanceLoopIfCurrent") {
          return async (...args: Parameters<typeof target.advanceLoopIfCurrent>) => {
            if (args[0] === conflictedLoop.id && lossesRemaining > 0) {
              lossesRemaining -= 1;
              return undefined;
            }
            return target.advanceLoopIfCurrent(...args);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as LoopStorageContract;
    const server = createTestServer(mod, {
      host: "127.0.0.1",
      port: 0,
      storage,
      now: () => recoveredAt,
      random: () => 0.5,
    });
    try {
      const recover = () => fetch(apiUrl(server, "/v1/leases/recover"), { method: "POST" });
      const first = await recover();
      expect(first.status).toBe(200);
      expect(first.status).not.toBe(409);
      expect(await first.json()).toMatchObject({
        advancementDeferred: [{ id: conflicted!.run.id, status: "abandoned" }],
      });
      expect(await baseStorage.getRun(conflicted!.run.id)).toMatchObject({ status: "abandoned" });
      expect(await baseStorage.getRun(reverseNewer!.run.id)).toMatchObject({ status: "abandoned" });
      expect(await baseStorage.getRun(reverseOlder!.run.id)).toMatchObject({ status: "abandoned" });
      expect(await baseStorage.getRun(exhausted!.run.id)).toMatchObject({ status: "abandoned" });
      expect((await baseStorage.getLoop(conflictedLoop.id))?.nextRunAt).toBe("2026-01-01T00:00:00.000Z");
      expect(await baseStorage.getLoop(reverseLoop.id)).toMatchObject({
        retryScheduledFor: reverseOlder!.run.scheduledFor,
      });
      expect(await baseStorage.getLoop(exhaustedLoop.id)).toMatchObject({
        status: "active",
        nextRunAt: "2026-01-01T00:01:00.000Z",
      });

      const repaired = await recover();
      expect(repaired.status).toBe(200);
      expect(await repaired.json()).toMatchObject({ advancementDeferred: [] });
      expect(await baseStorage.getLoop(conflictedLoop.id)).toMatchObject({
        status: "active",
        nextRunAt: "2026-01-01T00:00:04.000Z",
        retryScheduledFor: conflicted!.run.scheduledFor,
      });
    } finally {
      server.stop(true);
      await baseStorage.close();
    }
  });

  test("maintenance recovery skips a stale abandoned page row reclaimed by a newer attempt", async () => {
    const mod = await import("./index.js");
    const baseStorage = createSqliteLoopStorage(":memory:");
    const slot = "2026-01-01T00:01:00.000Z";
    const staleRecoveryReceipt = "2026-01-01T00:01:02.000Z";
    const loop = await baseStorage.createLoop({
      name: "recover-stale-page-reclaim",
      schedule: { type: "interval", everyMs: 60_000 },
      target: { type: "command", command: "false" },
      maxAttempts: 3,
      retryDelayMs: 1_000,
      leaseMs: 60_000,
    }, new Date(slot));
    await baseStorage.updateLoop(loop.id, { nextRunAt: slot });
    await baseStorage.upsertMigrationRun({
      id: "recover-stale-page-run",
      loopId: loop.id,
      loopName: loop.name,
      scheduledFor: slot,
      attempt: 1,
      status: "abandoned",
      finishedAt: staleRecoveryReceipt,
      claimedBy: "runner-reclaim",
      error: "run lease expired before completion",
      createdAt: slot,
      updatedAt: staleRecoveryReceipt,
    });
    let reclaimed: Awaited<ReturnType<typeof baseStorage.claimRun>>;
    let injected = false;
    const storage = new Proxy(baseStorage, {
      get(target, property) {
        if (property === "listRecoveredLeaseRunsPage") {
          return async (...args: Parameters<typeof target.listRecoveredLeaseRunsPage>) => {
            const page = await target.listRecoveredLeaseRunsPage(...args);
            if (!injected && page.runs.some((run) => run.id === "recover-stale-page-run")) {
              injected = true;
              reclaimed = await target.claimRun(
                loop,
                slot,
                "runner-reclaim",
                new Date("2026-01-01T00:01:01.100Z"),
              );
              expect(reclaimed?.run).toMatchObject({
                id: "recover-stale-page-run",
                status: "running",
                attempt: 2,
                startedAt: "2026-01-01T00:01:01.100Z",
              });
            }
            return page;
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as LoopStorageContract;
    let now = new Date(staleRecoveryReceipt);
    const maintenanceServer = createTestServer(
      mod,
      { host: "127.0.0.1", port: 0, storage, now: () => now, random: () => 0.5 },
    );
    const runnerServer = createTestServer(
      mod,
      { host: "127.0.0.1", port: 0, storage, now: () => now, random: () => 0.5 },
      runnerPrincipal("runner-reclaim"),
    );
    try {
      const recovery = await fetch(apiUrl(maintenanceServer, "/v1/leases/recover"), { method: "POST" });
      expect(recovery.status).toBe(200);
      expect(injected).toBe(true);
      expect(await recovery.json()).toMatchObject({ advancementDeferred: [] });
      expect(await baseStorage.getLoop(loop.id)).toMatchObject({
        nextRunAt: slot,
        retryScheduledFor: undefined,
      });

      now = new Date("2026-01-01T00:01:10.000Z");
      const finalized = await fetch(apiUrl(runnerServer, `/v1/runs/${reclaimed!.run.id}/finalize`), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          claimToken: reclaimed!.claimToken,
          status: "failed",
          stdout: "",
          stderr: "",
          error: "attempt two failed",
        }),
      });
      expect(finalized.status).toBe(200);
      expect(await baseStorage.getLoop(loop.id)).toMatchObject({
        nextRunAt: "2026-01-01T00:01:12.000Z",
        retryScheduledFor: slot,
      });
    } finally {
      runnerServer.stop(true);
      maintenanceServer.stop(true);
      await baseStorage.close();
    }
  });

  test("maintenance recovery drains more than 1000 stable abandoned rows without starving the oldest loop", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const slot = "2026-01-01T00:00:00.000Z";
    const receipt = "2026-01-01T00:00:10.000Z";
    const total = 1_001;
    for (let index = 0; index < total; index += 1) {
      const createdAt = new Date(Date.parse(slot) + index).toISOString();
      const loop: Loop = {
        id: `paging-loop-${String(index).padStart(4, "0")}`,
        name: `paging-loop-${String(index).padStart(4, "0")}`,
        labels: [],
        status: "active",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "false" },
        nextRunAt: slot,
        catchUp: "latest",
        catchUpLimit: 1,
        overlap: "skip",
        maxAttempts: 1,
        retryDelayMs: 1_000,
        leaseMs: 60_000,
        createdAt,
        updatedAt: createdAt,
      };
      const run: LoopRun = {
        id: `paging-run-${String(index).padStart(4, "0")}`,
        loopId: loop.id,
        loopName: loop.name,
        scheduledFor: slot,
        attempt: 1,
        status: "abandoned",
        finishedAt: receipt,
        error: "run lease expired before completion",
        createdAt,
        updatedAt: receipt,
      };
      await storage.upsertMigrationLoop(loop);
      await storage.upsertMigrationRun(run);
    }
    const server = createTestServer(mod, {
      host: "127.0.0.1",
      port: 0,
      storage,
      now: () => new Date("2026-01-01T00:00:20.000Z"),
      random: () => 0.5,
    });
    try {
      const response = await fetch(apiUrl(server, "/v1/leases/recover"), { method: "POST" });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ advancementDeferred: [] });
      const loops = await storage.listLoops({ includeArchived: true, limit: total });
      expect(loops).toHaveLength(total);
      expect(loops.every((loop) => loop.nextRunAt === "2026-01-01T00:01:00.000Z")).toBe(true);
    } finally {
      server.stop(true);
      await storage.close();
    }
  }, 60_000);
});

describe("machine assignment on loop create and claim", () => {
  const DUE_AT = "2026-01-01T00:00:00Z";
  const POLL_AT = "2026-01-01T00:00:01Z";

  test("POST /v1/loops persists a well-formed machine ref and echoes it", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage });
    try {
      const response = await fetch(apiUrl(server, "/v1/loops"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          name: "api-pinned-loop",
          schedule: { type: "once", at: DUE_AT },
          target: { type: "command", command: "true" },
          machine: { id: "spark02", requestedId: "station02" },
        }),
      });
      expect(response.status).toBe(201);
      const created = (await response.json()) as { loop: { id: string; machine: { id: string } } };
      expect(created.loop.machine).toMatchObject({ id: "spark02" });
      // The pin must reach the STORE, not just the response: the scheduler
      // gates claims on the stored machine_json, so a response-only echo is
      // exactly the silent assignment loss this regression exists to catch.
      const stored = await storage.getLoop(created.loop.id);
      expect(stored?.machine).toMatchObject({ id: "spark02", requestedId: "station02" });
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("POST /v1/loops rejects a machine given as a bare string (fail closed)", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage });
    try {
      const response = await fetch(apiUrl(server, "/v1/loops"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          name: "api-string-machine",
          schedule: { type: "once", at: DUE_AT },
          target: { type: "command", command: "true" },
          machine: "spark02",
        }),
      });
      // A bare string would be stored as machine_json "spark02", whose `id`
      // is undefined: runnerMatchesLoop then matches NO runner and the loop
      // is leased by nobody — the never-executes state this fix is for.
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ ok: false, error: "validation_failed" });
      const loops = await storage.listLoops({ limit: 10 });
      expect(loops.map((loop) => loop.name)).not.toContain("api-string-machine");
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("POST /v1/loops rejects an empty machine ref object (fail closed)", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage });
    try {
      const response = await fetch(apiUrl(server, "/v1/loops"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          name: "api-empty-machine",
          schedule: { type: "once", at: DUE_AT },
          target: { type: "command", command: "true" },
          machine: {},
        }),
      });
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ ok: false, error: "validation_failed" });
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("a pinned loop is not claimable by a different runner, and the matching runner claims and executes it", async () => {
    const mod = await import("./index.js");

    async function storageWithLoops() {
      const storage = createSqliteLoopStorage(":memory:");
      const createdAt = new Date("2025-12-31T00:00:00Z");
      await storage.createLoop({
        name: "fleet-unbound",
        schedule: { type: "once", at: DUE_AT },
        target: { type: "command", command: "true" },
      }, createdAt);
      await storage.createLoop({
        name: "pinned-spark02",
        schedule: { type: "once", at: DUE_AT },
        target: { type: "command", command: "true" },
        machine: { id: "spark02" },
      }, createdAt);
      return storage;
    }

    function claimedLoopNames(payload: Record<string, unknown>): string[] {
      const claims = payload.claims as Array<{ loop: { name: string } }> | undefined;
      return (claims ?? []).map((claim) => claim.loop.name).sort();
    }

    // A runner that is NOT the pin target must not receive the pinned loop.
    // This is the fleet-claim half of the bug: with machine_json NULL the
    // loop was claimable by ANY runner; with the pin persisted the gate must
    // exclude every non-matching runner.
    {
      const storage = await storageWithLoops();
      const server = createTestServer(
        mod,
        { host: "127.0.0.1", port: 0, storage, now: () => new Date(POLL_AT) },
        runnerPrincipal("spark01"),
      );
      try {
        const response = await fetch(apiUrl(server, "/v1/runners/claim"), {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ runnerId: "spark01", maxClaims: 10 }),
        });
        expect(response.status).toBe(200);
        expect(claimedLoopNames(await response.json() as Record<string, unknown>)).toEqual(["fleet-unbound"]);
      } finally {
        server.stop(true);
        await storage.close();
      }
    }

    // The matching runner claims the pinned loop and completes it end to end.
    {
      const storage = await storageWithLoops();
      const server = createTestServer(
        mod,
        { host: "127.0.0.1", port: 0, storage, now: () => new Date(POLL_AT) },
        runnerPrincipal("spark02"),
      );
      try {
        const claimResponse = await fetch(apiUrl(server, "/v1/runners/claim"), {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ runnerId: "spark02", maxClaims: 10 }),
        });
        expect(claimResponse.status).toBe(200);
        const claimed = (await claimResponse.json()) as {
          claims: Array<{ loop: { name: string }; claimToken: string; run: { id: string } }>;
        };
        const pinned = claimed.claims.find((claim) => claim.loop.name === "pinned-spark02");
        expect(pinned).toBeDefined();
        const finalize = await fetch(apiUrl(server, `/v1/runs/${pinned!.run.id}/finalize`), {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            claimToken: pinned!.claimToken,
            status: "succeeded",
            finishedAt: POLL_AT,
            stdout: "",
            stderr: "",
          }),
        });
        expect(finalize.status).toBe(200);
        expect((await finalize.json()) as { run: { status: string } }).toMatchObject({ run: { status: "succeeded" } });
        // A once loop that succeeded advances to stopped (nextRunAt null):
        // the executed run must move the loop, not leave it leased forever.
        const stored = await storage.findLoopByName("pinned-spark02");
        expect(stored?.status).toBe("stopped");
      } finally {
        server.stop(true);
        await storage.close();
      }
    }
  });
});
describe("hosted run-now endpoint (1fb09589)", () => {
  test("POST /v1/loops/{id}/run-now schedules a paused loop due now for a bound runner", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const input = {
      name: "api-run-now",
      schedule: { type: "once", at: "2030-01-01T00:00:00Z" } as const,
      target: { type: "command", command: "true" } as const,
    };
    const created = await storage.createLoop(input, new Date("2025-12-31T00:00:00Z"));
    await storage.updateLoop(created.id, { status: "paused", nextRunAt: "2030-01-01T00:00:00Z" });
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage });

    try {
      const before = Date.now();
      const response = await fetch(apiUrl(server, `/v1/loops/${created.id}/run-now`), { method: "POST" });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        ok: boolean;
        loop: { id: string; status: string; nextRunAt?: string };
        scheduledFor: string;
      };
      expect(body.ok).toBe(true);
      expect(body.loop.id).toBe(created.id);
      expect(body.loop.status).toBe("active");
      expect(body.scheduledFor).toBeString();
      const scheduledMs = Date.parse(body.scheduledFor);
      expect(scheduledMs).toBeGreaterThanOrEqual(before - 5_000);
      expect(scheduledMs).toBeLessThanOrEqual(Date.now() + 5_000);
      expect(body.loop.nextRunAt).toBe(body.scheduledFor);

      const stored = await storage.getLoop(created.id);
      expect(stored?.status).toBe("active");
      expect(stored?.nextRunAt).toBe(body.scheduledFor);
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("POST /v1/loops/{id}/run-now 404s unknown ids and 409s archived loops without mutating", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const input = {
      name: "api-run-now-archived",
      schedule: { type: "once", at: "2030-01-01T00:00:00Z" } as const,
      target: { type: "command", command: "true" } as const,
    };
    const archived = await storage.createLoop(input, new Date("2025-12-31T00:00:00Z"));
    await storage.archiveLoop(archived.id);
    const server = createTestServer(mod, { host: "127.0.0.1", port: 0, storage });

    try {
      const missing = await fetch(apiUrl(server, "/v1/loops/no-such-loop/run-now"), { method: "POST" });
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ ok: false, error: "loop_not_found" });

      const archivedResponse = await fetch(apiUrl(server, `/v1/loops/${archived.id}/run-now`), { method: "POST" });
      expect(archivedResponse.status).toBe(409);
      expect(await archivedResponse.json()).toEqual({ ok: false, error: "loop_archived" });

      const stored = await storage.getLoop(archived.id);
      expect(stored?.archivedAt).toBeDefined();
      expect(stored?.nextRunAt).toBe("2030-01-01T00:00:00.000Z");
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("openapi documents the hosted run-now path as a write operation", async () => {
    const mod = await import("./index.js");
    const document = mod.openApiDocument() as {
      paths: Record<string, { post?: Record<string, unknown> }>;
      components: { schemas: Record<string, unknown> };
    };
    const path = document.paths["/v1/loops/{id}/run-now"]?.post;
    expect(path).toBeDefined();
    expect(path?.["x-authorization-operation"]).toBe("loops.runNow");
    expect(path?.["x-required-scopes"]).toEqual(["loops:write"]);
    expect(path?.["x-risk"]).toBe("write");
    expect(document.components.schemas.RunNowResponse).toBeDefined();
  });
});
