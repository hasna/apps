import { expect, test } from "bun:test";
import { SQL } from "bun";
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalDigest } from "../src/canonical.js";
import {
  EFFECT_JOURNAL_OUTCOME_SCHEMA_DIGEST,
  EFFECT_JOURNAL_OUTCOME_SCHEMA_VERSION,
} from "../src/effect-journal.js";
import { InMemorySandboxRepositoryV1 } from "../src/repository-memory.js";
import {
  POSTGRES_SCHEMA_MIGRATIONS_V1,
  PostgresSandboxRepositoryV1,
  type PostgresClientV1,
  type PostgresMigrationOptionsV1,
  type PostgresRepositoryConnectOptionsV1,
  type PostgresSessionV1,
} from "../src/repository-postgres.js";
import { SqliteSandboxRepositoryV1 } from "../src/repository-sqlite.js";
import type { SandboxRepositoryTxV1, SandboxRepositoryV1 } from "../src/repository.js";
import {
  activationRequestDigest,
  createRequestDigest,
  lifecycleRecordRequestDigest,
} from "../src/service.js";
import {
  SCHEMA_VERSION,
  type ExternalOperationAnchorRecordV1,
  type OperationRecordV1,
  type SandboxEventV1,
  type SandboxV1,
} from "../src/types.js";
import {
  activationGrant,
  checkpointReceipt,
  cleanupGrant,
  context,
  createInput,
  digest,
  harness,
  type Harness,
  lifecycleContext,
  oid,
} from "./fixtures.js";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(
      `${name} is required; run this live corpus through scripts/postgres-integration.sh`,
    );
  }
  return value;
}

const config = {
  migrationUrl: requiredEnvironment("SANDBOXES_POSTGRES_MIGRATION_URL"),
  runtimeUrl: requiredEnvironment("SANDBOXES_POSTGRES_RUNTIME_URL"),
  database: requiredEnvironment("SANDBOXES_POSTGRES_DATABASE"),
  migrationRole: requiredEnvironment("SANDBOXES_POSTGRES_MIGRATION_ROLE"),
  runtimeRole: requiredEnvironment("SANDBOXES_POSTGRES_RUNTIME_ROLE"),
  tlsCa: readFileSync(requiredEnvironment("SANDBOXES_POSTGRES_TLS_CA_FILE")),
};

interface BunSqlLike {
  unsafe(statement: string, parameters?: unknown[]): Promise<unknown[]>;
  begin<T>(fn: (transaction: BunSqlLike) => Promise<T>): Promise<T>;
  close(options?: { timeout?: number }): Promise<void>;
}

class TestPostgresSession implements PostgresSessionV1 {
  readonly #sql: BunSqlLike;

  constructor(sql: BunSqlLike) {
    this.#sql = sql;
  }

  async query<Row extends Record<string, unknown>>(
    statement: string,
    parameters: readonly unknown[] = [],
  ): Promise<Row[]> {
    return await this.#sql.unsafe(statement, [...parameters]) as Row[];
  }
}

class TestPostgresClient extends TestPostgresSession implements PostgresClientV1 {
  readonly #sql: BunSqlLike;

  constructor(url: string, tlsCa: Uint8Array) {
    const parsed = new URL(url);
    const sql = new SQL({
      url,
      tls: {
        ca: tlsCa,
        serverName: parsed.hostname,
        rejectUnauthorized: true,
      },
      // These short-lived fixture clients run serially. A single connection
      // avoids closing an eagerly expanding TLS pool while handshakes are live.
      max: 1,
      idleTimeout: 1,
    }) as unknown as BunSqlLike;
    super(sql);
    this.#sql = sql;
  }

  async transaction<T>(fn: (session: PostgresSessionV1) => Promise<T>): Promise<T> {
    return await this.#sql.begin(async (transaction) =>
      await fn(new TestPostgresSession(transaction))
    );
  }

  async close(): Promise<void> {
    await this.#sql.close({ timeout: 0 });
  }
}

class InsecureReadyClient implements PostgresClientV1 {
  readonly #role: string;
  readonly #database: string;

  constructor(role: string, database: string) {
    this.#role = role;
    this.#database = database;
  }

  async query<Row extends Record<string, unknown>>(
    statement: string,
    parameters: readonly unknown[] = [],
  ): Promise<Row[]> {
    if (statement.includes("current_user")) {
      return [{
        current_user: this.#role,
        current_database: this.#database,
        ssl: "on",
        ssl_in_use: false,
        can_create: false,
        can_create_database: false,
        can_create_temporary: false,
        member_of_schema_owner: false,
        can_mutate_migrations: false,
      }] as unknown as Row[];
    }
    if (statement.includes("schema_migrations") && statement.includes("ORDER BY version")) {
      return POSTGRES_SCHEMA_MIGRATIONS_V1.map((migration) => ({ ...migration })) as unknown as Row[];
    }
    if (statement.includes("schema_migrations") && statement.includes("WHERE version = $1")) {
      const version = Number(parameters[0]);
      const migration = POSTGRES_SCHEMA_MIGRATIONS_V1.find(
        (candidate) => candidate.version === version,
      );
      return (migration === undefined ? [] : [{ checksum_sha256: migration.checksum_sha256 }]) as unknown as Row[];
    }
    return [];
  }

  async transaction<T>(fn: (session: PostgresSessionV1) => Promise<T>): Promise<T> {
    return await fn(this);
  }

  async close(): Promise<void> {}
}

class InjectedFailureClient implements PostgresClientV1 {
  readonly #delegate: PostgresClientV1;
  failPattern: RegExp | undefined;

  constructor(delegate: PostgresClientV1) {
    this.#delegate = delegate;
  }

  async query<Row extends Record<string, unknown>>(
    statement: string,
    parameters: readonly unknown[] = [],
  ): Promise<Row[]> {
    return await this.#delegate.query<Row>(statement, parameters);
  }

  async transaction<T>(fn: (session: PostgresSessionV1) => Promise<T>): Promise<T> {
    return await this.#delegate.transaction(async (session) => await fn({
      query: async <Row extends Record<string, unknown>>(
        statement: string,
        parameters: readonly unknown[] = [],
      ): Promise<Row[]> => {
        if (this.failPattern?.test(statement) === true) {
          throw new Error("injected crash between event and outbox persistence");
        }
        return await session.query<Row>(statement, parameters);
      },
    }));
  }

  async close(): Promise<void> {
    await this.#delegate.close();
  }
}

class RetryInjectingClient implements PostgresClientV1 {
  readonly #delegate: PostgresClientV1;
  readonly #sqlState: "40001" | "40P01";
  #remainingFailures: number;
  transactionAttempts = 0;

  constructor(
    delegate: PostgresClientV1,
    sqlState: "40001" | "40P01",
    failureCount: number,
  ) {
    this.#delegate = delegate;
    this.#sqlState = sqlState;
    this.#remainingFailures = failureCount;
  }

  async query<Row extends Record<string, unknown>>(
    statement: string,
    parameters: readonly unknown[] = [],
  ): Promise<Row[]> {
    return await this.#delegate.query<Row>(statement, parameters);
  }

  async transaction<T>(fn: (session: PostgresSessionV1) => Promise<T>): Promise<T> {
    this.transactionAttempts += 1;
    return await this.#delegate.transaction(async (session) => await fn({
      query: async <Row extends Record<string, unknown>>(
        statement: string,
        parameters: readonly unknown[] = [],
      ): Promise<Row[]> => {
        if (
          this.#remainingFailures > 0 &&
          statement.includes("SELECT clock_timestamp() AS database_time")
        ) {
          this.#remainingFailures -= 1;
          throw Object.assign(new Error(`injected Postgres ${this.#sqlState}`), {
            errno: this.#sqlState,
          });
        }
        return await session.query<Row>(statement, parameters);
      },
    }));
  }

  async close(): Promise<void> {
    await this.#delegate.close();
  }
}

function identifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) {
    throw new Error("Postgres fixture identifier is not safe");
  }
  return `"${value}"`;
}

async function provisionRuntimeRole(client: PostgresClientV1): Promise<void> {
  const runtime = identifier(config.runtimeRole);
  const database = identifier(config.database);
  await client.query("REVOKE ALL ON SCHEMA sandboxes FROM PUBLIC");
  await client.query(`REVOKE CREATE ON SCHEMA sandboxes FROM ${runtime}`);
  await client.query(`REVOKE CREATE, TEMPORARY ON DATABASE ${database} FROM PUBLIC`);
  await client.query(`REVOKE CREATE, TEMPORARY ON DATABASE ${database} FROM ${runtime}`);
  await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${runtime}`);
  await client.query(`GRANT USAGE ON SCHEMA sandboxes TO ${runtime}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA sandboxes TO ${runtime}`);
  await client.query(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON sandboxes.schema_migrations FROM ${runtime}`);
  await client.query(`GRANT SELECT ON sandboxes.schema_migrations TO ${runtime}`);
  await client.query(`REVOKE UPDATE, DELETE, TRUNCATE ON
    sandboxes.capability_uses,
    sandboxes.activation_grant_uses,
    sandboxes.cleanup_grant_uses,
    sandboxes.sandbox_events,
    sandboxes.external_journal_frontiers,
    sandboxes.external_read_probe_anchors,
    sandboxes.effect_journal_records,
    sandboxes.immutable_checkpoint_receipts,
    sandboxes.immutable_git_promotion_receipts,
    sandboxes.safety_fence_observations,
    sandboxes.destroy_tombstones,
    sandboxes.checkpoint_blobs,
    sandboxes.exec_frames
    FROM ${runtime}`);
}

function plusMilliseconds(value: Date, milliseconds: number): string {
  return new Date(value.getTime() + milliseconds).toISOString();
}

function controlledDatabaseTime(
  delegate: SandboxRepositoryV1,
  initial: Date,
): { repository: SandboxRepositoryV1; advance(milliseconds: number): void } {
  let current = new Date(initial.getTime());
  const readCurrent = (): Date => {
    const value = new Date(current.getTime());
    current = new Date(current.getTime() + 1);
    return value;
  };
  const repository: SandboxRepositoryV1 = {
    get backend() { return delegate.backend; },
    migrate: () => delegate.migrate(),
    databaseTime: async () => readCurrent(),
    transaction: async <T>(fn: (tx: SandboxRepositoryTxV1) => T): Promise<T> =>
      await delegate.transaction((tx) => fn(new Proxy(tx, {
        get(target, property, receiver) {
          if (property === "databaseTime") {
            return () => readCurrent();
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }))),
    health: () => delegate.health(),
    close: () => delegate.close(),
  };
  return {
    repository,
    advance(milliseconds: number) {
      current = new Date(current.getTime() + milliseconds);
    },
  };
}

function journalRecords(
  operationId: string,
  operationStepId: string,
  now: Date,
  firstSequence: bigint,
  priorFrontierDigest: ReturnType<typeof digest>,
) {
  const base = {
    schema_version: SCHEMA_VERSION,
    operation_id: operationId,
    operation_step_id: operationStepId,
    operation_execution_epoch: 1n,
    journal_sequence: firstSequence,
    prior_frontier_digest: priorFrontierDigest,
    record_digest: digest("live-journal-dispatch-record-1"),
    frontier_digest: digest("live-journal-frontier-1"),
    envelope_digest: digest("live-journal-dispatch-envelope-1"),
    outcome_schema_version: EFFECT_JOURNAL_OUTCOME_SCHEMA_VERSION,
    outcome_schema_digest: EFFECT_JOURNAL_OUTCOME_SCHEMA_DIGEST,
    recorded_at: now.toISOString(),
  } as const;
  const dispatched: ExternalOperationAnchorRecordV1 = {
    ...base,
    record_kind: "DISPATCHED",
  };
  const outcome: ExternalOperationAnchorRecordV1 = {
    ...base,
    record_kind: "OUTCOME",
    outcome_kind: "failed_no_effect",
    journal_sequence: firstSequence + 1n,
    prior_frontier_digest: dispatched.frontier_digest,
    record_digest: digest("live-journal-outcome-record-1"),
    frontier_digest: digest("live-journal-frontier-outcome-1"),
    envelope_digest: digest("live-journal-outcome-envelope-1"),
  };
  const next: ExternalOperationAnchorRecordV1 = {
    ...dispatched,
    operation_execution_epoch: 2n,
    journal_sequence: firstSequence + 2n,
    prior_frontier_digest: outcome.frontier_digest,
    record_digest: digest("live-journal-dispatch-record-2"),
    frontier_digest: digest("live-journal-frontier-2"),
    envelope_digest: digest("live-journal-dispatch-envelope-2"),
  };
  return { dispatched, outcome, next };
}

async function createActive(repository: SandboxRepositoryV1, now: Date) {
  const h = harness(repository);
  const input = createInput(plusMilliseconds(now, 60_000));
  const createDigest = createRequestDigest(input);
  const beginCreate = context(
    "begin_create_inert",
    oid("op", 20),
    createDigest,
    1n,
    0,
    1n,
    20,
    undefined,
    undefined,
    now,
    input,
  );
  const creating = await h.service.create(input, beginCreate);
  if (creating.pending_provider_outcome?.target_state !== "inert") {
    throw new Error("create corpus did not produce an inert provider outcome");
  }
  const recordInertOperation = oid("op", 120);
  const recordInertDigest = lifecycleRecordRequestDigest(
    "record_inert",
    creating.id,
    creating.pending_provider_outcome.evidence_sha256,
  );
  const inert = await h.service.recordInert(
    creating.id,
    creating.pending_provider_outcome.evidence_sha256,
    lifecycleContext(
      "record_inert",
      recordInertOperation,
      recordInertDigest,
      creating.resource_lifecycle_generation,
      creating.revision,
      2n,
      120,
      now,
    ),
  );

  const grant = {
    ...activationGrant(inert),
    expires_at: plusMilliseconds(now, 300_000),
  };
  if (inert.immutable_fingerprint_sha256 === undefined) {
    throw new Error("activation corpus has no immutable provider fingerprint");
  }
  const activationDigest = activationRequestDigest(
    inert.id,
    inert.spec.network_policy.policy_sha256,
  );
  const beginActivation = context(
    "begin_activate",
    grant.operation_id,
    activationDigest,
    inert.resource_lifecycle_generation,
    inert.revision,
    2n,
    21,
    inert.immutable_fingerprint_sha256,
    canonicalDigest({ id: grant.grant_id, nonce: grant.one_use_nonce_sha256 }),
    now,
    input,
  );
  const activating = await h.service.activate(inert.id, grant, beginActivation);
  if (activating.pending_provider_outcome?.target_state !== "active") {
    throw new Error("activation corpus did not produce an active provider outcome");
  }
  const recordActiveOperation = oid("op", 121);
  const recordActiveDigest = lifecycleRecordRequestDigest(
    "record_active",
    activating.id,
    activating.pending_provider_outcome.evidence_sha256,
  );
  const active = await h.service.recordActive(
    activating.id,
    activating.pending_provider_outcome.evidence_sha256,
    lifecycleContext(
      "record_active",
      recordActiveOperation,
      recordActiveDigest,
      activating.resource_lifecycle_generation,
      activating.revision,
      3n,
      121,
      now,
    ),
  );
  return { h, active, createBinding: input };
}

async function destroyWithCheckpoint(
  h: Harness,
  sandbox: SandboxV1,
  now: Date,
  createBinding: ReturnType<typeof createInput>,
) {
  const receiptTemplate = checkpointReceipt(sandbox);
  const receipt = {
    ...receiptTemplate,
    durable_at: now.toISOString(),
    fence: {
      ...receiptTemplate.fence,
      authority_epoch: sandbox.authority_epoch,
      route_lineage_id: sandbox.route_lineage_id,
      route_id: sandbox.route_id,
      route_epoch: sandbox.route_epoch,
      run_id: sandbox.run_id,
      attempt_id: sandbox.attempt_id,
      attempt_lease_id: sandbox.attempt_lease_id,
      lease_epoch: sandbox.lease_epoch,
      resource_lease_id: sandbox.resource_lease_id,
      resource_id: sandbox.id,
      resource_lifecycle_generation: sandbox.resource_lifecycle_generation,
      operation_execution_epoch: sandbox.operation_execution_epoch,
      actor_principal: sandbox.actor_principal,
      lease_holder_principal: sandbox.lease_holder_principal,
      operation_executor_principal: sandbox.operation_executor_principal,
      audience: sandbox.audience,
      issued_at: plusMilliseconds(now, -60_000),
      lease_expires_at: plusMilliseconds(now, 3_600_000),
      operation_execution_expires_at: plusMilliseconds(now, 300_000),
    },
  };
  const checkpointed = await h.service.recordCheckpointReceipt(sandbox.id, receipt);
  const promotion = {
    schema_version: checkpointed.schema_version,
    receipt_id: oid("receipt", 171),
    resource_id: checkpointed.id,
    run_id: checkpointed.run_id,
    attempt_id: checkpointed.attempt_id,
    resource_lifecycle_generation: checkpointed.resource_lifecycle_generation,
    fence: receipt.fence,
    receipt_sha256: digest("live-promotion-receipt-171"),
    checkpoint_root_sha256: receipt.checkpoint_root_sha256,
    expected_base_sha256: digest("live-promotion-base-171"),
    promoted_at: now.toISOString(),
  };
  const promoted = await h.service.recordGitPromotionReceipt(checkpointed.id, promotion);
  const grant = {
    ...cleanupGrant(promoted, {
      kind: "checkpoint_durable" as const,
      receipt_sha256: receipt.receipt_sha256,
    }),
    expires_at: plusMilliseconds(now, 300_000),
  };
  if (promoted.immutable_fingerprint_sha256 === undefined) {
    throw new Error("destroy corpus has no immutable provider fingerprint");
  }
  const destroyContext = context(
    "begin_destroy",
    grant.operation_id,
    grant.operation_digest,
    promoted.resource_lifecycle_generation,
    promoted.revision,
    4n,
    40,
    promoted.immutable_fingerprint_sha256,
    canonicalDigest({ id: grant.grant_id, nonce: grant.one_use_nonce_sha256 }),
    now,
    createBinding,
  );
  const destroying = await h.service.destroy(promoted.id, grant, destroyContext);
  if (destroying.pending_provider_outcome?.target_state !== "destroyed") {
    throw new Error("destroy corpus did not produce a terminal provider outcome");
  }
  const recordOperation = oid("op", 140);
  const recordDigest = lifecycleRecordRequestDigest(
    "record_destroyed",
    destroying.id,
    destroying.pending_provider_outcome.evidence_sha256,
  );
  const destroyed = await h.service.recordDestroyed(
    destroying.id,
    destroying.pending_provider_outcome.evidence_sha256,
    lifecycleContext(
      "record_destroyed",
      recordOperation,
      recordDigest,
      destroying.resource_lifecycle_generation,
      destroying.revision,
      5n,
      140,
      now,
    ),
  );
  return { destroyed, checkpointReceipt: receipt, promotionReceipt: promotion };
}

function rejectedCode(result: PromiseSettledResult<unknown>): string | undefined {
  if (result.status !== "rejected") return undefined;
  const reason = result.reason as { code?: unknown };
  return typeof reason?.code === "string" ? reason.code : undefined;
}

async function conformanceCorpus(
  repository: SandboxRepositoryV1,
  now: Date,
  advancePastExpiry: () => void,
) {
  repository.migrate();
  const { h, active, createBinding } = await createActive(repository, now);
  advancePastExpiry();
  const finding = await h.service.observeExpired(active.id);
  const safetyFenced = await h.service.get(active.id);
  const { destroyed, checkpointReceipt: storedCheckpoint, promotionReceipt: storedPromotion } =
    await destroyWithCheckpoint(h, safetyFenced, now, createBinding);

  const operationId = oid("op", 120);
  const existingAnchors = (await Promise.all(
    [oid("op", 20), oid("op", 21), oid("op", 40)].map(async (providerOperationId) =>
      await repository.transaction((tx) => tx.listExternalAnchors(providerOperationId))
    ),
  )).flat().sort((left, right) =>
    left.journal_sequence < right.journal_sequence ? -1 :
      left.journal_sequence > right.journal_sequence ? 1 : 0
  );
  const priorJournal = existingAnchors.at(-1);
  if (priorJournal === undefined) throw new Error("journal corpus has no prior frontier");
  const { dispatched, outcome, next } = journalRecords(
    operationId,
    oid("step", 900),
    now,
    priorJournal.journal_sequence + 7n,
    digest("live-unobserved-global-frontier-before-gap"),
  );
  await repository.transaction((tx) => tx.appendExternalAnchor(dispatched));
  await repository.transaction((tx) => tx.appendExternalAnchor(structuredClone(dispatched)));
  const changedBytes = { ...dispatched, recorded_at: plusMilliseconds(now, 1) };
  await expect(repository.transaction((tx) => tx.appendExternalAnchor(changedBytes)))
    .rejects.toMatchObject({ code: "integrity_failed" });
  await expect(repository.transaction((tx) => tx.appendExternalAnchor({
    ...dispatched,
    operation_step_id: oid("step", 901),
    record_digest: digest("live-journal-cross-identity-record"),
    frontier_digest: digest("live-journal-cross-identity-frontier"),
    envelope_digest: digest("live-journal-cross-identity-envelope"),
  }))).rejects.toMatchObject({ code: "integrity_failed" });
  await expect(repository.transaction((tx) => tx.appendExternalAnchor(next)))
    .rejects.toMatchObject({ code: "provider_state_unknown" });
  await repository.transaction((tx) => tx.appendExternalAnchor(outcome));
  await repository.transaction((tx) => tx.appendExternalAnchor(next));

  const baseOperation = await repository.transaction((tx) => tx.getOperation(operationId));
  if (baseOperation === undefined) throw new Error("race corpus operation is missing");
  const racedOperation = (seed: number): OperationRecordV1 => ({
    ...structuredClone(baseOperation),
    operation_id: oid("op", seed),
    idempotency_key_sha256: digest("live-idempotency-race"),
    capability_use_sha256: digest(`live-idempotency-capability-${seed}`),
    fence: {
      ...structuredClone(baseOperation.fence),
      operation_id: oid("op", seed),
    },
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  });
  const idempotencyRace = await Promise.allSettled([
    repository.transaction((tx) => tx.insertOperation(racedOperation(951))),
    repository.transaction((tx) => tx.insertOperation(racedOperation(952))),
  ]);
  expect(idempotencyRace.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(idempotencyRace.filter((result) => result.status === "rejected")).toHaveLength(1);
  expect(idempotencyRace.map(rejectedCode).filter(Boolean)).toEqual(["idempotency_key_reused"]);

  const capabilityRace = await Promise.allSettled([
    repository.transaction((tx) =>
      tx.consumeCapabilityUse(digest("live-capability-race"), oid("op", 20))
    ),
    repository.transaction((tx) =>
      tx.consumeCapabilityUse(digest("live-capability-race"), oid("op", 120))
    ),
  ]);
  expect(capabilityRace.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(capabilityRace.filter((result) => result.status === "rejected")).toHaveLength(1);
  expect(capabilityRace.map(rejectedCode).filter(Boolean)).toEqual(["capability_replayed"]);

  const beforeCas = await repository.transaction((tx) => tx.getSandbox(destroyed.id));
  if (beforeCas === undefined) throw new Error("CAS corpus sandbox is missing");
  const nextRevision = { ...beforeCas, revision: beforeCas.revision + 1 };
  const casRace = await Promise.allSettled([
    repository.transaction((tx) => tx.putSandbox(nextRevision, beforeCas.revision)),
    repository.transaction((tx) => tx.putSandbox(structuredClone(nextRevision), beforeCas.revision)),
  ]);
  expect(casRace.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(casRace.filter((result) => result.status === "rejected")).toHaveLength(1);
  expect(casRace.map(rejectedCode).filter(Boolean)).toEqual(["stale_revision"]);

  const execStreamReservation = {
    schema_version: "sandboxes.exec-stream-state/v1" as const,
    resource_id: destroyed.id,
    resource_lifecycle_generation: destroyed.resource_lifecycle_generation,
    exec_id: oid("exec", 953),
    start_operation_id: oid("op", 953),
    start_request_sha256: digest("live-exec-start-request"),
    phase: "reserved" as const,
    cursor: null,
    cursor_sha256: null,
    stream_root_sha256: null,
    resume_token: null,
    resume_token_sha256: null,
    next_expected_sequence: null,
    in_flight_operation_id: oid("op", 953),
    terminal: false,
    updated_at: now.toISOString(),
  };
  await repository.transaction((tx) =>
    tx.compareAndSwapExecStreamState(null, execStreamReservation));
  const reloadedReservation = await repository.transaction((tx) =>
    tx.getExecStreamState(destroyed.id, execStreamReservation.exec_id));
  expect(reloadedReservation).toEqual(execStreamReservation);
  await expect(repository.transaction((tx) =>
    tx.compareAndSwapExecStreamState(null, execStreamReservation)))
    .rejects.toMatchObject({ code: "stale_revision" });
  const execStreamBase = {
    ...execStreamReservation,
    phase: "started" as const,
    cursor: "cursor_live_exec_base",
    cursor_sha256: digest("cursor_live_exec_base"),
    stream_root_sha256: digest("live-exec-stream-base"),
    resume_token: "resume_live_exec_base",
    resume_token_sha256: digest("resume_live_exec_base"),
    next_expected_sequence: 1n,
    in_flight_operation_id: null,
  };
  await repository.transaction((tx) =>
    tx.compareAndSwapExecStreamState(execStreamReservation, execStreamBase));
  const execStreamSuccessors = [1, 2].map((seed) => ({
    ...execStreamBase,
    cursor: `cursor_live_exec_${seed}`,
    cursor_sha256: digest(`cursor_live_exec_${seed}`),
    stream_root_sha256: digest(`live-exec-stream-${seed}`),
    resume_token: `resume_live_exec_${seed}`,
    resume_token_sha256: digest(`resume_live_exec_${seed}`),
    next_expected_sequence: 2n,
  }));
  const execStreamCasRace = await Promise.allSettled(execStreamSuccessors.map(
    async (successor) => await repository.transaction((tx) =>
      tx.compareAndSwapExecStreamState(execStreamBase, successor)),
  ));
  expect(execStreamCasRace.filter((result) => result.status === "fulfilled"))
    .toHaveLength(1);
  expect(execStreamCasRace.filter((result) => result.status === "rejected"))
    .toHaveLength(1);
  expect(execStreamCasRace.map(rejectedCode).filter(Boolean)).toEqual(["stale_revision"]);
  const execStreamWinner = await repository.transaction((tx) =>
    tx.getExecStreamState(destroyed.id, execStreamBase.exec_id));
  if (execStreamWinner === undefined) throw new Error("exec stream CAS winner is missing");
  const terminalExecStream = { ...execStreamWinner, terminal: true };
  await repository.transaction((tx) =>
    tx.compareAndSwapExecStreamState(execStreamWinner, terminalExecStream));
  await expect(repository.transaction((tx) => tx.compareAndSwapExecStreamState(
    terminalExecStream,
    { ...terminalExecStream, terminal: false },
  ))).rejects.toMatchObject({ code: "integrity_failed" });

  const beforeRollback = await repository.transaction((tx) => tx.getSandbox(destroyed.id));
  if (beforeRollback === undefined) throw new Error("rollback corpus sandbox is missing");
  await expect(repository.transaction((tx) => {
    tx.putSandbox({ ...beforeRollback, revision: beforeRollback.revision + 1 }, beforeRollback.revision);
    throw new Error("injected transaction failure");
  })).rejects.toThrow("injected transaction failure");
  const afterRollback = await repository.transaction((tx) => tx.getSandbox(destroyed.id));
  expect(afterRollback?.revision).toBe(beforeRollback.revision);

  const checkpoint = await repository.transaction((tx) =>
    tx.getCheckpointReceipt(storedCheckpoint.receipt_sha256)
  );
  const promotion = await repository.transaction((tx) =>
    tx.getGitPromotionReceipt(storedPromotion.receipt_sha256)
  );
  expect(checkpoint).toEqual(storedCheckpoint);
  expect(promotion).toEqual(storedPromotion);
  await repository.transaction((tx) => tx.putCheckpointReceipt(structuredClone(storedCheckpoint)));
  await repository.transaction((tx) => tx.putGitPromotionReceipt(structuredClone(storedPromotion)));
  await expect(repository.transaction((tx) => tx.putCheckpointReceipt({
    ...storedCheckpoint,
    durable_at: plusMilliseconds(now, 1),
  }))).rejects.toMatchObject({ code: "integrity_failed" });
  await expect(repository.transaction((tx) => tx.putGitPromotionReceipt({
    ...storedPromotion,
    promoted_at: plusMilliseconds(now, 1),
  }))).rejects.toMatchObject({ code: "integrity_failed" });
  await expect(repository.transaction((tx) => tx.putCheckpointReceipt({
    ...storedCheckpoint,
    receipt_sha256: digest("live-checkpoint-receipt-id-conflict"),
  }))).rejects.toMatchObject({ code: "integrity_failed" });
  await expect(repository.transaction((tx) => tx.putGitPromotionReceipt({
    ...storedPromotion,
    receipt_sha256: digest("live-promotion-receipt-id-conflict"),
  }))).rejects.toMatchObject({ code: "integrity_failed" });

  const events = await repository.transaction((tx) => tx.listEvents(destroyed.id));
  const anchors = await repository.transaction((tx) => tx.listExternalAnchors(operationId));
  const safety = await repository.transaction((tx) => tx.listSafetyFenceObservations(destroyed.id));
  const tombstone = await repository.transaction((tx) => tx.getDestroyTombstone(destroyed.id));
  const health = await repository.health();
  return {
    state: afterRollback?.state,
    revision: afterRollback?.revision,
    generation: afterRollback?.resource_lifecycle_generation,
    finding: finding.kind,
    eventStates: events.map((event) => event.state),
    eventSequences: events.map((event) => event.sequence),
    journalKinds: anchors
      .map((anchor) => "record_kind" in anchor ? anchor.record_kind : anchor.anchor_kind)
      .sort(),
    safetyCount: safety.length,
    safetyReason: safety[0]?.observation.reason,
    tombstoneDisposition: tombstone?.terminal_disposition,
    checkpointReceiptId: checkpoint?.receipt_id,
    promotionReceiptId: promotion?.receipt_id,
    sandboxCount: health.sandbox_count,
    operationCount: health.operation_count,
    schemaVersion: health.schema_version,
    execStreamTerminal: terminalExecStream.terminal,
  };
}

function numberValue(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  throw new Error("Postgres count did not have a numeric representation");
}

async function assertEventOutboxCrashRollback(now: Date): Promise<void> {
  const base = new TestPostgresClient(config.runtimeUrl, config.tlsCa);
  const injected = new InjectedFailureClient(base);
  const repository = await PostgresSandboxRepositoryV1.fromClient(injected, {
    expected_runtime_role: config.runtimeRole,
    expected_database: config.database,
    tls_ca: config.tlsCa,
  });
  const resourceId = oid("sbx", 4);
  const sandbox = await repository.transaction((tx) => tx.getSandbox(resourceId));
  if (sandbox === undefined) throw new Error("outbox crash corpus sandbox is missing");
  const before = await injected.query<{ event_count: number | string; outbox_count: number | string }>(`
    SELECT
      (SELECT COUNT(*) FROM sandboxes.sandbox_events) AS event_count,
      (SELECT COUNT(*) FROM sandboxes.outbox) AS outbox_count
  `);
  expect(numberValue(before[0]?.event_count)).toBe(numberValue(before[0]?.outbox_count));
  const event: Omit<SandboxEventV1, "sequence"> = {
    schema_version: SCHEMA_VERSION,
    event_id: oid("event", 999),
    resource_id: resourceId,
    operation_id: oid("op", 140),
    event_type: "operation_committed",
    state: sandbox.state,
    revision: sandbox.revision,
    resource_lifecycle_generation: sandbox.resource_lifecycle_generation,
    recorded_at: now.toISOString(),
    payload_sha256: digest("live-outbox-crash-event"),
  };
  injected.failPattern = /INSERT INTO sandboxes\.outbox/;
  await expect(repository.transaction((tx) => tx.appendEvent(event)))
    .rejects.toThrow("injected crash between event and outbox persistence");
  injected.failPattern = undefined;
  const after = await injected.query<{ event_count: number | string; outbox_count: number | string }>(`
    SELECT
      (SELECT COUNT(*) FROM sandboxes.sandbox_events) AS event_count,
      (SELECT COUNT(*) FROM sandboxes.outbox) AS outbox_count
  `);
  expect(after).toEqual(before);
  expect(await injected.query(
    "SELECT event_id FROM sandboxes.sandbox_events WHERE event_id = $1",
    [event.event_id],
  )).toHaveLength(0);
  await repository.close();
}

async function assertRetrySemantics(): Promise<void> {
  for (const sqlState of ["40001", "40P01"] as const) {
    const client = new RetryInjectingClient(
      new TestPostgresClient(config.runtimeUrl, config.tlsCa),
      sqlState,
      1,
    );
    const repository = await PostgresSandboxRepositoryV1.fromClient(client, {
      expected_runtime_role: config.runtimeRole,
      expected_database: config.database,
      tls_ca: config.tlsCa,
    });
    try {
      expect(await repository.transaction((tx) => tx.listSandboxes())).not.toHaveLength(0);
      expect(client.transactionAttempts).toBe(2);
    } finally {
      await repository.close();
    }
  }

  const exhaustedClient = new RetryInjectingClient(
    new TestPostgresClient(config.runtimeUrl, config.tlsCa),
    "40001",
    4,
  );
  const exhaustedRepository = await PostgresSandboxRepositoryV1.fromClient(exhaustedClient, {
    expected_runtime_role: config.runtimeRole,
    expected_database: config.database,
    tls_ca: config.tlsCa,
  });
  try {
    await expect(exhaustedRepository.transaction((tx) => tx.listSandboxes()))
      .rejects.toMatchObject({ code: "dependency_unavailable" });
    expect(exhaustedClient.transactionAttempts).toBe(4);
  } finally {
    await exhaustedRepository.close();
  }
}

async function assertProtectedColumnMismatchDetected(): Promise<void> {
  const migration = new TestPostgresClient(config.migrationUrl, config.tlsCa);
  const assertRuntimeLoadFails = async () => {
    const runtime = new TestPostgresClient(config.runtimeUrl, config.tlsCa);
    const repository = await PostgresSandboxRepositoryV1.fromClient(runtime, {
      expected_runtime_role: config.runtimeRole,
      expected_database: config.database,
      tls_ca: config.tlsCa,
    });
    try {
      await expect(repository.transaction((tx) => tx.listSandboxes()))
        .rejects.toMatchObject({ code: "integrity_failed" });
    } finally {
      await repository.close();
    }
  };
  try {
    const operationId = oid("op", 120);
    const operation = await migration.query<{ effect_phase: string }>(
      "SELECT effect_phase FROM sandboxes.operations WHERE operation_id = $1",
      [operationId],
    );
    const originalPhase = operation[0]?.effect_phase;
    if (originalPhase === undefined) throw new Error("protected-column corpus operation is missing");
    try {
      await migration.query(
        "UPDATE sandboxes.operations SET effect_phase = 'prepared' WHERE operation_id = $1",
        [operationId],
      );
      await assertRuntimeLoadFails();
    } finally {
      await migration.query(
        "UPDATE sandboxes.operations SET effect_phase = $2 WHERE operation_id = $1",
        [operationId, originalPhase],
      );
    }

    const checkpointDigest = digest("checkpoint-receipt");
    const checkpoint = await migration.query<{ receipt_id: string }>(
      `SELECT receipt_id FROM sandboxes.immutable_checkpoint_receipts
       WHERE receipt_sha256 = $1`,
      [checkpointDigest],
    );
    const checkpointReceiptId = checkpoint[0]?.receipt_id;
    if (checkpointReceiptId === undefined) throw new Error("checkpoint tamper corpus receipt is missing");
    try {
      await migration.query(
        `UPDATE sandboxes.immutable_checkpoint_receipts SET receipt_id = $2
         WHERE receipt_sha256 = $1`,
        [checkpointDigest, oid("receipt", 998)],
      );
      await assertRuntimeLoadFails();
    } finally {
      await migration.query(
        `UPDATE sandboxes.immutable_checkpoint_receipts SET receipt_id = $2
         WHERE receipt_sha256 = $1`,
        [checkpointDigest, checkpointReceiptId],
      );
    }

    const promotionDigest = digest("live-promotion-receipt-171");
    const promotion = await migration.query<{ receipt_id: string }>(
      `SELECT receipt_id FROM sandboxes.immutable_git_promotion_receipts
       WHERE receipt_sha256 = $1`,
      [promotionDigest],
    );
    const promotionReceiptId = promotion[0]?.receipt_id;
    if (promotionReceiptId === undefined) throw new Error("promotion tamper corpus receipt is missing");
    try {
      await migration.query(
        `UPDATE sandboxes.immutable_git_promotion_receipts SET receipt_id = $2
         WHERE receipt_sha256 = $1`,
        [promotionDigest, oid("receipt", 999)],
      );
      await assertRuntimeLoadFails();
    } finally {
      await migration.query(
        `UPDATE sandboxes.immutable_git_promotion_receipts SET receipt_id = $2
         WHERE receipt_sha256 = $1`,
        [promotionDigest, promotionReceiptId],
      );
    }

    const observation = await migration.query<{
      observation_id: string;
      recorded_at: string | Date;
    }>(`
      SELECT observation_id, recorded_at
      FROM sandboxes.safety_fence_observations
      ORDER BY observation_id LIMIT 1
    `);
    const observationId = observation[0]?.observation_id;
    const observationRecordedAt = observation[0]?.recorded_at;
    if (observationId === undefined || observationRecordedAt === undefined) {
      throw new Error("safety observation tamper corpus is missing");
    }
    try {
      await migration.query(
        `UPDATE sandboxes.safety_fence_observations
         SET recorded_at = recorded_at + interval '1 second'
         WHERE observation_id = $1`,
        [observationId],
      );
      await assertRuntimeLoadFails();
    } finally {
      await migration.query(
        `UPDATE sandboxes.safety_fence_observations SET recorded_at = $2
         WHERE observation_id = $1`,
        [observationId, observationRecordedAt],
      );
    }

    const probeAnchorKindColumn = await migration.query<{ present: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'sandboxes'
          AND table_name = 'external_read_probe_anchors'
          AND column_name = 'anchor_kind'
      ) AS present
    `);
    const collisionInsert = probeAnchorKindColumn[0]?.present === true
      ? `INSERT INTO sandboxes.external_read_probe_anchors(
           operation_id, operation_step_id, operation_execution_epoch,
           journal_sequence, envelope_digest, anchor_kind, record_json
         )
         SELECT effect.operation_id, effect.operation_step_id,
                effect.operation_execution_epoch, effect.journal_sequence,
                effect.envelope_digest, 'READ_PROBE', effect.record_json
         FROM sandboxes.effect_journal_records AS effect
         WHERE NOT EXISTS (
           SELECT 1 FROM sandboxes.external_read_probe_anchors AS probe
           WHERE probe.journal_sequence = effect.journal_sequence
         )
         LIMIT 1`
      : `INSERT INTO sandboxes.external_read_probe_anchors(
           operation_id, operation_step_id, operation_execution_epoch,
           journal_sequence, envelope_digest, record_json
         )
         SELECT effect.operation_id, effect.operation_step_id,
                effect.operation_execution_epoch, effect.journal_sequence,
                effect.envelope_digest, effect.record_json
         FROM sandboxes.effect_journal_records AS effect
         WHERE NOT EXISTS (
           SELECT 1 FROM sandboxes.external_read_probe_anchors AS probe
           WHERE probe.journal_sequence = effect.journal_sequence
         )
         LIMIT 1`;
    try {
      await expect(migration.query(collisionInsert)).rejects.toBeDefined();
    } finally {
      await migration.query(`
        DELETE FROM sandboxes.external_read_probe_anchors AS probe
        USING sandboxes.effect_journal_records AS effect
        WHERE probe.journal_sequence = effect.journal_sequence
      `);
    }
  } finally {
    await migration.close();
  }
}

test("isolated live Postgres matches memory and SQLite storage/failure/race semantics", async () => {
  for (const forbiddenAmbient of [
    "DATABASE_URL",
    "PGHOST",
    "PGSERVICE",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "E2B_API_KEY",
    "DAYTONA_API_KEY",
  ]) {
    expect(process.env[forbiddenAmbient]).toBeUndefined();
  }
  const expectedMigrationVersions: number[] = POSTGRES_SCHEMA_MIGRATIONS_V1.map(
    (migration) => Number(migration.version),
  );
  expect(expectedMigrationVersions).toEqual(
    Array.from(
      { length: POSTGRES_SCHEMA_MIGRATIONS_V1.length },
      (_, index) => index + 1,
    ),
  );
  expect(new Set(POSTGRES_SCHEMA_MIGRATIONS_V1.map(
    (migration) => migration.name,
  )).size).toBe(POSTGRES_SCHEMA_MIGRATIONS_V1.length);

  const insecureRuntime = new InsecureReadyClient(config.runtimeRole, config.database);
  await expect(PostgresSandboxRepositoryV1.fromClient(insecureRuntime, {
    expected_runtime_role: config.runtimeRole,
    expected_database: config.database,
    tls_ca: config.tlsCa,
  })).rejects.toMatchObject({ code: "forbidden" });
  const insecureMigration = new InsecureReadyClient(config.migrationRole, config.database);
  await expect(PostgresSandboxRepositoryV1.applyMigrations(insecureMigration, {
    expected_migration_role: config.migrationRole,
    expected_database: config.database,
  })).rejects.toMatchObject({ code: "forbidden" });

  const migration = new TestPostgresClient(config.migrationUrl, config.tlsCa);
  await expect(PostgresSandboxRepositoryV1.applyMigrations(migration, {
    expected_migration_role: config.migrationRole,
    expected_database: "wrong_sandboxes_database",
  })).rejects.toMatchObject({ code: "forbidden" });
  await expect(PostgresSandboxRepositoryV1.applyMigrations(migration, {
    expected_migration_role: config.migrationRole,
  } as unknown as PostgresMigrationOptionsV1)).rejects.toMatchObject({
    code: "validation_failed",
  });
  await PostgresSandboxRepositoryV1.applyMigrations(migration, {
    expected_migration_role: config.migrationRole,
    expected_database: config.database,
  });
  await PostgresSandboxRepositoryV1.applyMigrations(migration, {
    expected_migration_role: config.migrationRole,
    expected_database: config.database,
  });
  const persistedMigrations = await migration.query<{
    version: number;
    name: string;
    checksum_sha256: string;
  }>(`
    SELECT version, name, checksum_sha256
    FROM sandboxes.schema_migrations
    ORDER BY version ASC
  `);
  expect(persistedMigrations.map((stored) => ({
    version: Number(stored.version),
    name: stored.name,
    checksum_sha256: stored.checksum_sha256,
  }))).toEqual(POSTGRES_SCHEMA_MIGRATIONS_V1);
  await provisionRuntimeRole(migration);

  const runtimeProbe = new TestPostgresClient(config.runtimeUrl, config.tlsCa);
  const transport = await runtimeProbe.query<{ ssl_in_use: boolean }>(`
    SELECT COALESCE(
      (SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid = pg_backend_pid()),
      false
    ) AS ssl_in_use
  `);
  expect(transport[0]?.ssl_in_use).toBe(true);
  await expect(runtimeProbe.query("CREATE TABLE sandboxes.runtime_ddl_must_fail(id INTEGER)"))
    .rejects.toBeDefined();
  await expect(runtimeProbe.query(
    "UPDATE sandboxes.schema_migrations SET checksum_sha256 = checksum_sha256",
  )).rejects.toBeDefined();
  await expect(PostgresSandboxRepositoryV1.applyMigrations(runtimeProbe, {
    expected_migration_role: config.migrationRole,
    expected_database: config.database,
  })).rejects.toMatchObject({ code: "forbidden" });
  await runtimeProbe.close();

  await expect(PostgresSandboxRepositoryV1.connect(
    config.runtimeUrl.replace("sslmode=verify-full", "sslmode=require"),
    {
      expected_runtime_role: config.runtimeRole,
      expected_database: config.database,
      tls_ca: config.tlsCa,
    },
  )).rejects.toMatchObject({ code: "forbidden" });

  const wrongRoleClient = new TestPostgresClient(config.runtimeUrl, config.tlsCa);
  try {
    await expect(PostgresSandboxRepositoryV1.fromClient(wrongRoleClient, {
      expected_runtime_role: config.migrationRole,
      expected_database: config.database,
      tls_ca: config.tlsCa,
    })).rejects.toMatchObject({ code: "forbidden" });
  } finally {
    await wrongRoleClient.close();
  }

  const wrongDatabaseClient = new TestPostgresClient(config.runtimeUrl, config.tlsCa);
  try {
    await expect(PostgresSandboxRepositoryV1.fromClient(wrongDatabaseClient, {
      expected_runtime_role: config.runtimeRole,
      expected_database: "wrong_sandboxes_database",
      tls_ca: config.tlsCa,
    })).rejects.toMatchObject({ code: "forbidden" });
  } finally {
    await wrongDatabaseClient.close();
  }

  const missingDatabaseClient = new TestPostgresClient(config.runtimeUrl, config.tlsCa);
  try {
    await expect(PostgresSandboxRepositoryV1.fromClient(missingDatabaseClient, {
      expected_runtime_role: config.runtimeRole,
      tls_ca: config.tlsCa,
    } as unknown as PostgresRepositoryConnectOptionsV1)).rejects.toMatchObject({
      code: "validation_failed",
    });
  } finally {
    await missingDatabaseClient.close();
  }

  const postgres = await PostgresSandboxRepositoryV1.connect(config.runtimeUrl, {
    expected_runtime_role: config.runtimeRole,
    expected_database: config.database,
    tls_ca: config.tlsCa,
  });
  const now = await postgres.databaseTime();
  expect(Number.isNaN(now.getTime())).toBe(false);
  const sqliteRoot = mkdtempSync(join(tmpdir(), "sandboxes-postgres-parity-"));
  chmodSync(sqliteRoot, 0o700);
  const memory = controlledDatabaseTime(
    new InMemorySandboxRepositoryV1(() => new Date(now.getTime())),
    now,
  );
  const sqlite = controlledDatabaseTime(new SqliteSandboxRepositoryV1(join(sqliteRoot, "sandboxes.db"), {
    allow_unsafe_test_path: true,
    hermetic_test_database_time: () => new Date(now.getTime()),
  }), now);
  const controlledPostgres = controlledDatabaseTime(postgres, now);
  try {
    const memoryResult = await conformanceCorpus(
      memory.repository,
      now,
      () => memory.advance(120_000),
    );
    const sqliteResult = await conformanceCorpus(
      sqlite.repository,
      now,
      () => sqlite.advance(120_000),
    );
    const postgresResult = await conformanceCorpus(
      controlledPostgres.repository,
      now,
      () => controlledPostgres.advance(120_000),
    );
    expect(sqliteResult).toEqual(memoryResult);
    expect(postgresResult).toEqual(memoryResult);
  } finally {
    await memory.repository.close();
    await sqlite.repository.close();
    await controlledPostgres.repository.close();
    rmSync(sqliteRoot, { recursive: true, force: true });
  }

  const reopened = await PostgresSandboxRepositoryV1.connect(config.runtimeUrl, {
    expected_runtime_role: config.runtimeRole,
    expected_database: config.database,
    tls_ca: config.tlsCa,
  });
  expect(await reopened.transaction((tx) => tx.listSafetyFenceObservations(oid("sbx", 4))))
    .toHaveLength(1);
  expect(await reopened.transaction((tx) => tx.getDestroyTombstone(oid("sbx", 4))))
    .toMatchObject({ terminal_disposition: "destroyed_after_checkpoint" });
  expect(await reopened.transaction((tx) => tx.getCheckpointReceipt(digest("checkpoint-receipt"))))
    .toMatchObject({ receipt_id: oid("receipt", 30), resource_id: oid("sbx", 4) });
  expect(await reopened.transaction((tx) =>
    tx.getGitPromotionReceipt(digest("live-promotion-receipt-171"))
  )).toMatchObject({ receipt_id: oid("receipt", 171), resource_id: oid("sbx", 4) });
  expect(await reopened.transaction((tx) => tx.listExternalAnchors(oid("op", 120))))
    .toHaveLength(3);
  await reopened.close();

  await assertEventOutboxCrashRollback(now);
  await assertRetrySemantics();
  await assertProtectedColumnMismatchDetected();

  const lastMigration = POSTGRES_SCHEMA_MIGRATIONS_V1.at(-1);
  if (lastMigration === undefined) throw new Error("Postgres migration list is empty");
  await migration.query(
    "UPDATE sandboxes.schema_migrations SET checksum_sha256 = $2 WHERE version = $1",
    [lastMigration.version, digest("tampered-migration-checksum")],
  );
  const checksumMismatchStartedAt = Date.now();
  await expect(PostgresSandboxRepositoryV1.connect(config.runtimeUrl, {
    expected_runtime_role: config.runtimeRole,
    expected_database: config.database,
    tls_ca: config.tlsCa,
  })).rejects.toMatchObject({ code: "integrity_failed" });
  expect(Date.now() - checksumMismatchStartedAt).toBeLessThan(5_000);
  await migration.query(
    "UPDATE sandboxes.schema_migrations SET checksum_sha256 = $2 WHERE version = $1",
    [lastMigration.version, lastMigration.checksum_sha256],
  );
  const finalRepository = await PostgresSandboxRepositoryV1.fromClient(
    new TestPostgresClient(config.runtimeUrl, config.tlsCa),
    {
      expected_runtime_role: config.runtimeRole,
      expected_database: config.database,
      tls_ca: config.tlsCa,
    },
  );
  expect(await finalRepository.health()).toMatchObject({
    backend: "postgres",
    schema_version: POSTGRES_SCHEMA_MIGRATIONS_V1.length,
    integrity: "ok",
  });
  await finalRepository.close();
  await migration.close();
});
