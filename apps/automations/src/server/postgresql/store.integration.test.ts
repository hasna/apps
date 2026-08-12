import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import postgres from "postgres";
import type { AutomationSpec } from "../../types.js";
import { selectServerStorage } from "../index.js";
import { SqliteServerAutomationsStore } from "../sqlite-store.js";
import type { ServerAutomationsStore } from "../store.js";
import { PostgreSqlServerAutomationsStore } from "./store.js";

const storage = selectServerStorage();
const databaseUrl = storage.kind === "postgresql" ? storage.databaseUrl : undefined;
const postgresTestRequired = process.env.HASNA_AUTOMATIONS_REQUIRE_POSTGRES_TEST === "1";

if (postgresTestRequired && !databaseUrl) {
  throw new Error("PostgreSQL integration tests require HASNA_AUTOMATIONS_DATABASE_URL or AUTOMATIONS_DATABASE_URL");
}

const describePostgreSql = databaseUrl ? describe : describe.skip;
const admin = databaseUrl ? postgres(databaseUrl, { max: 2, onnotice: () => undefined }) : undefined;
let stores: PostgreSqlServerAutomationsStore[] = [];

const BASE_TIME = "2026-08-11T00:00:00.000Z";
const ISOLATED_RUNNER_FIXTURE = "src/server/postgresql/isolated-runner.fixture.ts";
const SCALE_ROUNDS = 20;
const DROP_SCHEMA = `
  DROP TABLE IF EXISTS
    automation_concurrency_locks,
    daemon_leases,
    automation_replay_requests,
    automation_action_dependencies,
    automation_actions,
    automation_runs,
    webhook_routes,
    automations,
    hasna_automations_schema_migrations
  CASCADE
`;

function spec(id: string, options: { actions?: AutomationSpec["actions"]; concurrency?: boolean } = {}): AutomationSpec {
  return {
    schemaVersion: "1.0",
    id,
    name: id,
    version: "1.0.0",
    triggers: [
      { kind: "event", source: "integration", type: "created" },
      { kind: "webhook", source: "integration", type: "created" },
    ],
    actions: options.actions ?? [
      { id: "first", actionId: "actions.first" },
      { id: "second", actionId: "actions.second", dependsOn: ["first"] },
    ],
    concurrency: options.concurrency ? { key: `${id}:serial`, limit: 1 } : undefined,
  };
}

async function connectPair(): Promise<[PostgreSqlServerAutomationsStore, PostgreSqlServerAutomationsStore]> {
  const pair = await Promise.all([
    PostgreSqlServerAutomationsStore.connect(databaseUrl!),
    PostgreSqlServerAutomationsStore.connect(databaseUrl!),
  ]);
  stores.push(...pair);
  return pair;
}

async function enqueueOne(
  store: ServerAutomationsStore,
  id: string,
  options: { maxAttempts?: number; approval?: boolean } = {},
) {
  await store.createAutomation(spec(`automation-${id}`));
  const run = await store.createRun({
    id: `run-${id}`,
    automationId: `automation-${id}`,
    trigger: { kind: "manual" },
  });
  return store.enqueueAction({
    id: `action-${id}`,
    automationRunId: run.id,
    stepId: "work",
    actionId: "actions.work",
    maxAttempts: options.maxAttempts,
    availableAt: BASE_TIME,
    approvalGate: options.approval ? {
      requirement: { mode: "manual", requiresApproval: true },
      blockedUntilApproved: true,
      decision: { id: `decision-${id}`, status: "pending", requestedAt: BASE_TIME },
    } : undefined,
    invocation: {
      id: `invocation-${id}`,
      actionId: "actions.work",
      manifestVersion: "1.0.0",
      input: { id },
      requestedAt: BASE_TIME,
    },
  });
}

type IsolatedRunnerConfig =
  | { operation: "claim"; runnerId: string; now?: string; leaseMs?: number; startAtEpochMs?: number }
  | { operation: "claim-and-complete"; runnerId: string; now?: string; leaseMs?: number; startAtEpochMs?: number }
  | { operation: "renew"; actionId: string; runnerId: string; fenceToken: number; now?: string; leaseMs?: number }
  | { operation: "complete"; actionId: string; runnerId: string; fenceToken: number; now?: string }
  | {
      operation: "fail";
      actionId: string;
      runnerId: string;
      fenceToken: number;
      now?: string;
      retryBackoffMs?: number;
      retryable?: boolean;
    }
  | {
      operation: "create-replay";
      sourceRunId: string;
      mode: "failed-actions" | "dead-actions" | "entire-run";
      requestedAt?: string;
      actionId?: string;
    }
  | { operation: "requeue-dead"; actionId: string; now?: string };

interface IsolatedRunnerResult {
  ok: boolean;
  value?: Record<string, unknown>;
  error?: string;
}

async function runIsolatedRunner(config: IsolatedRunnerConfig): Promise<IsolatedRunnerResult> {
  const child = Bun.spawn({
    cmd: [process.execPath, "run", ISOLATED_RUNNER_FIXTURE],
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? "",
      HASNA_AUTOMATIONS_DATABASE_URL: databaseUrl!,
      HASNA_AUTOMATIONS_ISOLATED_RUNNER_CONFIG: JSON.stringify(config),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`isolated PostgreSQL runner exited ${exitCode}`);
  if (stderr.length > 0) throw new Error(`isolated PostgreSQL runner wrote ${stderr.length} bytes to stderr`);
  try {
    return JSON.parse(stdout) as IsolatedRunnerResult;
  } catch {
    throw new Error(`isolated PostgreSQL runner returned ${stdout.length} bytes of invalid JSON`);
  }
}

beforeEach(async () => {
  stores = [];
  if (admin) await admin.unsafe(DROP_SCHEMA);
});

afterEach(async () => {
  await Promise.all(stores.map((store) => store.close()));
});

afterAll(async () => {
  await admin?.end();
});

describePostgreSql("PostgreSqlServerAutomationsStore integration", () => {
  test("serializes concurrent migration of a blank database", async () => {
    const [left, right] = await connectPair();
    expect(await left.status()).toMatchObject({ counts: { automations: 0, runs: 0, queuedActions: 0 } });
    expect(await right.status()).toMatchObject({ dbPath: "postgresql" });
    const ledger = await admin!.unsafe<[{ id: string }]>("SELECT id FROM hasna_automations_schema_migrations");
    expect(ledger.map((row) => row.id)).toEqual(["0001_server_schema", "0002_scale_indexes"]);
  });

  test("upgrades a 0001 database additively and replays 0002 idempotently", async () => {
    const [first] = await connectPair();
    await first.close();
    stores = stores.filter((store) => store !== first);
    await admin!.unsafe("DELETE FROM hasna_automations_schema_migrations WHERE id='0002_scale_indexes'");
    await admin!.unsafe(`DROP INDEX
      automations_created_id_idx,
      automations_active_event_sources_gin_idx,
      webhook_routes_created_id_idx,
      automation_runs_created_id_idx,
      automation_actions_created_id_idx,
      automation_actions_dead_updated_id_idx,
      automation_actions_ready_order_idx,
      automation_actions_expired_claim_order_idx,
      daemon_leases_updated_id_idx,
      automation_concurrency_locks_owner_run_idx,
      automations_active_event_source_wildcard_idx`);
    await admin!.unsafe("ALTER TABLE automations DROP COLUMN event_sources");

    const upgraded = await PostgreSqlServerAutomationsStore.connect(databaseUrl!);
    stores.push(upgraded);
    const ledger = await admin!.unsafe<[{ id: string }]>("SELECT id FROM hasna_automations_schema_migrations ORDER BY id");
    expect(ledger.map((row) => row.id)).toEqual(["0001_server_schema", "0002_scale_indexes"]);
    const indexes = await admin!.unsafe<[{ indexname: string }]>(
      "SELECT indexname FROM pg_indexes WHERE schemaname=current_schema() AND indexname LIKE '%_idx' ORDER BY indexname",
    );
    expect(indexes.map((row) => row.indexname)).toContain("automation_actions_ready_order_idx");
    expect(indexes.map((row) => row.indexname)).toContain("automation_actions_expired_claim_order_idx");
    expect(indexes.map((row) => row.indexname)).toContain("automations_active_event_sources_gin_idx");
    expect(indexes.map((row) => row.indexname)).toContain("automations_active_event_source_wildcard_idx");

    const replayed = await PostgreSqlServerAutomationsStore.connect(databaseUrl!);
    stores.push(replayed);
    const replayLedger = await admin!.unsafe<[{ id: string }]>("SELECT id FROM hasna_automations_schema_migrations ORDER BY id");
    expect(replayLedger.map((row) => row.id)).toEqual(["0001_server_schema", "0002_scale_indexes"]);
  });

  test("matches SQLite across persisted method families", async () => {
    const [postgresStore] = await connectPair();
    const sqliteStore = new SqliteServerAutomationsStore({ dbPath: ":memory:" });
    try {
      for (const store of [sqliteStore, postgresStore] satisfies ServerAutomationsStore[]) {
        const automation = await store.createAutomation(spec("parity", {
          actions: [{ id: "webhook-work", actionId: "actions.webhook" }],
        }));
        expect((await store.requireAutomation(automation.id)).id).toBe("parity");
        expect(await store.listAutomations()).toHaveLength(1);
        expect(await store.listAutomations({ limit: 1 })).toHaveLength(1);

        const route = await store.createWebhookRoute({
          id: "route-parity",
          automationId: automation.id,
          path: "/parity",
          signature: { algorithm: "hmac-sha256", secretRef: "secret://old" },
          mapping: { source: "integration", type: "created", idPath: "id" },
        });
        expect((await store.requireWebhookRoute(route.path)).id).toBe(route.id);
        expect((await store.rotateWebhookRouteSecret(route.id, "secret://new")).signature?.secretRef).toBe("secret://new");
        expect((await store.setWebhookRouteStatus(route.id, "disabled")).status).toBe("disabled");
        expect(await store.listWebhookRoutes()).toHaveLength(1);
        expect(await store.countWebhookRoutes()).toBe(1);
        await store.setWebhookRouteStatus(route.id, "active");

        const webhook = await store.materializeWebhookRequest({
          route,
          rawBody: JSON.stringify({ id: "webhook-parity", value: 1 }),
          receivedAt: BASE_TIME,
        });
        expect(webhook.event).toMatchObject({ id: "webhook-parity", source: "integration", type: "created" });

        const run = await store.createRun({ id: "run-parity", automationId: automation.id, trigger: { kind: "manual" } });
        expect((await store.requireRun(run.id)).status).toBe("materialized");
        expect(await store.listRuns()).toHaveLength(2);
        const action = await store.enqueueAction({
          id: "action-parity",
          automationRunId: run.id,
          stepId: "work",
          actionId: "actions.work",
          availableAt: BASE_TIME,
          invocation: { id: "invocation-parity", actionId: "actions.work", manifestVersion: "1.0.0", input: {}, requestedAt: BASE_TIME },
        });
        expect((await store.requireQueuedAction(action.id)).status).toBe("queued");
        expect(await store.listQueuedActions()).toHaveLength(2);
        const claim = await store.claimNextAction({ runnerId: "parity", now: "2026-08-11T00:00:01.000Z" });
        expect(claim?.fenceToken).toBeGreaterThan(0);
        await store.renewActionLease({ actionId: claim!.id, runnerId: "parity", fenceToken: claim!.fenceToken, now: "2026-08-11T00:00:02.000Z" });
        expect((await store.completeActionFenced({ actionId: claim!.id, runnerId: "parity", fenceToken: claim!.fenceToken, now: "2026-08-11T00:00:03.000Z", result: { summary: "done" } })).status).toBe("succeeded");

        const replay = await store.createReplayRequest({ id: "replay-parity", sourceRunId: run.id, mode: "failed-actions", requestedAt: BASE_TIME });
        expect((await store.requireReplayRequest(replay.id)).mode).toBe("failed-actions");
        const lease = await store.heartbeatDaemon({ leaseId: "daemon:parity", now: new Date(BASE_TIME), ttlMs: 10_000 });
        expect((await store.latestDaemonLease())?.id).toBe(lease.id);
        expect(await store.listDeadActions()).toHaveLength(0);
        expect(await store.status(new Date("2026-08-11T00:00:05.000Z"))).toMatchObject({
          counts: { automations: 1, runs: 2, queuedActions: 2, deadActions: 0, replayRequests: 1, webhookRoutes: 1 },
          daemon: { active: true, leaseId: "daemon:parity" },
        });
      }
    } finally {
      await sqliteStore.close();
    }
  });

  test("paginates persisted method families with the same keyset semantics as SQLite", async () => {
    const [postgresStore] = await connectPair();
    const sqliteStore = new SqliteServerAutomationsStore({ dbPath: ":memory:" });
    try {
      for (const [backend, store] of [["sqlite", sqliteStore], ["postgresql", postgresStore]] as const) {
        for (let index = 0; index < 3; index += 1) {
          await store.createAutomation(spec(`${backend}-page-${index}`));
        }
        const first = await store.listAutomations({ limit: 2 });
        expect(first).toHaveLength(2);
        const next = await store.listAutomations({
          limit: 2,
          after: { createdAt: first[1]!.createdAt, id: first[1]!.id },
        });
        expect(next).toHaveLength(1);
        expect(new Set([...first, ...next].map((automation) => automation.id)).size).toBe(3);
        await expect(store.listAutomations({ limit: 0 })).rejects.toThrow("list limit");
        await expect(store.listAutomations({ limit: 1_001 })).rejects.toThrow("list limit");
      }
    } finally {
      await sqliteStore.close();
    }
  });

  test("preserves unscoped event trigger semantics while selecting candidates in PostgreSQL", async () => {
    const [store] = await connectPair();
    const candidates: AutomationSpec[] = [
      spec("event-exact"),
      { ...spec("event-wildcard"), triggers: [{ kind: "event" }] },
      { ...spec("event-wrong-source"), triggers: [{ kind: "event", source: "other", type: "created" }] },
      { ...spec("event-subject"), triggers: [{ kind: "event", source: "integration", type: "created", subject: "target" }] },
      { ...spec("event-wrong-subject"), triggers: [{ kind: "event", source: "integration", type: "created", subject: "other" }] },
      { ...spec("event-filter"), triggers: [{ kind: "event", source: "integration", type: "created", filter: { value: 1 } }] },
      { ...spec("event-filter-not"), triggers: [{ kind: "event", source: "integration", type: "created", filter: { value: { not: 1 } } }] },
    ];
    await Promise.all(candidates.map((candidate) => store.createAutomation(candidate)));
    const materialized = await store.materializeEvent({
      id: "event-selective",
      source: "integration",
      type: "created",
      subject: "target",
      time: BASE_TIME,
      data: { value: 1 },
    });
    expect(materialized.map((entry) => entry.automation.id).sort()).toEqual([
      "event-exact",
      "event-filter",
      "event-subject",
      "event-wildcard",
    ]);
  });

  test("atomically deduplicates event materialization and permits one claimant", async () => {
    const [left, right] = await connectPair();
    await left.createAutomation(spec("atomic"));
    const event = { id: "event-atomic", source: "integration", type: "created", time: BASE_TIME, data: { value: 1 } };
    const [first, second] = await Promise.all([left.materializeEvent(event), right.materializeEvent(event)]);
    expect(first[0]?.run.id).toBe(second[0]?.run.id);
    expect(first[0]?.actions.map((action) => action.id)).toEqual(second[0]?.actions.map((action) => action.id));
    expect(await left.listRuns()).toHaveLength(1);
    expect(await left.listQueuedActions()).toHaveLength(2);

    const claims = await Promise.all([
      left.claimNextAction({ runnerId: "left", now: "2026-08-11T00:00:01.000Z" }),
      right.claimNextAction({ runnerId: "right", now: "2026-08-11T00:00:01.000Z" }),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)?.stepId).toBe("first");
  });

  test("prevents duplicate execution across two isolated runner processes under repeated contention", async () => {
    const [store] = await connectPair();
    for (let round = 0; round < SCALE_ROUNDS; round += 1) {
      const action = await enqueueOne(store, `isolated-scale-${round}`);
      const startAtEpochMs = Date.now() + 100;
      const results = await Promise.all([
        runIsolatedRunner({
          operation: "claim-and-complete",
          runnerId: `isolated-left-${round}`,
          leaseMs: 5_000,
          startAtEpochMs,
        }),
        runIsolatedRunner({
          operation: "claim-and-complete",
          runnerId: `isolated-right-${round}`,
          leaseMs: 5_000,
          startAtEpochMs,
        }),
      ]);
      expect(results.every((result) => result.ok)).toBe(true);
      const completed = results
        .map((result) => result.value)
        .filter((value): value is Record<string, unknown> => value !== undefined);
      expect(completed).toHaveLength(1);
      expect(completed[0]).toMatchObject({ actionId: action.id, fenceToken: 1, status: "succeeded" });
      expect(await store.requireQueuedAction(action.id)).toMatchObject({ status: "succeeded", attempt: 0 });
      const persisted = await admin!.unsafe<[{ claim_version: string }]>(
        "SELECT claim_version::text FROM automation_actions WHERE id=$1",
        [action.id],
      );
      expect(persisted[0]?.claim_version).toBe("1");
    }
  }, 60_000);

  test("preserves renewal fencing and rejects an expired isolated runner after takeover", async () => {
    const [store] = await connectPair();
    const action = await enqueueOne(store, "isolated-fence");
    const originalResult = await runIsolatedRunner({
      operation: "claim",
      runnerId: "isolated-original",
      now: BASE_TIME,
      leaseMs: 1_000,
    });
    expect(originalResult.ok).toBe(true);
    expect(originalResult.value).toMatchObject({ id: action.id, fenceToken: 1 });
    const originalFence = Number(originalResult.value?.fenceToken);

    const renewed = await runIsolatedRunner({
      operation: "renew",
      actionId: action.id,
      runnerId: "isolated-original",
      fenceToken: originalFence,
      now: "2026-08-11T00:00:00.500Z",
      leaseMs: 2_000,
    });
    expect(renewed.ok).toBe(true);
    expect(renewed.value).toMatchObject({
      id: action.id,
      fenceToken: originalFence,
      leaseExpiresAt: "2026-08-11T00:00:02.500Z",
    });

    const beforeRenewedExpiry = await runIsolatedRunner({
      operation: "claim",
      runnerId: "isolated-takeover",
      now: "2026-08-11T00:00:01.000Z",
    });
    expect(beforeRenewedExpiry).toEqual({ ok: true });

    const wrongFence = await runIsolatedRunner({
      operation: "complete",
      actionId: action.id,
      runnerId: "isolated-original",
      fenceToken: originalFence + 1,
      now: "2026-08-11T00:00:01.500Z",
    });
    expect(wrongFence).toMatchObject({ ok: false });
    expect(wrongFence.error).toContain("stale or expired");

    const takeover = await runIsolatedRunner({
      operation: "claim",
      runnerId: "isolated-takeover",
      now: "2026-08-11T00:00:02.500Z",
      leaseMs: 10_000,
    });
    expect(takeover.ok).toBe(true);
    expect(takeover.value).toMatchObject({ id: action.id, fenceToken: originalFence + 1 });

    const staleCompletion = await runIsolatedRunner({
      operation: "complete",
      actionId: action.id,
      runnerId: "isolated-original",
      fenceToken: originalFence,
      now: "2026-08-11T00:00:03.000Z",
    });
    expect(staleCompletion).toMatchObject({ ok: false });
    expect(staleCompletion.error).toContain("stale or expired");

    const acceptedCompletion = await runIsolatedRunner({
      operation: "complete",
      actionId: action.id,
      runnerId: "isolated-takeover",
      fenceToken: originalFence + 1,
      now: "2026-08-11T00:00:03.000Z",
    });
    expect(acceptedCompletion).toMatchObject({ ok: true, value: { id: action.id, status: "succeeded" } });
  }, 30_000);

  test("requires owner and fence, then rejects stale same-runner mutations after takeover", async () => {
    const [left, right] = await connectPair();
    const action = await enqueueOne(left, "fence");
    const original = await left.claimNextAction({ runnerId: "runner", now: BASE_TIME, leaseMs: 1_000 });
    expect(original?.id).toBe(action.id);
    expect(await right.claimNextAction({ runnerId: "runner", now: "2026-08-11T00:00:00.999Z" })).toBeUndefined();
    await expect(right.renewActionLease({ actionId: action.id, runnerId: "other", fenceToken: original!.fenceToken, now: "2026-08-11T00:00:00.500Z" })).rejects.toThrow("stale or expired");
    await expect(right.renewActionLease({ actionId: action.id, runnerId: "runner", fenceToken: original!.fenceToken + 1, now: "2026-08-11T00:00:00.500Z" })).rejects.toThrow("stale or expired");

    const takeover = await right.claimNextAction({ runnerId: "runner", now: "2026-08-11T00:00:01.000Z", leaseMs: 10_000 });
    expect(takeover!.fenceToken).toBeGreaterThan(original!.fenceToken);
    await expect(left.renewActionLease({ actionId: action.id, runnerId: "runner", fenceToken: original!.fenceToken, now: "2026-08-11T00:00:02.000Z" })).rejects.toThrow("stale or expired");
    await expect(left.completeActionFenced({ actionId: action.id, runnerId: "runner", fenceToken: original!.fenceToken, now: "2026-08-11T00:00:02.000Z" })).rejects.toThrow("stale or expired");
    await expect(left.failActionFenced({ actionId: action.id, runnerId: "runner", fenceToken: original!.fenceToken, now: "2026-08-11T00:00:02.000Z", error: { code: "STALE", message: "stale" } })).rejects.toThrow("stale or expired");
    expect((await right.completeActionFenced({ actionId: action.id, runnerId: "runner", fenceToken: takeover!.fenceToken, now: "2026-08-11T00:00:02.000Z" })).status).toBe("succeeded");
  });

  test("increments retry exactly once under concurrent failure", async () => {
    const [left, right] = await connectPair();
    const action = await enqueueOne(left, "retry");
    const claim = await left.claimNextAction({ runnerId: "runner", now: BASE_TIME });
    const options = {
      actionId: action.id,
      runnerId: "runner",
      fenceToken: claim!.fenceToken,
      now: "2026-08-11T00:00:01.000Z",
      retryBackoffMs: 0,
      error: { code: "RETRY", message: "retry", retryable: true },
    } as const;
    const attempts = await Promise.allSettled([left.failActionFenced(options), right.failActionFenced(options)]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await left.requireQueuedAction(action.id)).toMatchObject({ status: "retrying", attempt: 1 });
  });

  test("applies one retry transition across isolated runner processes", async () => {
    const [store] = await connectPair();
    const action = await enqueueOne(store, "isolated-retry");
    const claim = await store.claimNextAction({ runnerId: "isolated-retry-owner", now: BASE_TIME });
    const config = {
      operation: "fail" as const,
      actionId: action.id,
      runnerId: "isolated-retry-owner",
      fenceToken: claim!.fenceToken,
      now: "2026-08-11T00:00:01.000Z",
      retryBackoffMs: 0,
      retryable: true,
    };
    const results = await Promise.all([runIsolatedRunner(config), runIsolatedRunner(config)]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)?.error).toContain("stale or expired");
    expect(await store.requireQueuedAction(action.id)).toMatchObject({ status: "retrying", attempt: 1 });
  }, 30_000);

  test("deduplicates concurrent failed-only replay and performs one dead-action transition", async () => {
    const [left, right] = await connectPair();
    const action = await enqueueOne(left, "replay", { maxAttempts: 1 });
    const claim = await left.claimNextAction({ runnerId: "runner", now: BASE_TIME });
    await left.failActionFenced({
      actionId: action.id,
      runnerId: "runner",
      fenceToken: claim!.fenceToken,
      now: "2026-08-11T00:00:01.000Z",
      error: { code: "FAILED", message: "failed", retryable: false },
    });

    const replayInput = { sourceRunId: action.automationRunId, mode: "failed-actions" as const, requestedAt: BASE_TIME, metadata: { actionId: action.id } };
    const replayRecords = await Promise.all([left.createReplayRequest(replayInput), right.createReplayRequest(replayInput)]);
    expect(replayRecords[0]!.id).toBe(replayRecords[1]!.id);
    const replayRows = await admin!.unsafe<[{ replay_identity: string }]>("SELECT replay_identity FROM automation_replay_requests WHERE mode='failed-actions'");
    expect(replayRows.map(({ replay_identity }) => ({ replay_identity }))).toEqual([
      { replay_identity: `${action.automationRunId}:failed-actions:${action.id}` },
    ]);

    const transitions = await Promise.allSettled([
      left.requeueDeadAction(action.id, { now: "2026-08-11T00:00:02.000Z" }),
      right.requeueDeadAction(action.id, { now: "2026-08-11T00:00:02.000Z" }),
    ]);
    expect(transitions.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(transitions.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await left.requireQueuedAction(action.id)).toMatchObject({ status: "queued", attempt: 0 });
    const deadReplayCount = await admin!.unsafe<[{ count: string }]>("SELECT count(*)::text AS count FROM automation_replay_requests WHERE mode='dead-actions'");
    expect(deadReplayCount[0]?.count).toBe("1");
  });

  test("deduplicates replay and dead-action requeue across isolated runner processes", async () => {
    const [store] = await connectPair();
    const action = await enqueueOne(store, "isolated-replay", { maxAttempts: 1 });
    const claim = await store.claimNextAction({ runnerId: "isolated-replay-owner", now: BASE_TIME });
    await store.failActionFenced({
      actionId: action.id,
      runnerId: "isolated-replay-owner",
      fenceToken: claim!.fenceToken,
      now: "2026-08-11T00:00:01.000Z",
      error: { code: "FAILED", message: "failed", retryable: false },
    });

    const replayConfig = {
      operation: "create-replay" as const,
      sourceRunId: action.automationRunId,
      mode: "failed-actions" as const,
      requestedAt: BASE_TIME,
      actionId: action.id,
    };
    const replayResults = await Promise.all([
      runIsolatedRunner(replayConfig),
      runIsolatedRunner(replayConfig),
    ]);
    expect(replayResults.every((result) => result.ok)).toBe(true);
    expect(replayResults[0]?.value?.id).toBe(replayResults[1]?.value?.id);
    const failedReplayCount = await admin!.unsafe<[{ count: string }]>(
      "SELECT count(*)::text AS count FROM automation_replay_requests WHERE mode='failed-actions'",
    );
    expect(failedReplayCount[0]?.count).toBe("1");

    const requeueConfig = {
      operation: "requeue-dead" as const,
      actionId: action.id,
      now: "2026-08-11T00:00:02.000Z",
    };
    const requeueResults = await Promise.all([
      runIsolatedRunner(requeueConfig),
      runIsolatedRunner(requeueConfig),
    ]);
    expect(requeueResults.filter((result) => result.ok)).toHaveLength(1);
    expect(requeueResults.filter((result) => !result.ok)).toHaveLength(1);
    expect(await store.requireQueuedAction(action.id)).toMatchObject({ status: "queued", attempt: 0 });
    const deadReplayCount = await admin!.unsafe<[{ count: string }]>(
      "SELECT count(*)::text AS count FROM automation_replay_requests WHERE mode='dead-actions'",
    );
    expect(deadReplayCount[0]?.count).toBe("1");
  }, 30_000);

  test("recovers an abandoned claim by takeover after expiry", async () => {
    const [crashed, survivor] = await connectPair();
    const action = await enqueueOne(crashed, "crash");
    const abandoned = await crashed.claimNextAction({ runnerId: "crashed-process", now: BASE_TIME, leaseMs: 1_000 });
    await crashed.close();
    stores = stores.filter((store) => store !== crashed);

    expect(await survivor.claimNextAction({ runnerId: "survivor", now: "2026-08-11T00:00:00.999Z" })).toBeUndefined();
    const recovered = await survivor.claimNextAction({ runnerId: "survivor", now: "2026-08-11T00:00:01.000Z" });
    expect(recovered!.fenceToken).toBeGreaterThan(abandoned!.fenceToken);
    expect((await survivor.completeActionFenced({ actionId: action.id, runnerId: "survivor", fenceToken: recovered!.fenceToken, now: "2026-08-11T00:00:02.000Z" })).status).toBe("succeeded");
  });
});
