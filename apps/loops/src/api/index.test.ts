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

describe("loops-api foundation", () => {
  test("status output is import-safe and path-safe", async () => {
    const mod = await import("./index.js");
    const status = mod.apiStatus();

    expect(status.ok).toBe(true);
    expect(status.service).toBe("loops-api");
    expect(status.status.deploymentMode).toBe("self_hosted");
    expect(JSON.stringify(status)).not.toContain("dataDir");
    expect(JSON.stringify(status)).not.toContain("dbPath");
  });

  test("health uses the strict contracts shape and maps self_hosted runtime to cloud storage mode", async () => {
    const mod = await import("./index.js");
    const previousMode = process.env.HASNA_LOOPS_STORAGE_MODE;
    const mutableBun = Bun as unknown as { serve: typeof Bun.serve };
    const originalServe = mutableBun.serve;
    let fetchHandler: ((request: Request) => Response | Promise<Response>) | undefined;
    process.env.HASNA_LOOPS_STORAGE_MODE = "self_hosted";
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
        mode: "cloud",
      });
    } finally {
      mutableBun.serve = originalServe;
      if (previousMode === undefined) delete process.env.HASNA_LOOPS_STORAGE_MODE;
      else process.env.HASNA_LOOPS_STORAGE_MODE = previousMode;
    }
  });

  test("OpenAPI documents actionable but bounded validation failures for create and import", async () => {
    const mod = await import("./index.js");
    const document = mod.openApiDocument() as {
      paths: Record<string, {
        get?: { responses?: Record<string, { content?: { "application/json"?: { schema?: { $ref?: string } } } }> };
        post?: { responses?: Record<string, { content?: { "application/json"?: { schema?: { $ref?: string } } } }> };
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
    expect(document.paths["/v1/runs/{id}/recover"]?.post?.responses?.["409"]).toBeUndefined();
    expect(document.paths["/v1/leases/recover"]?.post?.responses?.["409"]).toBeUndefined();
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
          if (property === "backend") return "postgres";
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
    const result = spawnSync(process.execPath, [apiPath, "--json", "status"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    const body = JSON.parse(result.stdout) as { ok: boolean; service: string; status: { deploymentMode: string } };
    expect(body).toMatchObject({
      ok: true,
      service: "loops-api",
      status: {
        deploymentMode: "self_hosted",
      },
    });
  });

  test("status output redacts credentials embedded in API URLs", async () => {
    const previousUrl = process.env.HASNA_LOOPS_API_URL;
    const previousToken = process.env.HASNA_LOOPS_API_KEY;
    process.env.HASNA_LOOPS_API_URL = "https://user:fake-password@loops.example.test/api?token=fake-token";
    process.env.HASNA_LOOPS_API_KEY = "present-but-not-returned";
    try {
      const mod = await import("./index.js");
      const status = JSON.stringify(mod.apiStatus());
      expect(status).toContain("https://loops.example.test/api");
      expect(status).not.toContain("fake-password");
      expect(status).not.toContain("fake-token");
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
      expect(created.loop.target.env).toBe("[redacted]");

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
      expect(await workItemResponse.json()).toMatchObject({ ok: true, workItem: { id: "wi-import-1", routeKey: "todos-task" } });
      expect((await storage.getWorkflowWorkItem("wi-import-1"))?.id).toBe("wi-import-1");

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
        workItems: [expect.objectContaining({ id: "wi-import-1", routeKey: "todos-task" })],
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
      const written = (await writeResponse.json()) as { receipt: { run_id: string; summary: { stdout_bytes: number; stdout_excerpt: string } } };
      expect(written.receipt.run_id).toBe("run-api");
      expect(written.receipt.summary.stdout_bytes).toBe(50_000);
      expect(written.receipt.summary.stdout_excerpt).toContain("chars omitted");

      const readResponse = await fetch(apiUrl(server, "/v1/receipts/run-api"));
      expect(readResponse.status).toBe(200);
      const read = (await readResponse.json()) as { receipt: { summary: { text: string } } };
      expect(read.receipt.summary.text).toBe("api receipt");

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
      const created = (await createWorkflowRun.json()) as { workflowRun: { id: string; loopRunId: string; workflowId: string; status: string } };
      expect(created.workflowRun).toMatchObject({ loopRunId: claimed.claims[0]!.run.id, workflowId: workflow.id, status: "running" });
      expect(created.workflowRun.id).toBe(preChangeWorkflowRun.id);

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
    const finalize = (server: { port?: number }, status: "succeeded" | "failed") => fetch(
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
        }),
      },
    );
    try {
      expect((await finalize(owner, "failed")).status).toBe(500);
      expect((await baseStorage.getRun(claim!.run.id))?.status).toBe("failed");
      expect((await baseStorage.getLoop(loop.id))?.nextRunAt).toBe("2026-01-01T00:00:00.000Z");

      expect((await finalize(intruder, "failed")).status).toBe(409);
      expect((await finalize(owner, "succeeded")).status).toBe(409);
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
});
