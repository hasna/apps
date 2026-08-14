/**
 * SDK surface tests: every module imports, the server seam registers routes, the
 * registry + storage round-trip on SQLite in-memory, the run protocol schemas validate
 * both admission and terminal states, and the dispatcher/executor interfaces exist with
 * the current implementations wired behind them.
 */
import { describe, expect, test } from "bun:test";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

import {
  ArtifactStorage,
  DispatcherNotImplementedError,
  EcsDispatcher,
  RUN_PROTOCOL_VERSION,
  SqliteSkillsStore,
  attemptIdOf,
  bundledRegistry,
  createRunService,
  createServer,
  currentVersionService,
  leaseGenerationOf,
  localRunExecutor,
  protocolStateOf,
  registerRoutes,
  runAdmissionSchema,
  runLeaseSchema,
  runProtocolSchema,
  runTerminalSchema,
} from "./index.js";

const PRINCIPAL = {
  apiKeyId: "key_sdk_test",
  orgId: "org_sdk_test",
  orgSlug: "org-sdk-test",
  orgName: "SDK Test Org",
  userId: "user_sdk_test",
  email: "sdk@example.com",
  role: "admin",
  scopes: ["skills:all"],
};

/** A migrated in-memory SQLite store with the org/user rows a run row references. */
async function seededSqliteStore(): Promise<SqliteSkillsStore> {
  const store = new SqliteSkillsStore(":memory:");
  await store.ensureBootstrapApiKey?.("sk_sdk_test", { principal: PRINCIPAL });
  return store;
}

describe("sdk surface", () => {
  test("every sdk module is importable and the protocol version is contract v1", () => {
    expect(RUN_PROTOCOL_VERSION).toBe(1);
    expect(bundledRegistry).toBeDefined();
    expect(currentVersionService).toBeDefined();
    expect(createRunService).toBeTypeOf("function");
    expect(createServer).toBeTypeOf("function");
    expect(registerRoutes).toBeTypeOf("function");
    expect(EcsDispatcher).toBeTypeOf("function");
    expect(localRunExecutor).toBeDefined();
    expect(ArtifactStorage).toBeTypeOf("function");
  });

  test("server seam: createServer returns a handler and registerRoutes composes in front of it", async () => {
    const store = new SqliteSkillsStore(":memory:", {
      migrationsDir: undefined,
    });
    const handler = await createServer({
      store,
      config: { allowEphemeralStore: true, bootstrapApiKey: undefined },
    });

    const health = await handler(new Request("http://localhost/health"));
    expect(health.status).toBe(200);

    const notFound = await handler(new Request("http://localhost/api/v1/does-not-exist"));
    expect(notFound.status).toBe(404);

    const composed = registerRoutes(handler, [
      {
        method: "GET",
        pathname: "/sdk/custom",
        handler: () => Promise.resolve(new Response("custom", { status: 200 })),
      },
    ]);
    const custom = await composed(new Request("http://localhost/sdk/custom"));
    expect(await custom.text()).toBe("custom");
    const fallthrough = await composed(new Request("http://localhost/health"));
    expect(fallthrough.status).toBe(200);
  });

  test("registry + storage round-trip on sqlite in-memory", async () => {
    const store = await seededSqliteStore();

    const published = await store.publishSkill({
      principal: PRINCIPAL,
      slug: "sdk-roundtrip",
      displayName: "SDK Roundtrip",
      description: "round-trip through the sdk storage seam",
      category: "test",
      tags: ["sdk"],
      source: "sdk-test",
      kind: "instruction",
      version: "1.2.3",
      skillMd: "---\nname: sdk-roundtrip\n---\n\n# SDK Roundtrip\n",
    });
    expect(published.slug).toBe("sdk-roundtrip");
    expect(currentVersionService.resolveVersion(published)).toBe("1.2.3");

    const readBack = await store.getSkill(PRINCIPAL, "sdk-roundtrip");
    expect(readBack?.version).toBe("1.2.3");

    const run = await store.createRun({
      principal: PRINCIPAL,
      slug: "sdk-roundtrip",
      input: { text: "hello" },
      args: [],
    });
    const fetched = await store.getRun(PRINCIPAL, run.id);
    expect(fetched?.status).toBe("queued");

    // The bundled registry still resolves catalog skills next to the store.
    expect(bundledRegistry.list().length).toBeGreaterThan(0);
    expect(bundledRegistry.get("pdf-generate")).not.toBeNull();
    expect(bundledRegistry.isValidSlug("pdf-generate")).toBe(true);
    expect(bundledRegistry.isValidSlug("../escape")).toBe(false);
  });

  test("runs protocol schemas validate both admission and terminal states", () => {
    const admission = runAdmissionSchema.parse({
      contractVersion: RUN_PROTOCOL_VERSION,
      runId: "run_1",
      attemptId: "run_1",
      leaseGeneration: 0,
      skill: "pdf-generate",
      status: "admitted",
      createdAt: "2026-08-14T00:00:00.000Z",
    });
    expect(admission.status).toBe("admitted");

    const lease = runLeaseSchema.parse({
      contractVersion: RUN_PROTOCOL_VERSION,
      runId: "run_1",
      attemptId: "run_1",
      leaseGeneration: 0,
      workerId: "worker_1",
      status: "leased",
    });
    expect(lease.workerId).toBe("worker_1");

    const terminal = runTerminalSchema.parse({
      contractVersion: RUN_PROTOCOL_VERSION,
      runId: "run_1",
      attemptId: "run_1",
      leaseGeneration: 0,
      skill: "pdf-generate",
      status: "succeeded",
      completedAt: "2026-08-14T00:01:00.000Z",
    });
    expect(terminal.status).toBe("succeeded");

    // The discriminated union accepts every state and rejects a wrong status.
    for (const message of [admission, lease, terminal]) {
      expect(runProtocolSchema.parse(message).status).toBeDefined();
    }
    expect(() =>
      runProtocolSchema.parse({ contractVersion: RUN_PROTOCOL_VERSION, status: "running" }),
    ).toThrow();

    // Negative controls: missing fields and wrong contract version are rejected.
    expect(() => runAdmissionSchema.parse({ contractVersion: RUN_PROTOCOL_VERSION, status: "admitted" })).toThrow();
    expect(() => runTerminalSchema.parse({ ...terminal, contractVersion: 2 })).toThrow();
  });

  test("atomic run services wrap the store's claim/transition", async () => {
    const store = await seededSqliteStore();
    const runs = createRunService({ store });

    const admitted = await runs.admit({
      principal: PRINCIPAL,
      slug: "sdk-runservice",
      input: {},
      args: [],
    });
    expect(protocolStateOf(admitted.status)).toBe("admitted");
    expect(attemptIdOf(admitted)).toBe(admitted.id);
    expect(leaseGenerationOf(admitted)).toBe(0);

    const leased = await runs.leaseNext("worker_sdk");
    expect(leased?.id).toBe(admitted.id);
    expect(protocolStateOf(leased!.status)).toBe("leased");

    const terminal = await runs.transition(admitted.id, {
      status: "succeeded",
      outputType: "artifact_bundle",
      outputPreview: "ok",
      completedAt: new Date().toISOString(),
    });
    expect(protocolStateOf(terminal!.status)).toBe("terminal");

    const readBack = await runs.get(PRINCIPAL, admitted.id);
    expect(readBack?.status).toBe("succeeded");
  });

  test("dispatcher interfaces exist; the ECS adapter fails closed until implemented", async () => {
    const dispatcher = new EcsDispatcher();
    expect(dispatcher).toBeDefined();
    await expect(dispatcher.submit({ id: "run_1" } as never)).rejects.toThrow(DispatcherNotImplementedError);
    await expect(dispatcher.cancel("run_1")).rejects.toThrow(DispatcherNotImplementedError);
    expect(new DispatcherNotImplementedError("EcsDispatcher", "submit").message).toContain("EcsDispatcher");
  });

  test("executor interface exists with the current local implementation wired", async () => {
    const store = await seededSqliteStore();
    const run = await store.createRun({
      principal: PRINCIPAL,
      slug: "no-provider-free-handler",
      input: {},
      args: [],
    });
    const result = await localRunExecutor.execute(store, run);
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("HANDLER_UNAVAILABLE");
  });

  test("object-store seam: the database column is the default artifact backend", async () => {
    const storage = new ArtifactStorage();
    expect(storage.usesS3).toBe(false);
    const store = await seededSqliteStore();
    const run = await store.createRun({
      principal: PRINCIPAL,
      slug: "sdk-artifacts",
      input: {},
      args: [],
    });
    const artifact = await storage.materialize(
      run,
      {
        id: "art_sdk_test",
        runId: run.id,
        orgId: run.orgId,
        fileName: "out.txt",
        relativePath: "out.txt",
        contentType: "text/plain",
        byteSize: 3,
        sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      },
      { relativePath: "out.txt", bodyText: "abc", contentType: "text/plain" },
    );
    expect(artifact.storageKind).toBe("db");
    expect(await storage.readText({ ...artifact, createdAt: new Date().toISOString() })).toBe("abc");
  });
});
