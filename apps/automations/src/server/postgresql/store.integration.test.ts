import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import postgres from "postgres";
import type { AutomationSpec } from "../../types.js";
import { selectServerStorage } from "../index.js";
import { SqliteServerAutomationsStore } from "../sqlite-store.js";
import type { ServerAutomationsStore } from "../store.js";
import {
  POSTGRESQL_EXPIRED_CLAIM_CANDIDATES_SQL,
  POSTGRESQL_READY_CLAIM_CANDIDATES_SQL,
  PostgreSqlServerAutomationsStore,
} from "./store.js";
import { AutomationsStore, LEASE_CANDIDATE_BUDGET } from "../../lib/store.js";

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
    automation_action_step_dependencies,
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

describe("SqliteServerAutomationsStore fenced settlement", () => {
  test("unblocks dependents through the server adapter", async () => {
    const store = new SqliteServerAutomationsStore({ dbPath: ":memory:" });
    try {
      await store.createAutomation(spec("sqlite-fenced-settlement", {
        actions: [
          { id: "required", actionId: "actions.required" },
          { id: "dependent", actionId: "actions.dependent", dependsOn: ["required"] },
        ],
      }));
      const run = await store.createRun({
        id: "sqlite-fenced-settlement-run",
        automationId: "sqlite-fenced-settlement",
        trigger: { kind: "manual" },
      });
      const dependent = await store.admitAction({
        id: "sqlite-fenced-settlement-dependent",
        automationRunId: run.id,
        stepId: "dependent",
        actionId: "actions.dependent",
        availableAt: BASE_TIME,
        invocation: { id: "sqlite-fenced-settlement-dependent-invocation", actionId: "actions.dependent", manifestVersion: "1.0.0", input: {}, requestedAt: BASE_TIME },
      });
      const required = await store.admitAction({
        id: "sqlite-fenced-settlement-required",
        automationRunId: run.id,
        stepId: "required",
        actionId: "actions.required",
        availableAt: BASE_TIME,
        invocation: { id: "sqlite-fenced-settlement-required-invocation", actionId: "actions.required", manifestVersion: "1.0.0", input: {}, requestedAt: BASE_TIME },
      });
      const claim = await store.leaseNextAction({ runnerId: "sqlite-fenced-settlement-runner", now: "2026-08-11T00:00:01.000Z" });
      expect(claim?.id).toBe(required.id);
      await store.completeActionFenced({
        actionId: required.id,
        runnerId: "sqlite-fenced-settlement-runner",
        fencingToken: claim!.fencingToken,
        now: "2026-08-11T00:00:02.000Z",
      });
      expect((await store.leaseNextAction({ runnerId: "sqlite-fenced-settlement-runner", now: "2026-08-11T00:00:03.000Z" }))?.id).toBe(dependent.id);
    } finally {
      await store.close();
    }
  });
});

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
  return store.admitAction({
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
  | { operation: "renew"; actionId: string; runnerId: string; fencingToken: number; now?: string; leaseMs?: number }
  | { operation: "complete"; actionId: string; runnerId: string; fencingToken: number; now?: string }
  | {
      operation: "fail";
      actionId: string;
      runnerId: string;
      fencingToken: number;
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
    expect(await left.status()).toMatchObject({ counts: { automations: 0, runs: 0, queueDepth: 0 } });
    expect(await right.status()).toMatchObject({ dbPath: "postgresql" });
    const ledger = await admin!.unsafe<[{ id: string }]>("SELECT id FROM hasna_automations_schema_migrations");
    expect(ledger.map((row) => row.id)).toEqual([
      "0001_server_schema",
      "0002_scale_indexes",
      "0003_bounded_claim_candidates",
    ]);
  });

  test("upgrades the published 0002 database additively and replays 0003 idempotently", async () => {
    const [first] = await connectPair();
    await first.createAutomation(spec("legacy-edge-preservation", {
      actions: [
        { id: "required", actionId: "actions.required" },
        { id: "dependent", actionId: "actions.dependent" },
      ],
    }));
    await first.createRun({
      id: "legacy-edge-run",
      automationId: "legacy-edge-preservation",
      trigger: { kind: "manual" },
    });
    await admin!.unsafe(`
      INSERT INTO automation_actions (
        id,automation_run_id,step_id,action_id,idempotency_key,status,invocation_json,
        available_at,created_at,updated_at
      ) VALUES
        ('legacy-required','legacy-edge-run','required','actions.required','legacy-required','succeeded','{}'::jsonb,$1,$1,$1),
        ('legacy-dependent','legacy-edge-run','dependent','actions.dependent','legacy-dependent','admitted','{}'::jsonb,$1,$1,$1)
    `, [BASE_TIME]);
    await admin!.unsafe(
      "INSERT INTO automation_action_dependencies (automation_run_id,action_id,dependency_action_id) VALUES ($1,$2,$3)",
      ["legacy-edge-run", "legacy-dependent", "legacy-required"],
    );
    await first.close();
    stores = stores.filter((store) => store !== first);
    await admin!.unsafe("DELETE FROM hasna_automations_schema_migrations WHERE id='0003_bounded_claim_candidates'");
    await admin!.unsafe("DROP TABLE automation_action_step_dependencies");
    await admin!.unsafe(`DROP INDEX
      automation_actions_ready_order_idx,
      automation_actions_expired_lease_order_idx`);
    await admin!.unsafe(`
      CREATE INDEX automation_actions_ready_order_idx ON automation_actions(available_at,created_at,id)
        WHERE status IN ('admitted','admitted');
      CREATE INDEX automation_actions_expired_lease_order_idx ON automation_actions(lease_expires_at,available_at,created_at,id)
        WHERE status='leased' AND lease_expires_at IS NOT NULL;
    `);

    const upgraded = await PostgreSqlServerAutomationsStore.connect(databaseUrl!);
    stores.push(upgraded);
    const ledger = await admin!.unsafe<[{ id: string }]>("SELECT id FROM hasna_automations_schema_migrations ORDER BY id");
    expect(ledger.map((row) => row.id)).toEqual([
      "0001_server_schema",
      "0002_scale_indexes",
      "0003_bounded_claim_candidates",
    ]);
    const indexes = await admin!.unsafe<[{ indexname: string }]>(
      "SELECT indexname FROM pg_indexes WHERE schemaname=current_schema() AND indexname LIKE '%_idx' ORDER BY indexname",
    );
    expect(indexes.map((row) => row.indexname)).toContain("automation_actions_ready_order_idx");
    expect(indexes.map((row) => row.indexname)).toContain("automation_actions_expired_lease_order_idx");
    expect(indexes.map((row) => row.indexname)).toContain("automation_action_step_dependencies_lookup_idx");
    expect(indexes.map((row) => row.indexname)).toContain("automations_active_event_sources_gin_idx");
    expect(indexes.map((row) => row.indexname)).toContain("automations_active_event_source_wildcard_idx");
    const dependencyTable = await admin!.unsafe<[{ relation: string | null }]>(
      "SELECT to_regclass('automation_action_step_dependencies')::text AS relation",
    );
    expect(dependencyTable[0]?.relation).toBe("automation_action_step_dependencies");
    const translatedEdge = await admin!.unsafe<[{ action_step_id: string; dependency_step_id: string }]>(
      `SELECT action_step_id,dependency_step_id
       FROM automation_action_step_dependencies
       WHERE automation_run_id='legacy-edge-run'`,
    );
    expect(translatedEdge).toHaveLength(1);
    expect(translatedEdge[0]).toEqual({ action_step_id: "dependent", dependency_step_id: "required" });
    const translatedCounter = await admin!.unsafe<[{ unmet_dependencies: string }]>(
      "SELECT unmet_dependencies::text FROM automation_actions WHERE id='legacy-dependent'",
    );
    expect(translatedCounter[0]?.unmet_dependencies).toBe("0");

    const replayed = await PostgreSqlServerAutomationsStore.connect(databaseUrl!);
    stores.push(replayed);
    const replayLedger = await admin!.unsafe<[{ id: string }]>("SELECT id FROM hasna_automations_schema_migrations ORDER BY id");
    expect(replayLedger.map((row) => row.id)).toEqual([
      "0001_server_schema",
      "0002_scale_indexes",
      "0003_bounded_claim_candidates",
    ]);
  });

  test("refuses a checksum mismatch in the published 0002 ledger entry", async () => {
    const [first] = await connectPair();
    await first.close();
    stores = stores.filter((store) => store !== first);
    await admin!.unsafe(
      "UPDATE hasna_automations_schema_migrations SET checksum='mismatch' WHERE id='0002_scale_indexes'",
    );

    await expect(PostgreSqlServerAutomationsStore.connect(databaseUrl!))
      .rejects.toThrow("PostgreSQL migration checksum mismatch: 0002_scale_indexes");
  });

  test("keeps one real claim bounded past live claims and orders streams by eligibility", async () => {
    const [store] = await connectPair();
    await store.createAutomation(spec("claim-plan"));
    await store.createRun({
      id: "claim-plan-run",
      automationId: "claim-plan",
      trigger: { kind: "manual" },
    });
    const seedClaimedPopulation = async (futureLive: number, expired: number) => {
      await admin!.unsafe(`
        INSERT INTO automation_actions (
          id,automation_run_id,step_id,action_id,idempotency_key,status,invocation_json,
          attempt,max_attempts,available_at,created_at,updated_at,
          leased_by,leased_at,lease_expires_at,lease_generation
        )
        SELECT
          'plan-action-' || lpad(candidate::text,5,'0'),
          'claim-plan-run',
          'plan-step-' || candidate::text,
          'actions.plan',
          'plan-key-' || candidate::text,
          'leased',
          '{}'::jsonb,
          0,3,
          $1::timestamptz + candidate * interval '1 millisecond',
          $1::timestamptz + candidate * interval '1 millisecond',
          $1::timestamptz + candidate * interval '1 millisecond',
          'plan-runner',
          $1::timestamptz,
          CASE WHEN candidate <= $4::integer THEN $2::timestamptz ELSE $3::timestamptz END,
          1
        FROM generate_series(1,$5::integer) AS candidate
      `, [
        BASE_TIME,
        "2027-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
        futureLive,
        futureLive + expired,
      ]);
    };

    const now = new Date("2026-08-12T00:00:00.000Z");
    await seedClaimedPopulation(100, 100);
    await admin!.unsafe("ANALYZE automation_actions");
    const smallReadyPlan = await explainClaimCandidatePage(
      POSTGRESQL_READY_CLAIM_CANDIDATES_SQL,
      [now, LEASE_CANDIDATE_BUDGET],
    );
    expectBoundedClaimPagePlan(
      smallReadyPlan,
      [],
      0,
    );
    const smallExpiredPlan = await explainClaimCandidatePage(
      POSTGRESQL_EXPIRED_CLAIM_CANDIDATES_SQL,
      [now, LEASE_CANDIDATE_BUDGET],
    );
    expectBoundedClaimPagePlan(
      smallExpiredPlan,
      [],
      100,
      100,
    );

    await admin!.unsafe("DELETE FROM automation_actions");
    await seedClaimedPopulation(10_000, 10_000);
    await admin!.unsafe("ANALYZE automation_actions");
    const readyPlan = await explainClaimCandidatePage(POSTGRESQL_READY_CLAIM_CANDIDATES_SQL, [now, LEASE_CANDIDATE_BUDGET]);
    const readyBuffers = expectBoundedClaimPagePlan(readyPlan, ["automation_actions_ready_order_idx"], 0);
    const expiredPlan = await explainClaimCandidatePage(POSTGRESQL_EXPIRED_CLAIM_CANDIDATES_SQL, [now, LEASE_CANDIDATE_BUDGET]);
    const expiredBuffers = expectBoundedClaimPagePlan(expiredPlan, ["automation_actions_expired_lease_order_idx"], 100);
    expect(readyBuffers).toBeLessThanOrEqual(LEASE_CANDIDATE_BUDGET * 3);
    expect(expiredBuffers).toBeLessThanOrEqual(LEASE_CANDIDATE_BUDGET * 3);

    const claim = await store.leaseNextAction({ runnerId: "successor", now });
    expect(claim?.id).toBe("plan-action-10001");
  }, 30_000);

  test("orders ready and expired claims by the time each became eligible", async () => {
    const [store] = await connectPair();
    const expired = await enqueueOne(store, "mixed-expired");
    const original = await store.leaseNextAction({ runnerId: "expired-owner", now: BASE_TIME, leaseMs: 1_000 });
    expect(original?.id).toBe(expired.id);
    const ready = await enqueueOne(store, "mixed-ready");
    await admin!.unsafe(
      "UPDATE automation_actions SET available_at=$2 WHERE id=$1",
      [ready.id, "2026-08-11T00:00:00.500Z"],
    );

    const recovered = await store.leaseNextAction({
      runnerId: "successor",
      now: "2026-08-11T00:00:01.000Z",
    });
    expect(recovered?.id).toBe(ready.id);
  });

  test("keeps directly enqueued dependents blocked when the required step is absent", async () => {
    const [postgresStore] = await connectPair();
    const sqliteStore = new AutomationsStore({ dbPath: ":memory:" });
    const automation: AutomationSpec = {
      schemaVersion: "1.0",
      id: "direct-dependency-parity",
      name: "direct-dependency-parity",
      version: "1.0.0",
      triggers: [{ kind: "event", source: "test", type: "created" }],
      actions: [
        { id: "required", actionId: "actions.required" },
        { id: "dependent", actionId: "actions.dependent", dependsOn: ["required"] },
      ],
    };
    try {
      sqliteStore.createAutomation(automation);
      await postgresStore.createAutomation(automation);
      const sqliteRun = sqliteStore.createRun({ id: "sqlite-direct-dependency", automationId: automation.id, trigger: { kind: "manual" } });
      const postgresRun = await postgresStore.createRun({ id: "postgres-direct-dependency", automationId: automation.id, trigger: { kind: "manual" } });
      const input = {
        stepId: "dependent",
        actionId: "actions.dependent",
        availableAt: BASE_TIME,
        invocation: {
          id: "direct-dependency-invocation",
          actionId: "actions.dependent",
          manifestVersion: "1.0.0",
          input: {},
          requestedAt: BASE_TIME,
        },
      };
      sqliteStore.admitAction({ ...input, id: "sqlite-direct-dependent", automationRunId: sqliteRun.id });
      await postgresStore.admitAction({ ...input, id: "postgres-direct-dependent", automationRunId: postgresRun.id });
      expect(sqliteStore.leaseNextAction({ runnerId: "sqlite", now: BASE_TIME })).toBeUndefined();
      expect(await postgresStore.leaseNextAction({ runnerId: "postgres", now: BASE_TIME })).toBeUndefined();
    } finally {
      sqliteStore.close();
    }
  });

  test("uses the same ready, expired, and tie sequence in SQLite and PostgreSQL", async () => {
    const [postgresStore] = await connectPair();
    const sqliteStore = new AutomationsStore({ dbPath: ":memory:" });
    const actions = ["ready-first", "expired-second", "tie-a", "tie-b"];
    const automation: AutomationSpec = {
      schemaVersion: "1.0",
      id: "claim-sequence",
      name: "claim-sequence",
      version: "1.0.0",
      triggers: [{ kind: "event", source: "test", type: "created" }],
      actions: actions.map((id) => ({ id, actionId: "actions.work" })),
    };
    try {
      sqliteStore.createAutomation(automation);
      await postgresStore.createAutomation(automation);
      const sqliteRun = sqliteStore.createRun({ id: "sqlite-sequence-run", automationId: automation.id, trigger: { kind: "manual" } });
      const postgresRun = await postgresStore.createRun({ id: "postgres-sequence-run", automationId: automation.id, trigger: { kind: "manual" } });
      for (const id of actions) {
        const input = {
          stepId: id,
          actionId: "actions.work",
          availableAt: BASE_TIME,
          invocation: { id: `inv-${id}`, actionId: "actions.work", manifestVersion: "1.0.0", input: {}, requestedAt: BASE_TIME },
        };
        sqliteStore.admitAction({ ...input, id, automationRunId: sqliteRun.id });
        await postgresStore.admitAction({ ...input, id, automationRunId: postgresRun.id });
      }
      const updates = [
        ["ready-first", "admitted", "2026-08-11T00:00:00.500Z", null],
        ["expired-second", "leased", BASE_TIME, "2026-08-11T00:00:01.000Z"],
        ["tie-a", "leased", "2026-08-11T00:00:02.000Z", "2026-08-11T00:00:02.000Z"],
        ["tie-b", "admitted", "2026-08-11T00:00:02.000Z", null],
      ] as const;
      for (const [id, status, availableAt, leaseExpiresAt] of updates) {
        sqliteStore.db.query(`UPDATE automation_actions
          SET status=$status,available_at=$availableAt,created_at=$createdAt,lease_expires_at=$leaseExpiresAt
          WHERE id=$id`).run({
          $id: id, $status: status, $availableAt: availableAt, $createdAt: "2026-08-11T00:00:00.000Z", $leaseExpiresAt: leaseExpiresAt,
        });
        await admin!.unsafe(`UPDATE automation_actions
          SET status=$2,available_at=$3,created_at=$4,lease_expires_at=$5 WHERE id=$1`,
        [id, status, availableAt, "2026-08-11T00:00:00.000Z", leaseExpiresAt]);
      }
      const sqliteSequence: string[] = [];
      const postgresSequence: string[] = [];
      for (let index = 0; index < actions.length; index += 1) {
        sqliteSequence.push(sqliteStore.leaseNextAction({ runnerId: "sqlite", now: "2026-08-11T00:00:03.000Z" })!.id);
        postgresSequence.push((await postgresStore.leaseNextAction({ runnerId: "postgres", now: "2026-08-11T00:00:03.000Z" }))!.id);
      }
      expect(sqliteSequence).toEqual(["ready-first", "expired-second", "tie-a", "tie-b"]);
      expect(postgresSequence).toEqual(sqliteSequence);
    } finally {
      sqliteStore.close();
    }
  });

  test("returns bounded empty on a concurrency lock and succeeds after release", async () => {
    const [store] = await connectPair();
    await store.createAutomation(spec("claim-concurrency-budget", {
      actions: [{ id: "work", actionId: "actions.work" }],
      concurrency: true,
    }));
    const firstRun = await store.createRun({ id: "concurrency-first-run", automationId: "claim-concurrency-budget", trigger: { kind: "manual" } });
    const secondRun = await store.createRun({ id: "concurrency-second-run", automationId: "claim-concurrency-budget", trigger: { kind: "manual" } });
    for (const [id, runId] of [["concurrency-first", firstRun.id], ["concurrency-second", secondRun.id]]) {
      await store.admitAction({
        id, automationRunId: runId, stepId: "work", actionId: "actions.work", availableAt: BASE_TIME,
        invocation: { id: `inv-${id}`, actionId: "actions.work", manifestVersion: "1.0.0", input: {}, requestedAt: BASE_TIME },
      });
    }
    const first = await store.leaseNextAction({ runnerId: "first", now: BASE_TIME });
    expect(first?.id).toBe("concurrency-first");
    expect(await store.leaseNextAction({ runnerId: "second", now: BASE_TIME })).toBeUndefined();
    await store.completeActionFenced({ actionId: first!.id, runnerId: "first", fencingToken: first!.fencingToken, now: "2026-08-11T00:00:01.000Z" });
    expect((await store.leaseNextAction({ runnerId: "second", now: "2026-08-11T00:00:01.000Z" }))?.id).toBe("concurrency-second");
  });

  test("returns after one fixed approval budget and advances on the next poll", async () => {
    const [store] = await connectPair();
    await store.createAutomation(spec("claim-budget", {
      actions: Array.from({ length: LEASE_CANDIDATE_BUDGET + 2 }, (_, index) => ({
        id: `work-${String(index).padStart(3, "0")}`,
        actionId: "actions.work",
      })),
    }));
    const run = await store.createRun({
      id: "claim-budget-run",
      automationId: "claim-budget",
      trigger: { kind: "manual" },
    });
    for (let index = 0; index < LEASE_CANDIDATE_BUDGET + 1; index += 1) {
      await store.admitAction({
        id: `claim-budget-${String(index).padStart(3, "0")}`,
        automationRunId: run.id,
        stepId: `work-${String(index).padStart(3, "0")}`,
        actionId: "actions.work",
        availableAt: BASE_TIME,
        approvalGate: {
          requirement: { mode: "manual", requiresApproval: true },
          blockedUntilApproved: true,
          decision: { id: `decision-${index}`, status: "pending", requestedAt: BASE_TIME },
        },
        invocation: {
          id: `claim-budget-invocation-${index}`,
          actionId: "actions.work",
          manifestVersion: "1.0.0",
          input: {},
          requestedAt: BASE_TIME,
        },
      });
    }
    const later = await store.admitAction({
      id: "claim-budget-later",
      automationRunId: run.id,
      stepId: `work-${String(LEASE_CANDIDATE_BUDGET + 1).padStart(3, "0")}`,
      actionId: "actions.work",
      availableAt: BASE_TIME,
      invocation: {
        id: "claim-budget-later-invocation",
        actionId: "actions.work",
        manifestVersion: "1.0.0",
        input: {},
        requestedAt: BASE_TIME,
      },
    });
    expect(await store.leaseNextAction({ runnerId: "budget-first", now: BASE_TIME })).toBeUndefined();
    expect((await store.leaseNextAction({ runnerId: "budget-second", now: BASE_TIME }))?.id).toBe(later.id);
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
        const action = await store.admitAction({
          id: "action-parity",
          automationRunId: run.id,
          stepId: "work",
          actionId: "actions.work",
          availableAt: BASE_TIME,
          invocation: { id: "invocation-parity", actionId: "actions.work", manifestVersion: "1.0.0", input: {}, requestedAt: BASE_TIME },
        });
        expect((await store.requireQueueEntry(action.id)).status).toBe("admitted");
        expect(await store.listQueueEntries()).toHaveLength(2);
        const claim = await store.leaseNextAction({ runnerId: "parity", now: "2026-08-11T00:00:01.000Z" });
        expect(claim?.fencingToken).toBeGreaterThan(0);
        await store.renewActionLease({ actionId: claim!.id, runnerId: "parity", fencingToken: claim!.fencingToken, now: "2026-08-11T00:00:02.000Z" });
        expect((await store.completeActionFenced({ actionId: claim!.id, runnerId: "parity", fencingToken: claim!.fencingToken, now: "2026-08-11T00:00:03.000Z", result: { summary: "done" } })).status).toBe("succeeded");

        const replay = await store.createReplayRequest({ id: "replay-parity", sourceRunId: run.id, mode: "failed-actions", requestedAt: BASE_TIME });
        expect((await store.requireReplayRequest(replay.id)).mode).toBe("failed-actions");
        const lease = await store.heartbeatDaemon({ leaseId: "daemon:parity", now: new Date(BASE_TIME), ttlMs: 10_000 });
        expect((await store.latestDaemonLease())?.id).toBe(lease.id);
        expect(await store.listDeadLetterActions()).toHaveLength(0);
        expect(await store.status(new Date("2026-08-11T00:00:05.000Z"))).toMatchObject({
          counts: { automations: 1, runs: 2, queueDepth: 2, admitted: 2, leased: 0, terminal: 0, deadLetter: 0, replayRequests: 1, webhookRoutes: 1 },
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
    expect(await left.listQueueEntries()).toHaveLength(2);

    const claims = await Promise.all([
      left.leaseNextAction({ runnerId: "left", now: "2026-08-11T00:00:01.000Z" }),
      right.leaseNextAction({ runnerId: "right", now: "2026-08-11T00:00:01.000Z" }),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)?.stepId).toBe("first");
  });

  test("serializes dependency enqueue and prerequisite completion across two connections", async () => {
    const [left, right] = await connectPair();
    const dependencySpec = spec("dependency-race", {
      actions: [
        { id: "required", actionId: "actions.required" },
        { id: "dependent", actionId: "actions.dependent", dependsOn: ["required"] },
      ],
    });
    await left.createAutomation(dependencySpec);

    const insertRaceRun = await left.createRun({
      id: "run-dependency-insert-race",
      automationId: dependencySpec.id,
      trigger: { kind: "manual" },
    });
    await Promise.all([
      left.admitAction({
        id: "action-dependency-insert-race-required",
        automationRunId: insertRaceRun.id,
        stepId: "required",
        actionId: "actions.required",
        status: "succeeded",
        availableAt: BASE_TIME,
        invocation: {
          id: "invocation-dependency-insert-race-required",
          actionId: "actions.required",
          manifestVersion: "1.0.0",
          input: {},
          requestedAt: BASE_TIME,
        },
      }),
      right.admitAction({
        id: "action-dependency-insert-race-dependent",
        automationRunId: insertRaceRun.id,
        stepId: "dependent",
        actionId: "actions.dependent",
        availableAt: BASE_TIME,
        invocation: {
          id: "invocation-dependency-insert-race-dependent",
          actionId: "actions.dependent",
          manifestVersion: "1.0.0",
          input: {},
          requestedAt: BASE_TIME,
        },
      }),
    ]);
    const insertRaceCounter = await admin!.unsafe<[{ unmet_dependencies: number }]>(
      "SELECT unmet_dependencies FROM automation_actions WHERE id=$1",
      ["action-dependency-insert-race-dependent"],
    );
    expect(Number(insertRaceCounter[0]?.unmet_dependencies)).toBe(0);
    expect((await right.leaseNextAction({ runnerId: "dependency-insert-race", now: "2026-08-11T00:00:01.000Z" }))?.id)
      .toBe("action-dependency-insert-race-dependent");

    const completionRaceRun = await left.createRun({
      id: "run-dependency-completion-race",
      automationId: dependencySpec.id,
      trigger: { kind: "manual" },
    });
    const required = await left.admitAction({
      id: "action-dependency-completion-race-required",
      automationRunId: completionRaceRun.id,
      stepId: "required",
      actionId: "actions.required",
      availableAt: BASE_TIME,
      invocation: {
        id: "invocation-dependency-completion-race-required",
        actionId: "actions.required",
        manifestVersion: "1.0.0",
        input: {},
        requestedAt: BASE_TIME,
      },
    });
    const claim = await left.leaseNextAction({ runnerId: "dependency-completion-race", now: BASE_TIME });
    expect(claim?.id).toBe(required.id);
    await Promise.all([
      right.admitAction({
        id: "action-dependency-completion-race-dependent",
        automationRunId: completionRaceRun.id,
        stepId: "dependent",
        actionId: "actions.dependent",
        availableAt: BASE_TIME,
        invocation: {
          id: "invocation-dependency-completion-race-dependent",
          actionId: "actions.dependent",
          manifestVersion: "1.0.0",
          input: {},
          requestedAt: BASE_TIME,
        },
      }),
      left.completeActionFenced({
        actionId: required.id,
        runnerId: "dependency-completion-race",
        fencingToken: claim!.fencingToken,
        now: "2026-08-11T00:00:02.000Z",
      }),
    ]);
    const completionRaceCounter = await admin!.unsafe<[{ unmet_dependencies: number }]>(
      "SELECT unmet_dependencies FROM automation_actions WHERE id=$1",
      ["action-dependency-completion-race-dependent"],
    );
    expect(Number(completionRaceCounter[0]?.unmet_dependencies)).toBe(0);
    expect((await right.leaseNextAction({ runnerId: "dependency-completion-race", now: "2026-08-11T00:00:03.000Z" }))?.id)
      .toBe("action-dependency-completion-race-dependent");
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
      expect(completed[0]).toMatchObject({ actionId: action.id, fencingToken: 1, status: "succeeded" });
      expect(await store.requireQueueEntry(action.id)).toMatchObject({ status: "succeeded", attempt: 0 });
      const persisted = await admin!.unsafe<[{ lease_generation: string }]>(
        "SELECT lease_generation::text FROM automation_actions WHERE id=$1",
        [action.id],
      );
      expect(persisted[0]?.lease_generation).toBe("1");
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
    expect(originalResult.value).toMatchObject({ id: action.id, fencingToken: 1 });
    const originalFence = Number(originalResult.value?.fencingToken);

    const renewed = await runIsolatedRunner({
      operation: "renew",
      actionId: action.id,
      runnerId: "isolated-original",
      fencingToken: originalFence,
      now: "2026-08-11T00:00:00.500Z",
      leaseMs: 2_000,
    });
    expect(renewed.ok).toBe(true);
    expect(renewed.value).toMatchObject({
      id: action.id,
      fencingToken: originalFence,
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
      fencingToken: originalFence + 1,
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
    expect(takeover.value).toMatchObject({ id: action.id, fencingToken: originalFence + 1 });

    const staleCompletion = await runIsolatedRunner({
      operation: "complete",
      actionId: action.id,
      runnerId: "isolated-original",
      fencingToken: originalFence,
      now: "2026-08-11T00:00:03.000Z",
    });
    expect(staleCompletion).toMatchObject({ ok: false });
    expect(staleCompletion.error).toContain("stale or expired");

    const acceptedCompletion = await runIsolatedRunner({
      operation: "complete",
      actionId: action.id,
      runnerId: "isolated-takeover",
      fencingToken: originalFence + 1,
      now: "2026-08-11T00:00:03.000Z",
    });
    expect(acceptedCompletion).toMatchObject({ ok: true, value: { id: action.id, status: "succeeded" } });
  }, 30_000);

  test("requires owner and fence, then rejects stale same-runner mutations after takeover", async () => {
    const [left, right] = await connectPair();
    const action = await enqueueOne(left, "fence");
    const original = await left.leaseNextAction({ runnerId: "runner", now: BASE_TIME, leaseMs: 1_000 });
    expect(original?.id).toBe(action.id);
    expect(await right.leaseNextAction({ runnerId: "runner", now: "2026-08-11T00:00:00.999Z" })).toBeUndefined();
    await expect(right.renewActionLease({ actionId: action.id, runnerId: "other", fencingToken: original!.fencingToken, now: "2026-08-11T00:00:00.500Z" })).rejects.toThrow("stale or expired");
    await expect(right.renewActionLease({ actionId: action.id, runnerId: "runner", fencingToken: original!.fencingToken + 1, now: "2026-08-11T00:00:00.500Z" })).rejects.toThrow("stale or expired");

    const takeover = await right.leaseNextAction({ runnerId: "runner", now: "2026-08-11T00:00:01.000Z", leaseMs: 10_000 });
    expect(takeover!.fencingToken).toBeGreaterThan(original!.fencingToken);
    await expect(left.renewActionLease({ actionId: action.id, runnerId: "runner", fencingToken: original!.fencingToken, now: "2026-08-11T00:00:02.000Z" })).rejects.toThrow("stale or expired");
    await expect(left.completeActionFenced({ actionId: action.id, runnerId: "runner", fencingToken: original!.fencingToken, now: "2026-08-11T00:00:02.000Z" })).rejects.toThrow("stale or expired");
    await expect(left.failActionFenced({ actionId: action.id, runnerId: "runner", fencingToken: original!.fencingToken, now: "2026-08-11T00:00:02.000Z", error: { code: "STALE", message: "stale" } })).rejects.toThrow("stale or expired");
    expect((await right.completeActionFenced({ actionId: action.id, runnerId: "runner", fencingToken: takeover!.fencingToken, now: "2026-08-11T00:00:02.000Z" })).status).toBe("succeeded");
  });

  test("increments retry exactly once under concurrent failure", async () => {
    const [left, right] = await connectPair();
    const action = await enqueueOne(left, "retry");
    const claim = await left.leaseNextAction({ runnerId: "runner", now: BASE_TIME });
    const options = {
      actionId: action.id,
      runnerId: "runner",
      fencingToken: claim!.fencingToken,
      now: "2026-08-11T00:00:01.000Z",
      retryBackoffMs: 0,
      error: { code: "RETRY", message: "retry", retryable: true },
    } as const;
    const attempts = await Promise.allSettled([left.failActionFenced(options), right.failActionFenced(options)]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await left.requireQueueEntry(action.id)).toMatchObject({ status: "admitted", attempt: 1 });
  });

  test("applies one retry transition across isolated runner processes", async () => {
    const [store] = await connectPair();
    const action = await enqueueOne(store, "isolated-retry");
    const claim = await store.leaseNextAction({ runnerId: "isolated-retry-owner", now: BASE_TIME });
    const config = {
      operation: "fail" as const,
      actionId: action.id,
      runnerId: "isolated-retry-owner",
      fencingToken: claim!.fencingToken,
      now: "2026-08-11T00:00:01.000Z",
      retryBackoffMs: 0,
      retryable: true,
    };
    const results = await Promise.all([runIsolatedRunner(config), runIsolatedRunner(config)]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)?.error).toContain("stale or expired");
    expect(await store.requireQueueEntry(action.id)).toMatchObject({ status: "admitted", attempt: 1 });
  }, 30_000);

  test("deduplicates concurrent failed-only replay and performs one dead-action transition", async () => {
    const [left, right] = await connectPair();
    const action = await enqueueOne(left, "replay", { maxAttempts: 1 });
    const claim = await left.leaseNextAction({ runnerId: "runner", now: BASE_TIME });
    await left.failActionFenced({
      actionId: action.id,
      runnerId: "runner",
      fencingToken: claim!.fencingToken,
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
      left.readmitDeadAction(action.id, { now: "2026-08-11T00:00:02.000Z" }),
      right.readmitDeadAction(action.id, { now: "2026-08-11T00:00:02.000Z" }),
    ]);
    expect(transitions.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(transitions.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await left.requireQueueEntry(action.id)).toMatchObject({ status: "admitted", attempt: 0 });
    const deadReplayCount = await admin!.unsafe<[{ count: string }]>("SELECT count(*)::text AS count FROM automation_replay_requests WHERE mode='dead-actions'");
    expect(deadReplayCount[0]?.count).toBe("1");
  });

  test("deduplicates replay and dead-action requeue across isolated runner processes", async () => {
    const [store] = await connectPair();
    const action = await enqueueOne(store, "isolated-replay", { maxAttempts: 1 });
    const claim = await store.leaseNextAction({ runnerId: "isolated-replay-owner", now: BASE_TIME });
    await store.failActionFenced({
      actionId: action.id,
      runnerId: "isolated-replay-owner",
      fencingToken: claim!.fencingToken,
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
    expect(await store.requireQueueEntry(action.id)).toMatchObject({ status: "admitted", attempt: 0 });
    const deadReplayCount = await admin!.unsafe<[{ count: string }]>(
      "SELECT count(*)::text AS count FROM automation_replay_requests WHERE mode='dead-actions'",
    );
    expect(deadReplayCount[0]?.count).toBe("1");
  }, 30_000);

  test("recovers an abandoned claim by takeover after expiry", async () => {
    const [crashed, survivor] = await connectPair();
    const action = await enqueueOne(crashed, "crash");
    const abandoned = await crashed.leaseNextAction({ runnerId: "crashed-process", now: BASE_TIME, leaseMs: 1_000 });
    await crashed.close();
    stores = stores.filter((store) => store !== crashed);

    expect(await survivor.leaseNextAction({ runnerId: "survivor", now: "2026-08-11T00:00:00.999Z" })).toBeUndefined();
    const recovered = await survivor.leaseNextAction({ runnerId: "survivor", now: "2026-08-11T00:00:01.000Z" });
    expect(recovered!.fencingToken).toBeGreaterThan(abandoned!.fencingToken);
    expect((await survivor.completeActionFenced({ actionId: action.id, runnerId: "survivor", fencingToken: recovered!.fencingToken, now: "2026-08-11T00:00:02.000Z" })).status).toBe("succeeded");
  });
});

async function explainClaimCandidatePage(
  query: string,
  parameters: unknown[],
): Promise<Record<string, unknown>> {
  const rows = await admin!.unsafe<[{ "QUERY PLAN": unknown }]>(
    `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${query}`,
    parameters as never[],
  );
  const document = rows[0]?.["QUERY PLAN"] as Array<{ Plan?: Record<string, unknown> }> | undefined;
  if (!document?.[0]?.Plan) throw new Error("missing PostgreSQL claim candidate query plan");
  return document[0].Plan;
}

function expectBoundedClaimPagePlan(
  plan: Record<string, unknown>,
  indexNames: string[],
  expectedRows: number,
  maxRowsRemoved = 0,
): number {
  const nodes = collectPlanNodes(plan);
  for (const indexName of indexNames) {
    const target = nodes.find((node) => node["Index Name"] === indexName);
    expect(target?.["Node Type"]).toBe("Index Only Scan");
  }
  expect(plan["Actual Rows"]).toBe(expectedRows);
  const buffers = Number(plan["Shared Hit Blocks"] ?? 0) + Number(plan["Shared Read Blocks"] ?? 0);
  expect(buffers).toBeLessThanOrEqual(250);
  expect(nodes.reduce((total, node) => total + Number(node["Rows Removed by Filter"] ?? 0), 0)).toBeLessThanOrEqual(maxRowsRemoved);
  return buffers;
}

function collectPlanNodes(plan: Record<string, unknown>): Record<string, unknown>[] {
  const children = Array.isArray(plan.Plans) ? plan.Plans as Record<string, unknown>[] : [];
  return [plan, ...children.flatMap(collectPlanNodes)];
}

describePostgreSql("PostgreSqlServerAutomationsStore.ensureAutomation", () => {
  test("inserts a new automation when the id is absent", async () => {
    const store = await PostgreSqlServerAutomationsStore.connect(databaseUrl!);
    stores.push(store);
    const installed = await store.ensureAutomation(spec("pg-ensure-absent"));
    expect(installed.id).toBe("pg-ensure-absent");
    expect((await store.listAutomations()).length).toBe(1);
  });

  test("is idempotent for identical content and never duplicates the row", async () => {
    const store = await PostgreSqlServerAutomationsStore.connect(databaseUrl!);
    stores.push(store);
    const first = await store.ensureAutomation(spec("pg-ensure-idempotent"));
    const second = await store.ensureAutomation(spec("pg-ensure-idempotent"));
    expect(second.id).toBe(first.id);
    expect((await store.listAutomations()).length).toBe(1);
  });

  test("refuses conflicting content without mutating the existing row", async () => {
    const store = await PostgreSqlServerAutomationsStore.connect(databaseUrl!);
    stores.push(store);
    await store.ensureAutomation(spec("pg-ensure-conflict"));
    const conflicting = spec("pg-ensure-conflict", { actions: [{ id: "only", actionId: "actions.only" }] });
    await expect(store.ensureAutomation(conflicting)).rejects.toThrow(/immutable template installs cannot overwrite/);
    const rows = await store.listAutomations();
    expect(rows.length).toBe(1);
    expect(rows[0].spec.actions).toHaveLength(2);
  });
});
