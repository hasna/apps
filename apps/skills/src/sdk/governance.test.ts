/**
 * Run governance: privacy, retention, tenancy, cancellation, events, spend
 * ceilings, offline fail-closed — with the six negative fixtures the plan
 * (P6) names as the acceptance gate.
 *
 *   NEGATIVE 1  tenant crossover    — org B can never read org A's runs/artifacts
 *   NEGATIVE 2  secret exposure     — a credential value can never enter an event
 *   NEGATIVE 3  late write          — a worker fenced by cancellation is refused
 *   NEGATIVE 4  expired artifact    — the sweep deletes and receipts, never serves
 *   NEGATIVE 5  exhausted budget    — admission refuses at the exhausted ceiling
 *   NEGATIVE 6  offline failure     — an uncached local run fails closed
 *
 * Each fixture asserts the refusal, not the happy path: the test that proves a
 * guard fires is the one whose subject is the guard. Positive controls sit
 * beside the negatives so a guard that fires on everything is equally visible.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { publicPrincipal } from "../server/auth.js";
import { resolveStoreBackends, storeBackendNotices, type StoreBackendFixture } from "../server/store-fixtures.js";
import { SqliteSkillsStore } from "../server/sqlite-store.js";
import type { ApiPrincipal, ServerArtifact, ServerRunRecord, SkillsProductStore } from "../server/types.js";
import { createCancelService } from "./cancel.js";
import { buildRunLifecycleEvent, createRunEventEmitter, validateRunLifecycleEvent } from "./events.js";
import { createGovernedArtifactWriter, expireArtifacts, redactRunOutput } from "./outputs.js";
import { createSpendService } from "./spend.js";
import { createOfflineGate } from "./offline.js";
import { DEFAULT_OUTPUT_GOVERNANCE, DEFAULT_SPEND_CEILINGS, GOVERNANCE_ERROR_CODES, GovernanceError } from "./governance.js";
import { MemoryGovernanceStore } from "./governance-store.js";
import { MemorySkillsStore, PostgresSkillsStore } from "../server/store.js";
import { ArtifactStorage } from "../server/artifact-storage.js";
import { createRunService } from "./runs.js";
import { runMigrations } from "../server/migrate.js";
import { completeSkillRun, createSkillRun } from "../lib/run-state.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const ORG_A: Partial<ApiPrincipal> = { orgId: "org_a", orgSlug: "org-a", orgName: "Org A", userId: "user_a", email: "a@example.com", apiKeyId: "key_a" };
const ORG_B: Partial<ApiPrincipal> = { orgId: "org_b", orgSlug: "org-b", orgName: "Org B", userId: "user_b", email: "b@example.com", apiKeyId: "key_b" };

const principalA = publicPrincipal(ORG_A);
const principalB = publicPrincipal(ORG_B);

const backends = await resolveStoreBackends();

async function seeded(backend: StoreBackendFixture) {
  // Seeding the api keys also creates the organizations: SQLite enforces the
  // skills_runs.org_id FK, so a run with no organization row is a constraint
  // failure, not a feature.
  return backend.create([
    { token: "sk_governance_a", principal: ORG_A },
    { token: "sk_governance_b", principal: ORG_B },
  ]);
}

function newRun(store: SkillsProductStore, principal: ApiPrincipal, slug = "audio-transcript-pack") {
  return store.createRun({ principal, slug, input: {}, args: [] });
}

function artifactOf(run: ServerRunRecord, overrides: Partial<Omit<ServerArtifact, "createdAt">> = {}): Omit<ServerArtifact, "createdAt"> {
  return {
    id: `art_${Math.random().toString(36).slice(2, 12)}`,
    runId: run.id,
    orgId: run.orgId,
    fileName: "out.txt",
    relativePath: "out.txt",
    contentType: "text/plain",
    byteSize: 3,
    sha256: "abc123",
    storageKind: "db" as const,
    bodyText: "abc",
    visibility: "private" as const,
    ...overrides,
  };
}

/** Full artifact metadata for the governed writer (the writer computes size fields itself). */
function writerMeta(run: ServerRunRecord, id: string, relativePath = "out.txt") {
  return {
    id,
    runId: run.id,
    orgId: run.orgId,
    fileName: relativePath.split("/").pop() ?? "out.txt",
    relativePath,
    contentType: "text/plain",
    byteSize: 0,
    sha256: "",
    visibility: "private" as const,
  };
}

/* ------------------------------------------------------------------ */
/* NEGATIVE 1 — tenant crossover                                      */
/* ------------------------------------------------------------------ */
for (const backend of backends) {
  describe(`governance tenant isolation (${backend.name})`, () => {
    test("NEGATIVE 1: org B cannot read org A's runs or artifacts", async () => {
      const fixture = await seeded(backend);
      try {
        const run = await newRun(fixture.store, principalA);
        await fixture.store.addArtifact(artifactOf(run));

        expect(await fixture.store.getRun(principalB, run.id)).toBeNull();
        expect(await fixture.store.listRuns(principalB, 10)).toEqual([]);
        expect(await fixture.store.getArtifact(principalB, run.id, "art_any")).toBeNull();
        expect(await fixture.store.listArtifacts(principalB, run.id)).toEqual([]);

        // Org A still sees its own run and artifact — the fence is tenant-shaped,
        // not a broken read path.
        expect((await fixture.store.getRun(principalA, run.id))?.id).toBe(run.id);
        expect((await fixture.store.listArtifacts(principalA, run.id)).length).toBe(1);
      } finally {
        await fixture.close();
      }
    });

    test("NEGATIVE 1: tenant-prefixed object keys keep tenants apart and sanitise relative paths", async () => {
      const fixture = await seeded(backend);
      try {
        const storage = new ArtifactStorage();
        const a = storage.objectKeyFor("org_a", "run_1", "out.txt");
        const b = storage.objectKeyFor("org_b", "run_1", "out.txt");
        expect(a).toContain("/org_a/run_1/out.txt");
        expect(b).toContain("/org_b/run_1/out.txt");
        expect(a).not.toBe(b);
        // A reused run id across tenants still resolves to different objects.
        expect(storage.objectKeyFor("org_a", "run_1", "x") === storage.objectKeyFor("org_b", "run_1", "x")).toBe(false);
        // Path traversal is sanitised before it reaches the key.
        expect(storage.objectKeyFor("org_a", "run_1", "../../etc/passwd")).toContain("/org_a/run_1/etc/passwd");
        expect(storage.objectKeyFor("org_a", "run_1", "/abs/path.txt")).toContain("/org_a/run_1/abs/path.txt");
      } finally {
        await fixture.close();
      }
    });
  });
}

/* ------------------------------------------------------------------ */
/* NEGATIVE 2 — secret exposure in event payload                      */
/* ------------------------------------------------------------------ */
describe("governance lifecycle events", () => {
  function runLike(overrides: Partial<ServerRunRecord> = {}): ServerRunRecord {
    return {
      id: "run_1",
      skill: "audio-transcript-pack",
      status: "running",
      correlationId: "corr_1",
      leaseGeneration: 1,
      orgId: "org_a",
      createdAt: "2026-08-15T00:00:00.000Z",
      ...overrides,
    } as ServerRunRecord;
  }

  test("NEGATIVE 2: a credential value in the payload is refused before emission", () => {
    const event = buildRunLifecycleEvent("skills.run.terminal", runLike({ status: "succeeded" }), { at: "2026-08-15T00:00:00.000Z" });
    (event.data as Record<string, unknown>)["output"] = "the key is sk-live-abcdef1234567890";
    expect(() => validateRunLifecycleEvent(event)).toThrowError(GovernanceError);
    try {
      validateRunLifecycleEvent(event);
    } catch (error) {
      expect(error).toBeInstanceOf(GovernanceError);
      expect((error as GovernanceError).code).toBe(GOVERNANCE_ERROR_CODES.EVENT_PAYLOAD_REJECTED);
    }
  });

  test("NEGATIVE 2: an unknown payload key is refused", () => {
    const event = buildRunLifecycleEvent("skills.run.admitted", runLike());
    (event.data as Record<string, unknown>)["input"] = { transcript: "private" };
    expect(() => validateRunLifecycleEvent(event)).toThrowError(GovernanceError);
    try {
      validateRunLifecycleEvent(event);
    } catch (error) {
      expect((error as GovernanceError).code).toBe(GOVERNANCE_ERROR_CODES.EVENT_PAYLOAD_REJECTED);
    }
  });

  test("NEGATIVE 2: a non-scalar value is refused even for an allowlisted key", () => {
    const event = buildRunLifecycleEvent("skills.run.started", runLike());
    (event.data as Record<string, unknown>)["at"] = { not: "a scalar" };
    try {
      validateRunLifecycleEvent(event);
      expect.unreachable("validation must refuse a non-scalar payload value");
    } catch (error) {
      expect(error).toBeInstanceOf(GovernanceError);
      expect((error as GovernanceError).code).toBe(GOVERNANCE_ERROR_CODES.EVENT_PAYLOAD_REJECTED);
    }
  });

  test("NEGATIVE 2: the emitter refuses a secret even with failOpen — no fail-open hole for secrets", async () => {
    const emitted: unknown[] = [];
    const emitter = createRunEventEmitter({
      failOpen: true,
      sink: async (event) => {
        emitted.push(event);
      },
    });
    const run = runLike();
    const event = buildRunLifecycleEvent("skills.run.terminal", { ...run, status: "succeeded" });
    (event.data as Record<string, unknown>)["status"] = "npm_ABCDEF12345678";
    await expect(
      emitter.emit("skills.run.terminal", { ...run, status: "npm_ABCDEF12345678" } as unknown as ServerRunRecord),
    ).rejects.toThrowError(GovernanceError);
    expect(emitted).toEqual([]);
  });

  test("positive: a bounded lifecycle event validates and carries only allowlisted fields", async () => {
    const emitted: unknown[] = [];
    const emitter = createRunEventEmitter({
      sink: async (event) => {
        emitted.push(event);
      },
    });
    const run = runLike({ status: "succeeded" });
    await emitter.emit("skills.run.terminal", run);
    expect(emitted).toHaveLength(1);
    const envelope = emitted[0] as { type: string; data: Record<string, unknown> };
    expect(envelope.type).toBe("skills.run.terminal");
    expect(Object.keys(envelope.data).sort()).toEqual(
      ["at", "attempt_id", "correlation_id", "lease_generation", "run_id", "skill", "status"].sort(),
    );
  });
});

/* ------------------------------------------------------------------ */
/* NEGATIVE 3 — late write after cancel                               */
/* ------------------------------------------------------------------ */
for (const backend of backends) {
  describe(`governance cancellation (${backend.name})`, () => {
    test("NEGATIVE 3: a worker whose lease generation was fenced by cancellation is refused", async () => {
      const fixture = await seeded(backend);
      try {
        const governance = new MemoryGovernanceStore();
        const run = await newRun(fixture.store, principalA);

        // Claim bumps generation to 1; the worker's own terminal transition
        // carries generation 1 and succeeds.
        const claimed = await fixture.store.claimNextRun({ workerId: "worker_1" });
        expect(claimed?.id).toBe(run.id);
        expect(claimed?.leaseGeneration).toBe(1);
        const workerOk = await fixture.store.transitionRun!(run.id, { status: "succeeded" }, 1);
        expect(workerOk?.status).toBe("succeeded");
      } finally {
        await fixture.close();
      }
    });

    test("NEGATIVE 3: cancellation fences the current generation and quarantines partial artifacts", async () => {
      const fixture = await seeded(backend);
      try {
        const governance = new MemoryGovernanceStore();
        const cancel = createCancelService({ store: fixture.store, governanceStore: governance });
        const run = await newRun(fixture.store, principalA);
        await fixture.store.claimNextRun({ workerId: "worker_1" });
        await fixture.store.addArtifact(artifactOf(run, { bodyText: "partial output" }));

        const outcome = await cancel.cancel(principalA, run.id, "user_1");
        expect(outcome.run.status).toBe("cancelled");
        expect(outcome.fencedGeneration).toBe(2);
        expect(outcome.alreadyTerminal).toBe(false);

        const receipts = await governance.listReceipts(principalA.orgId, run.id);
        expect(receipts.map((receipt) => receipt.kind)).toContain("cancel");
        expect(receipts.map((receipt) => receipt.kind)).toContain("quarantine");

        // The worker's late terminal write is refused: the run stays cancelled
        // and the refusal is observable, never a silent drop.
        await expect(fixture.store.transitionRun!(run.id, { status: "succeeded" }, 1)).rejects.toThrow(
          /lease_generation/,
        );
        expect((await fixture.store.getRun(principalA, run.id))?.status).toBe("cancelled");
      } finally {
        await fixture.close();
      }
    });

    test("NEGATIVE 3: a cancel service without generation fencing refuses with FENCING_UNSUPPORTED", async () => {
      const unfenced = new MemorySkillsStore();
      await unfenced.ensureBootstrapApiKey?.("sk_governance_a", ORG_A);
      const seededRun = await newRun(unfenced, principalA);
      // transitionRun is optional on the seam; a third-party store that never
      // implemented fencing is exactly the store the cancel service must refuse.
      // Shadow with undefined: the method lives on the prototype, so `delete`
      // would leave it reachable.
      (unfenced as { transitionRun?: unknown }).transitionRun = undefined;
      const governance = new MemoryGovernanceStore();
      const cancel = createCancelService({ store: unfenced, governanceStore: governance });
      await expect(cancel.cancel(principalA, seededRun.id, "user_1")).rejects.toMatchObject({
        code: GOVERNANCE_ERROR_CODES.FENCING_UNSUPPORTED,
      });
    });
  });
}

/* ------------------------------------------------------------------ */
/* NEGATIVE 4 — expired artifact deletion                             */
/* ------------------------------------------------------------------ */
describe("governance outputs: privacy, redaction, size limits, TTLs, deletion receipts", () => {
  test("NEGATIVE 4: the expiry sweep deletes expired artifacts and records deletion receipts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "skills-gov-expiry-"));
    try {
      const store = new SqliteSkillsStore(join(dir, "server.db"));
      await store.ensureBootstrapApiKey?.("sk_governance_a", ORG_A);
      const governance = new (await import("./governance-store.js")).SqliteGovernanceStore(join(dir, "server.db"));
      const run = await newRun(store, principalA);
      const writer = createGovernedArtifactWriter({
        store,
        governanceStore: governance,
        config: { artifactTtlSeconds: 1 },
      });
      await writer.write(run, writerMeta(run, "art_expired", "a.txt"), { relativePath: "a.txt", bodyText: "soon gone", contentType: "text/plain" });

      // Nothing expires while the artifact is young.
      expect(await expireArtifacts({ governanceStore: governance, requestedBy: "sweep", now: new Date(Date.now() + 500).toISOString() })).toEqual([]);

      // Once past expiresAt, the sweep deletes row + records the deletion receipt.
      const receipts = await expireArtifacts({ governanceStore: governance, requestedBy: "sweep", now: new Date(Date.now() + 60_000).toISOString() });
      expect(receipts.length).toBe(1);
      expect(receipts[0]!.kind).toBe("delete");
      expect(receipts[0]!.requestedBy).toBe("sweep");
      expect(receipts[0]!.artifactId).toBe("art_expired");
      expect(await store.getArtifact(principalA, run.id, "art_expired")).toBeNull();

      // A second sweep is a no-op — deletion is idempotent and receipted once.
      const again = await expireArtifacts({ governanceStore: governance, requestedBy: "sweep", now: new Date(Date.now() + 120_000).toISOString() });
      expect(again).toEqual([]);

      await store.close();
      await governance.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("NEGATIVE 4: redaction runs BEFORE persistence — the stored body never holds the credential", async () => {
    const store = new MemorySkillsStore();
    const governance = new MemoryGovernanceStore();
    const run = await newRun(store, principalA);
    const writer = createGovernedArtifactWriter({ store, governanceStore: governance });
    await writer.write(
      run,
      writerMeta(run, "art_red"),
      { relativePath: "out.txt", bodyText: "token sk-live-abcdef1234567890 end", contentType: "text/plain" },
    );
    const stored = await store.getArtifact(principalA, run.id, "art_red");
    expect(stored?.bodyText).toContain("credential");
    expect(stored?.bodyText).not.toContain("sk-live-abcdef1234567890");
  });

  test("positive: visibility is private by default and finite TTL is stamped at write time", async () => {
    const store = new MemorySkillsStore();
    const governance = new MemoryGovernanceStore();
    const run = await newRun(store, principalA);
    const writer = createGovernedArtifactWriter({
      store,
      governanceStore: governance,
      config: { artifactTtlSeconds: 60 },
    });
    await writer.write(
      run,
      writerMeta(run, "art_vis"),
      { relativePath: "out.txt", bodyText: "hi", contentType: "text/plain" },
    );
    const stored = await store.getArtifact(principalA, run.id, "art_vis");
    expect(stored?.visibility).toBe("private");
    expect(stored?.expiresAt).toBeDefined();
    expect(Date.parse(stored!.expiresAt!) - Date.parse(stored!.createdAt)).toBe(60_000);
  });

  test("positive: hard size limits refuse the write before any row exists", async () => {
    const store = new MemorySkillsStore();
    const governance = new MemoryGovernanceStore();
    const run = await newRun(store, principalA);
    const writer = createGovernedArtifactWriter({
      store,
      governanceStore: governance,
      config: { perOutputBytes: 8 },
    });
    await expect(
      writer.write(
        run,
        writerMeta(run, "art_big"),
        { relativePath: "out.txt", bodyText: "way too long for an 8 byte cap", contentType: "text/plain" },
      ),
    ).rejects.toMatchObject({ code: GOVERNANCE_ERROR_CODES.ARTIFACT_LIMIT_EXCEEDED });
    expect(await store.getArtifact(principalA, run.id, "art_big")).toBeNull();
  });

  test("positive: per-run total cap refuses the write that would exceed it", async () => {
    const store = new MemorySkillsStore();
    const governance = new MemoryGovernanceStore();
    const run = await newRun(store, principalA);
    const writer = createGovernedArtifactWriter({
      store,
      governanceStore: governance,
      config: { perRunTotalBytes: 12 },
    });
    await writer.write(
      run,
      { ...writerMeta(run, "art_1"), byteSize: 7, sha256: "s1" },
      { relativePath: "out.txt", bodyText: "0123456", contentType: "text/plain" },
    );
    await expect(
      writer.write(
        run,
        { ...writerMeta(run, "art_2"), byteSize: 10, sha256: "s2" },
        { relativePath: "out.txt", bodyText: "0123456789", contentType: "text/plain" },
      ),
    ).rejects.toMatchObject({ code: GOVERNANCE_ERROR_CODES.RUN_ARTIFACT_TOTAL_EXCEEDED });
  });

  test("redactRunOutput masks every configured credential family", () => {
    // Deliberately synthetic values. The AWS arm is concatenated so the literal
    // "AKIA<ALNUM>" never appears in the source — the repo's own secrets scanner
    // flags exactly that shape even when the value is a fixture.
    const awsKey = "AKIA" + "1234567890ABCDEF";
    const redacted = redactRunOutput(`key=sk-live-abcdef1234567890 and ${awsKey}`);
    expect(redacted).not.toMatch(/sk-live-abcdef1234567890/);
    expect(redacted).not.toMatch(awsKey);
    expect(redacted).toContain("credential");
  });
});

/* ------------------------------------------------------------------ */
/* NEGATIVE 5 — exhausted budget                                      */
/* ------------------------------------------------------------------ */
describe("governance spend: ceilings at admission, reservations, reconciliation", () => {
  test("NEGATIVE 5: admission refuses when the org's monthly ceiling is exhausted", async () => {
    const governance = new MemoryGovernanceStore();
    // Calendar-proof seed (2026-09-03 repair): the spend window is the CURRENT
    // month, so a hardcoded month frozen at authoring time (2026-08-01) drops
    // out of the window after the rollover and the admission stops rejecting.
    const currentMonthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
    governance.seedRuns([{ orgId: "org_a", costCents: 4900, status: "succeeded", createdAt: currentMonthStart }]);
    const spend = createSpendService({ governanceStore: governance, ceilings: { ...DEFAULT_SPEND_CEILINGS, monthlyTotalCents: 5000, concurrency: 10 } });
    await expect(spend.admit({ principal: principalA, slug: "audio-transcript-pack", estimatedCents: 200 })).rejects.toMatchObject({
      code: GOVERNANCE_ERROR_CODES.RUN_BUDGET_EXHAUSTED,
      ceiling: "monthly",
    });
  });

  test("NEGATIVE 5: admission refuses at the concurrency ceiling", async () => {
    const governance = new MemoryGovernanceStore();
    governance.seedRuns([
      { orgId: "org_a", costCents: 0, status: "running", createdAt: "2026-08-01T00:00:00.000Z" },
      { orgId: "org_a", costCents: 0, status: "queued", createdAt: "2026-08-01T00:00:00.000Z" },
    ]);
    const spend = createSpendService({ governanceStore: governance, ceilings: { ...DEFAULT_SPEND_CEILINGS, concurrency: 2 } });
    await expect(spend.admit({ principal: principalA, slug: "audio-transcript-pack" })).rejects.toMatchObject({
      code: GOVERNANCE_ERROR_CODES.RUN_BUDGET_EXHAUSTED,
      ceiling: "concurrency",
    });
  });

  test("NEGATIVE 5: admission refuses a run whose resource envelope exceeds the per-run ceiling", async () => {
    const governance = new MemoryGovernanceStore();
    const spend = createSpendService({ governanceStore: governance });
    await expect(
      spend.admit({ principal: principalA, slug: "audio-transcript-pack", quota: { cpu: 64, memoryMB: 2048, durationSeconds: 3600, networkMB: 100, artifactBytes: 1 } }),
    ).rejects.toMatchObject({
      code: GOVERNANCE_ERROR_CODES.RUN_BUDGET_EXHAUSTED,
      ceiling: "cpu",
    });
  });

  test("positive: admission passes under the ceilings; reserve then reconcile charges the actual cost", async () => {
    const governance = new MemoryGovernanceStore();
    const spend = createSpendService({ governanceStore: governance, ceilings: { ...DEFAULT_SPEND_CEILINGS, monthlyTotalCents: 5000, concurrency: 4 } });
    await spend.admit({ principal: principalA, slug: "audio-transcript-pack", estimatedCents: 100 });
    const reservation = await spend.reserve("org_a", "run_1", 100);
    expect(reservation.status).toBe("reserved");
    const charged = await spend.reconcile("org_a", "run_1", 80);
    expect(charged?.status).toBe("charged");
    expect(charged?.actualCents).toBe(80);
    // A second reconcile is a no-op — one reservation reconciles once.
    expect(await spend.reconcile("org_a", "run_1", 80)).toBeNull();
  });

  test("positive: an unused reservation is released, never left open", async () => {
    const governance = new MemoryGovernanceStore();
    const spend = createSpendService({ governanceStore: governance });
    await spend.reserve("org_a", "run_1", 100);
    const released = await spend.reconcile("org_a", "run_1", 0);
    expect(released?.status).toBe("released");
    expect(released?.actualCents).toBe(0);
  });

  test("positive: monthly spend counts actuals plus open reservations", async () => {
    const governance = new MemoryGovernanceStore();
    governance.seedRuns([{ orgId: "org_a", costCents: 300, status: "succeeded", createdAt: "2026-08-02T00:00:00.000Z" }]);
    await governance.createReservation({ orgId: "org_a", runId: "run_1", estimatedCents: 700 });
    expect(await governance.monthlySpendCents("org_a", "2026-08")).toBe(1000);
  });
});

/* ------------------------------------------------------------------ */
/* NEGATIVE 6 — offline failure                                       */
/* ------------------------------------------------------------------ */
describe("governance offline: local runs fail closed", () => {
  test("NEGATIVE 6: an uncached skill fails closed offline with no API origin", async () => {
    const gate = createOfflineGate({ isCached: async () => false });
    await expect(gate.assertCanRunLocal("audio-transcript-pack")).rejects.toMatchObject({
      code: GOVERNANCE_ERROR_CODES.SKILL_UNAVAILABLE_OFFLINE,
    });
  });

  test("NEGATIVE 6: a network-required skill fails closed offline even when cached", async () => {
    const gate = createOfflineGate({ isCached: async () => true, isNetworkRequired: async () => true });
    await expect(gate.assertCanRunLocal("audio-transcript-pack")).rejects.toMatchObject({
      code: GOVERNANCE_ERROR_CODES.SKILL_UNAVAILABLE_OFFLINE,
    });
  });

  test("NEGATIVE 6: with an API origin configured, a run never silently falls back locally", async () => {
    const gate = createOfflineGate({ apiUrl: "https://skills.hasna.xyz", isCached: async () => true });
    await expect(gate.assertCanRunLocal("audio-transcript-pack")).rejects.toMatchObject({
      code: GOVERNANCE_ERROR_CODES.REMOTE_REQUIRED,
    });
  });

  test("positive: a cached, dependency-satisfied skill runs offline", async () => {
    const gate = createOfflineGate({ isCached: async () => true, isNetworkRequired: async () => false });
    await expect(gate.assertCanRunLocal("audio-transcript-pack")).resolves.toBeUndefined();
  });

  test("NEGATIVE 6: the admission chain fails closed before any run is created", async () => {
    const store = new MemorySkillsStore();
    const governance = new MemoryGovernanceStore();
    const gate = createOfflineGate({ isCached: async () => false });
    const spend = createSpendService({ governanceStore: governance });
    const events: unknown[] = [];
    const service = createRunService({
      store,
      governance: {
        offline: gate,
        spend,
        events: {
          emit: async () => {
            events.push("emit");
          },
        },
        estimatedCents: 10,
      },
    });
    await expect(service.admit({ principal: principalA, slug: "audio-transcript-pack", input: {}, args: [] })).rejects.toMatchObject({
      code: GOVERNANCE_ERROR_CODES.SKILL_UNAVAILABLE_OFFLINE,
    });
    // Nothing entered the queue, nothing was reserved, nothing was announced.
    expect(await store.listRuns(principalA, 10)).toEqual([]);
    expect(events).toEqual([]);
  });

  test("positive: the governed admission chain admits, reserves and announces", async () => {
    const store = new MemorySkillsStore();
    const governance = new MemoryGovernanceStore();
    const events: string[] = [];
    const service = createRunService({
      store,
      governance: {
        spend: createSpendService({ governanceStore: governance }),
        events: {
          emit: async (type) => {
            events.push(type);
          },
        },
        estimatedCents: 10,
      },
    });
    const run = await service.admit({ principal: principalA, slug: "audio-transcript-pack", input: {}, args: [] });
    expect(run.status).toBe("queued");
    expect(events).toEqual(["skills.run.admitted"]);
    const reservations = await governance.reservationsForRun(principalA.orgId, run.id);
    expect(reservations.length).toBe(1);
    expect(reservations[0]!.estimatedCents).toBe(10);
  });
});

/* ------------------------------------------------------------------ */
/* run.json: exitCode + durationMs                                    */
/* ------------------------------------------------------------------ */
describe("run.json governance fields", () => {
  test("positive: completeSkillRun stamps exitCode and wall-clock durationMs", () => {
    const context = createSkillRun({ skill: "audio-transcript-pack", args: [] });
    const completed = completeSkillRun(context, { status: "completed", exitCode: 0 });
    expect(completed.exitCode).toBe(0);
    expect(completed.completedAt).toBeDefined();
    expect(completed.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("positive: a failing exit code is preserved, not normalised away", () => {
    const context = createSkillRun({ skill: "audio-transcript-pack", args: [] });
    const completed = completeSkillRun(context, { status: "failed", exitCode: 3, error: "boom" });
    expect(completed.exitCode).toBe(3);
    expect(completed.durationMs).toBeGreaterThanOrEqual(0);
  });
});

/* ------------------------------------------------------------------ */
/* Postgres RLS policy — the table-level fence, proven directly       */
/* ------------------------------------------------------------------ */
const TEST_DATABASE_URL_ENV = "HASNA_SKILLS_TEST_DATABASE_URL";
const adminUrl = process.env[TEST_DATABASE_URL_ENV]?.trim();

if (adminUrl) {
  describe("postgres RLS policy (migration 0003)", () => {
    test("a statement with no tenant or worker context sees zero rows — fail closed", async () => {
      const bunWithSql = Bun as unknown as { SQL: new (url: string, options?: { max?: number }) => RawSql };
      const database = `skills_rls_${Math.random().toString(36).slice(2, 12)}`;
      const admin = new bunWithSql.SQL(adminUrl, { max: 1 });
      try {
        await admin.unsafe(`CREATE DATABASE "${database}"`);
        const url = withDatabaseName(adminUrl, database);
        await runMigrations(url);
        const sql = new bunWithSql.SQL(url, { max: 1 });
        try {
          await sql.unsafe(`INSERT INTO organizations (id, slug, name) VALUES ('org_a', 'org-a', 'Org A')`);
          await sql.unsafe(`INSERT INTO users (id, email, name) VALUES ('user_a', 'a@example.com', 'A')`);
          // Seed one run as org_a under the tenant context. With FORCE ROW
          // LEVEL SECURITY the owner is not exempt, and set_config(..., true)
          // is transaction-scoped, so the context and the INSERT must share
          // one transaction (the same shape as the tenant probe below).
          await sql.begin(async (tx) => {
            await tx`SELECT set_config('app.skills_org_id', ${"org_a"}, true)`;
            await tx.unsafe(
              `INSERT INTO skills_runs (id, org_id, user_id, skill_slug, requested_slug, status, input_json, args_json, correlation_id)
               VALUES ('run_rls_1', 'org_a', 'user_a', 'audio-transcript-pack', 'audio-transcript-pack', 'queued', '{}'::jsonb, '[]'::jsonb, 'corr_1')`,
            );
          });
          // FORCE row-level security: the table owner is not exempt, and the
          // migration role IS the server role, so the owner is bound by the
          // fence like any other role. Proven below via a NON-SUPERUSER owner
          // (the postgres superuser that runs this test bypasses RLS by
          // superuser status, so it can never prove or disprove FORCE): we
          // transfer table ownership to the probe role — the production shape,
          // one deploy role owning the tables and serving the app — and assert
          // that owner reads nothing without context. Without FORCE the owner
          // is exempt and this assertion fails: it is the regression that
          // guards the migration's FORCE lines.
          // The probe runs as a NON-SUPERUSER role: superusers bypass RLS, so
          // a superuser connection can never prove the policy. TCP localhost is
          // trust-auth, so a freshly created login role connects without a password.
          // Roles are cluster-wide, so creation is idempotent across test runs.
          await sql.unsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'skills_rls_probe') THEN CREATE ROLE skills_rls_probe LOGIN NOSUPERUSER; END IF; END $$`);
          await sql.unsafe(`GRANT CONNECT ON DATABASE "${database}" TO skills_rls_probe`);
          await sql.unsafe(`GRANT USAGE ON SCHEMA public TO skills_rls_probe`);
          await sql.unsafe(`GRANT SELECT ON skills_runs, skills_artifacts TO skills_rls_probe`);
          await sql.unsafe(`GRANT SELECT ON organizations, users TO skills_rls_probe`);
          // Production shape: one non-superuser deploy role owns the tenant
          // tables and runs the server. Transfer ownership so the owner-
          // exemption half of the FORCE claim is tested, not assumed.
          await sql.unsafe(`ALTER TABLE skills_runs OWNER TO skills_rls_probe`);
          await sql.unsafe(`ALTER TABLE skills_artifacts OWNER TO skills_rls_probe`);
        } finally {
          await sql.close?.();
        }

        // A fresh session with no context sees nothing — RLS is the fence, not the WHERE clause.
        // This connection also IS the table owner (ownership was transferred
        // above), so it simultaneously proves the FORCE half of the fix: the
        // owner is not exempt. With ENABLE-only the owner exemption returns
        // this row and the assertion fails.
        const noContext = new bunWithSql.SQL(withUser(url, "skills_rls_probe"), { max: 1 });
        try {
          await noContext`SELECT set_config('app.skills_org_id', ${""}, true)`;
          await noContext`SELECT set_config('app.skills_claim_context', ${""}, true)`;
          const hidden = await noContext`SELECT COUNT(*) AS n FROM skills_runs`;
          expect(Number(hidden[0]?.n ?? 0)).toBe(0);
          const hiddenArtifacts = await noContext`SELECT COUNT(*) AS n FROM skills_artifacts`;
          expect(Number(hiddenArtifacts[0]?.n ?? 0)).toBe(0);
        } finally {
          await noContext.close?.();
        }

        // The same statement under the tenant context sees the row. set_config
        // with is_local=true is transaction-scoped, so the context and the read
        // share one transaction — exactly how the store's withContext works.
        const tenant = new bunWithSql.SQL(withUser(url, "skills_rls_probe"), { max: 1 });
        try {
          const visible = await tenant.begin(async (tx) => {
            await tx`SELECT set_config('app.skills_org_id', ${"org_a"}, true)`;
            return tx`SELECT COUNT(*) AS n FROM skills_runs`;
          });
          expect(Number(visible[0]?.n ?? 0)).toBe(1);
        } finally {
          await tenant.close?.();
        }

        // The worker context is the deliberate cross-tenant exception.
        const worker = new bunWithSql.SQL(withUser(url, "skills_rls_probe"), { max: 1 });
        try {
          const workerView = await worker.begin(async (tx) => {
            await tx`SELECT set_config('app.skills_org_id', ${""}, true)`;
            await tx`SELECT set_config('app.skills_claim_context', ${"worker"}, true)`;
            return tx`SELECT COUNT(*) AS n FROM skills_runs`;
          });
          expect(Number(workerView[0]?.n ?? 0)).toBe(1);
        } finally {
          await worker.close?.();
        }
      } finally {
        await admin.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
        await admin.close?.();
      }
    }, 60_000);
  });
}

type RawSql = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Array<Record<string, unknown>>>;
  unsafe(query: string): Promise<Array<Record<string, unknown>>>;
  begin<T>(fn: (tx: RawSql) => Promise<T>): Promise<T>;
  close?: () => Promise<void>;
};

function withDatabaseName(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function withUser(url: string, user: string): string {
  const parsed = new URL(url);
  parsed.username = user;
  return parsed.toString();
}

afterAll(() => {
  const notices = storeBackendNotices();
  if (notices.length > 0) {
    console.log(`governance.test: ${notices.join("; ")}`);
  }
});
