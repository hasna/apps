import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { createSqliteLoopStorage } from "../lib/storage/sqlite.js";

const apiPath = join(dirname(fileURLToPath(import.meta.url)), "index.ts");
const jsonHeaders = { "content-type": "application/json" };

function apiUrl(server: { port?: number }, path: string): string {
  if (typeof server.port !== "number") throw new Error("test server did not expose a port");
  return `http://127.0.0.1:${server.port}${path}`;
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
    const previousUrl = process.env.LOOPS_API_URL;
    const previousToken = process.env.LOOPS_API_TOKEN;
    process.env.LOOPS_API_URL = "https://user:fake-password@loops.example.test/api?token=fake-token";
    process.env.LOOPS_API_TOKEN = "present-but-not-returned";
    try {
      const mod = await import("./index.js");
      const status = JSON.stringify(mod.apiStatus());
      expect(status).toContain("https://loops.example.test/api");
      expect(status).not.toContain("fake-password");
      expect(status).not.toContain("fake-token");
      expect(status).not.toContain("present-but-not-returned");
    } finally {
      if (previousUrl === undefined) delete process.env.LOOPS_API_URL;
      else process.env.LOOPS_API_URL = previousUrl;
      if (previousToken === undefined) delete process.env.LOOPS_API_TOKEN;
      else process.env.LOOPS_API_TOKEN = previousToken;
    }
  });

  test("non-local serve fails closed without an API token", () => {
    const result = spawnSync(process.execPath, [apiPath, "serve", "--host", "0.0.0.0", "--port", "0"], {
      env: {
        ...process.env,
        LOOPS_API_TOKEN: "",
        HASNA_LOOPS_API_TOKEN: "",
      },
      encoding: "utf8",
      timeout: 5_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("non-local loops-serve binds require");
  });

  test("non-local serve requires the configured bearer token", async () => {
    const previousToken = process.env.LOOPS_API_TOKEN;
    const previousHasnaToken = process.env.HASNA_LOOPS_API_TOKEN;
    process.env.LOOPS_API_TOKEN = "test-api-token";
    process.env.HASNA_LOOPS_API_TOKEN = "";

    const mod = await import("./index.js");
    const server = mod.createLoopsApiServer({ host: "0.0.0.0", port: 0 });
    const url = `http://127.0.0.1:${server.port}/status`;
    const v1Url = `http://127.0.0.1:${server.port}/v1/loops`;
    try {
      const missing = await fetch(url);
      expect(missing.status).toBe(401);
      const wrong = await fetch(url, { headers: { authorization: "Bearer wrong-token" } });
      expect(wrong.status).toBe(401);
      const ok = await fetch(url, { headers: { authorization: "Bearer test-api-token" } });
      expect(ok.status).toBe(200);
      const body = (await ok.json()) as { ok: boolean; service: string };
      expect(body).toMatchObject({ ok: true, service: "loops-api" });

      const missingV1 = await fetch(v1Url, { method: "POST", body: "not-json" });
      expect(missingV1.status).toBe(401);
      const wrongV1 = await fetch(v1Url, { headers: { authorization: "Bearer wrong-token" } });
      expect(wrongV1.status).toBe(401);
      const authorizedV1 = await fetch(v1Url, { headers: { authorization: "Bearer test-api-token" } });
      expect(authorizedV1.status).toBe(503);
      expect(await authorizedV1.json()).toMatchObject({ ok: false, error: "storage_unconfigured" });
    } finally {
      server.stop(true);
      if (previousToken === undefined) delete process.env.LOOPS_API_TOKEN;
      else process.env.LOOPS_API_TOKEN = previousToken;
      if (previousHasnaToken === undefined) delete process.env.HASNA_LOOPS_API_TOKEN;
      else process.env.HASNA_LOOPS_API_TOKEN = previousHasnaToken;
    }
  });

  test("loops routes use injected storage and redact command environments", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = mod.createLoopsApiServer({ host: "127.0.0.1", port: 0, storage });

    try {
      const createResponse = await fetch(apiUrl(server, "/v1/loops"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          name: "api-storage-loop",
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
      const created = (await createResponse.json()) as { ok: boolean; loop: { id: string; name: string; target: { env?: unknown } } };
      expect(created).toMatchObject({ ok: true, loop: { name: "api-storage-loop" } });
      expect(created.loop.target.env).toBe("[redacted]");

      const listResponse = await fetch(apiUrl(server, "/v1/loops?limit=10"));
      const listed = (await listResponse.json()) as { loops: { id: string }[] };
      expect(listResponse.status).toBe(200);
      expect(listed.loops.map((loop) => loop.id)).toContain(created.loop.id);

      const getResponse = await fetch(apiUrl(server, `/v1/loops/${created.loop.id}`));
      expect(getResponse.status).toBe(200);

      const pauseResponse = await fetch(apiUrl(server, `/v1/loops/${created.loop.id}`), {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ status: "paused" }),
      });
      const paused = (await pauseResponse.json()) as { loop: { status: string } };
      expect(pauseResponse.status).toBe(200);
      expect(paused.loop.status).toBe("paused");

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

  test("PATCH only touches fields present in the body and never wipes omitted schedule state", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = mod.createLoopsApiServer({ host: "127.0.0.1", port: 0, storage });

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

  test("run listing redacts output unless explicitly requested", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = mod.createLoopsApiServer({ host: "127.0.0.1", port: 0, storage });

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
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("storage-backed routes fail closed without configured storage", async () => {
    const mod = await import("./index.js");
    const server = mod.createLoopsApiServer({ host: "127.0.0.1", port: 0 });

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
    const server = mod.createLoopsApiServer({ host: "127.0.0.1", port: 0, bodyLimitBytes: 8 });

    try {
      const unsupported = await fetch(apiUrl(server, "/v1/runners/register"), {
        method: "POST",
        body: "{}",
      });
      expect(unsupported.status).toBe(415);
      expect(await unsupported.json()).toMatchObject({ ok: false, error: "unsupported_media_type" });

      const malformed = await fetch(apiUrl(server, "/v1/runners/register"), {
        method: "POST",
        headers: jsonHeaders,
        body: "{",
      });
      expect(malformed.status).toBe(400);
      expect(await malformed.json()).toMatchObject({ ok: false, error: "invalid_json" });

      const tooLarge = await fetch(apiUrl(server, "/v1/runners/register"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ machineId: "spark01" }),
      });
      expect(tooLarge.status).toBe(413);
      expect(await tooLarge.json()).toMatchObject({ ok: false, error: "body_too_large" });
    } finally {
      server.stop(true);
    }
  });

  test("runner protocol endpoints fail closed without storage except registration", async () => {
    const mod = await import("./index.js");
    const server = mod.createLoopsApiServer({ host: "127.0.0.1", port: 0 });

    try {
      const response = await fetch(apiUrl(server, "/v1/runners/register"), {
        method: "POST",
        headers: { "content-type": "application/vnd.open-loops+json" },
        body: JSON.stringify({ machineId: "spark01", labels: { host: "spark01" } }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, runner: { id: "spark01", machineId: "spark01" } });

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

  test("runner claim and run finalization are fenced by claim token", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    let now = new Date("2026-01-01T00:00:00Z");
    const server = mod.createLoopsApiServer({ host: "127.0.0.1", port: 0, storage, now: () => now });

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

      const register = await fetch(apiUrl(server, "/v1/runners/register"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ runnerId: "runner-a", machineId: "machine-a", labels: { os: "linux" } }),
      });
      expect(register.status).toBe(200);
      expect(await register.json()).toMatchObject({ ok: true, runner: { id: "runner-a", machineId: "machine-a" } });

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

      const duplicate = await fetch(apiUrl(server, "/v1/runners/claim"), {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ runnerId: "runner-b", now: "2026-01-01T00:00:00.100Z", maxClaims: 1 }),
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

      now = new Date("2026-01-01T00:00:02Z");
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

  test("runner finalization uses server time for stale-claim fencing", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    let now = new Date("2026-01-01T00:00:00Z");
    const server = mod.createLoopsApiServer({ host: "127.0.0.1", port: 0, storage, now: () => now });

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

      now = new Date("2026-01-01T00:00:02Z");
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

  test("runner claim skips workflow loops until remote workflow execution is supported", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = mod.createLoopsApiServer({
      host: "127.0.0.1",
      port: 0,
      storage,
      now: () => new Date("2026-01-01T00:00:00Z"),
    });

    try {
      const workflow = await storage.createWorkflow({
        name: "api-workflow-claim-skip",
        steps: [{ id: "step", target: { type: "command", command: "true" } }],
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
      expect(await response.json()).toMatchObject({ ok: true, claims: [] });
      expect(await storage.listRuns({ loopId: loop.id })).toHaveLength(0);
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("runner claim returns only one running claim per overlap-skip loop per poll", async () => {
    const mod = await import("./index.js");
    const storage = createSqliteLoopStorage(":memory:");
    const server = mod.createLoopsApiServer({
      host: "127.0.0.1",
      port: 0,
      storage,
      now: () => new Date("2026-01-01T00:00:05Z"),
    });

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
});
