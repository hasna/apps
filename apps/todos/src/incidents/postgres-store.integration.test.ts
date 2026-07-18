import { describe, expect, it } from "bun:test";
import { createTodosCloudQueryClient } from "../storage/cloud-client.js";
import {
  normalizeIncidentCreateInput,
  normalizeIncidentTransitionInput,
} from "./contracts.js";
import {
  createPostgresIncidentStore,
  postgresIncidentRollbackSql,
  postgresIncidentSchemaSql,
  type IncidentAuthorityContext,
} from "./postgres-store.js";

const DATABASE_URL = validatedTemporaryDatabaseUrl(process.env.TODOS_INCIDENT_TEST_DATABASE_URL);
const AUTHORITY_ID = "todos.hasna.xyz:v1";
const INCIDENT_ID = "11111111-1111-4111-8111-111111111111";
const REPLACEMENT_ID = "22222222-2222-4222-8222-222222222222";

const workerOne: IncidentAuthorityContext = {
  authorityId: AUTHORITY_ID,
  actorId: "postgres-integration-worker-one",
  actorKeyId: "integration-key-one",
};
const workerTwo: IncidentAuthorityContext = {
  authorityId: AUTHORITY_ID,
  actorId: "postgres-integration-worker-two",
  actorKeyId: "integration-key-two",
};

function validatedTemporaryDatabaseUrl(value: string | undefined): string {
  if (!value) return "";
  if (process.env.TODOS_INCIDENT_TEST_ALLOW_TEMP_DATABASE !== "1") {
    throw new Error("Live incident PostgreSQL verification requires the explicit temporary-database safety gate");
  }
  const url = new URL(value);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (url.protocol !== "postgresql:" || !["127.0.0.1", "localhost"].includes(url.hostname) ||
      url.port !== "5432" || url.password || url.search || url.hash || url.pathname !== `/${database}` ||
      !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(decodeURIComponent(url.username))) {
    throw new Error("Live incident PostgreSQL verification only accepts an unambiguous passwordless local PostgreSQL URL");
  }
  if (!/^todos_incident_ee2ecad7_[0-9]+_[0-9]+$/.test(database)) {
    throw new Error("Live incident PostgreSQL verification refuses a database outside its task-owned name prefix");
  }
  return value;
}

describe.skipIf(!DATABASE_URL)("Postgres incident live concurrency", () => {
  it("proves two-connection CAS, ordered outbox delivery, audited recovery, and complete rollback", async () => {
    const admin = createTodosCloudQueryClient(DATABASE_URL, { max: 1 });
    const connectionOne = createTodosCloudQueryClient(DATABASE_URL, { max: 1 });
    const connectionTwo = createTodosCloudQueryClient(DATABASE_URL, { max: 1 });
    let clock = Date.now() - 1_000;
    const now = () => new Date(clock).toISOString();
    const storeOne = createPostgresIncidentStore(connectionOne, {
      now,
      leaseToken: () => "integration-lease-one",
    });
    const storeTwo = createPostgresIncidentStore(connectionTwo, {
      now,
      leaseToken: () => "integration-lease-two",
    });

    try {
      for (const sql of postgresIncidentSchemaSql()) await admin.query(sql);

      const createInput = normalizeIncidentCreateInput({
        id: INCIDENT_ID,
        idempotency_key: "postgres-create-race-v1",
        title: "Live PostgreSQL incident race",
        severity: "high",
        owner: "platform-todos",
        affected_scopes: ["service:todos"],
        blocked_scopes: ["channel:incidents"],
        next_action: "Prove the canonical compare-and-swap path",
      });
      const createResults = await Promise.all([
        storeOne.create(createInput, workerOne),
        storeTwo.create(createInput, workerTwo),
      ]);
      expect(createResults.map((result) => result.replayed).sort()).toEqual([false, true]);
      expect(createResults[0]!.incident).toEqual(createResults[1]!.incident);

      clock += 1_000;
      const transitionInput = normalizeIncidentTransitionInput({
        expected_version: 1,
        idempotency_key: "postgres-transition-race-v2",
        reason: "Containment is live",
        status: "contained",
        containment: "Canonical incident writes remain atomic",
        next_action: "Verify ordered projection delivery",
      });
      const transitionResults = await Promise.all([
        storeOne.transition(INCIDENT_ID, transitionInput, workerOne),
        storeTwo.transition(INCIDENT_ID, transitionInput, workerTwo),
      ]);
      expect(transitionResults.map((result) => result.replayed).sort()).toEqual([false, true]);
      expect(transitionResults[0]!.incident).toEqual(transitionResults[1]!.incident);
      expect(await storeOne.getOutboxStatus(AUTHORITY_ID)).toEqual({
        pending: 2,
        leased: 0,
        acked: 0,
        dead: 0,
        total: 2,
      });

      const firstClaims = await Promise.all([
        storeOne.claimOutbox(workerOne, { limit: 10 }),
        storeTwo.claimOutbox(workerTwo, { limit: 10 }),
      ]);
      const firstClaimed = firstClaims.flat();
      expect(firstClaimed).toHaveLength(1);
      expect(firstClaimed[0]!.incident_version).toBe(1);
      await storeOne.ackOutbox(
        firstClaimed[0]!.event_id,
        firstClaimed[0]!.lease_token!,
        "integration-delivery-original-v1",
        workerOne,
      );

      clock += 1_000;
      const secondClaimed = await storeTwo.claimOutbox(workerTwo, { limit: 10 });
      expect(secondClaimed).toHaveLength(1);
      expect(secondClaimed[0]!.incident_version).toBe(2);
      await storeTwo.ackOutbox(
        secondClaimed[0]!.event_id,
        secondClaimed[0]!.lease_token!,
        "integration-delivery-original-v2",
        workerTwo,
      );

      clock += 1_000;
      const replacement = await storeOne.create(normalizeIncidentCreateInput({
        id: REPLACEMENT_ID,
        idempotency_key: "postgres-supersession-v1",
        title: "Replacement incident",
        severity: "medium",
        owner: "platform-todos",
        affected_scopes: ["service:todos"],
        blocked_scopes: ["project:wks_8vJJzXTiFo6sxwRkpPqoI"],
        next_action: "Deliver after the superseded event is acknowledged",
        supersedes_id: INCIDENT_ID,
        supersedes_expected_version: 2,
      }), workerOne);
      expect(replacement.replayed).toBe(false);
      expect(replacement.events).toHaveLength(2);

      const supersessionClaim = await storeOne.claimOutbox(workerOne, { limit: 10 });
      expect(supersessionClaim).toHaveLength(1);
      expect(supersessionClaim[0]!.event_id).toBe(replacement.events[0]!.event_id);
      expect(supersessionClaim[0]!.depends_on_event_id).toBeNull();
      await storeOne.ackOutbox(
        supersessionClaim[0]!.event_id,
        supersessionClaim[0]!.lease_token!,
        "integration-delivery-superseded",
        workerOne,
      );

      clock += 1_000;
      let projected = (await storeTwo.claimOutbox(workerTwo, { limit: 10 }))[0]!;
      expect(projected.event_id).toBe(replacement.events[1]!.event_id);
      expect(projected.depends_on_event_id).toBe(replacement.events[0]!.event_id);
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        projected = await storeTwo.failOutbox(
          projected.event_id,
          projected.lease_token!,
          "PROJECTION_REJECTED",
          `projector rejected canonical event attempt ${attempt}`,
          workerTwo,
        );
        if (attempt < 3) {
          expect(projected.status).toBe("pending");
          clock += 60_000;
          projected = (await storeTwo.claimOutbox(workerTwo, { limit: 1 }))[0]!;
        }
      }
      expect(projected).toMatchObject({
        status: "dead",
        attempts: 3,
        failure_code: "PROJECTION_REJECTED",
        consecutive_failures: 3,
        lease_token: null,
        leased_by: null,
        lease_expires_at: null,
      });
      expect(await storeOne.getDeadOutbox(projected.event_id, AUTHORITY_ID)).toEqual(projected);
      expect(await storeOne.listDeadOutbox({ limit: 10 }, AUTHORITY_ID)).toEqual([projected]);

      clock += 1_000;
      const recovered = await storeOne.requeueOutbox(projected.event_id, {
        expectedAttempts: 3,
        idempotencyKey: "postgres-requeue-dead-v1",
        reason: "Projection contract repaired and independently reviewed",
      }, workerOne);
      expect(recovered).toMatchObject({
        status: "pending",
        attempts: 0,
        consecutive_failures: 0,
        failure_code: null,
        failure_fingerprint: null,
        last_error: null,
      });
      const recoveredClaim = (await storeOne.claimOutbox(workerOne, { limit: 1 }))[0]!;
      await storeOne.ackOutbox(
        recoveredClaim.event_id,
        recoveredClaim.lease_token!,
        "integration-delivery-recovered",
        workerOne,
      );
      expect(await storeOne.getOutboxStatus(AUTHORITY_ID)).toEqual({
        pending: 0,
        leased: 0,
        acked: 4,
        dead: 0,
        total: 4,
      });
    } finally {
      for (const sql of postgresIncidentRollbackSql()) await admin.query(sql);
      const residual = await admin.query<{
        incidents: string | null;
        transitions: string | null;
        outbox: string | null;
        recoveries: string | null;
        transition_function: string | null;
        recovery_function: string | null;
      }>(`SELECT
        to_regclass('todos_incidents')::text AS incidents,
        to_regclass('todos_incident_transitions')::text AS transitions,
        to_regclass('todos_incident_projection_outbox')::text AS outbox,
        to_regclass('todos_incident_outbox_recoveries')::text AS recoveries,
        to_regprocedure('todos_incident_transition_immutable()')::text AS transition_function,
        to_regprocedure('todos_incident_outbox_recoveries_immutable()')::text AS recovery_function`);
      expect(residual.rows[0]).toEqual({
        incidents: null,
        transitions: null,
        outbox: null,
        recoveries: null,
        transition_function: null,
        recovery_function: null,
      });
      await Promise.all([connectionOne.close(), connectionTwo.close(), admin.close()]);
    }
  });
});
