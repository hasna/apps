#!/usr/bin/env bun
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { ApiKeyStore, mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import { createQueryClient } from "../src/generated/storage-kit/query.js";
import { PG_MIGRATIONS } from "../src/lib/pg-migrations.js";
import {
  computeIncidentProjectionIds,
  IncidentProjectionConflictError,
} from "../src/lib/incident-projection-contract.js";
import {
  appendIncidentProjectionPg,
  CHANNEL_IDENTITY_ADVISORY_LOCK,
} from "../src/server/incident-projections.js";
import { renameChannelServer, startApiServer } from "../src/server/api.js";
import { ConversationsClient } from "../src/sdk/index.js";
import type { IncidentProjectionRequestV1, IncidentProjectorContext } from "../src/types.js";

const socket = "/var/run/postgresql";
const port = 5432;
const user = process.env.USER || "hasna";
const database = `oc_incident_52e65cba_${process.pid}_${randomBytes(4).toString("hex")}`;
if (!/^[a-z0-9_]+$/.test(database)) throw new Error("unsafe temporary database name");
const quotedDatabase = `"${database}"`;

function assertPasswordlessLocalPgEnvironment(env: NodeJS.ProcessEnv): void {
  for (const name of ["PGPASSWORD", "PGPASSFILE", "PGSERVICE", "PGSERVICEFILE"] as const) {
    if (env[name]) throw new Error(`refusing ambient PostgreSQL credential or service setting: ${name}`);
  }
}

function localPoolConfig(targetDatabase: string, max: number) {
  return { host: socket, port, database: targetDatabase, user, max };
}

async function createOwnedDatabase(pool: Pool, quotedName: string): Promise<boolean> {
  await pool.query(`CREATE DATABASE ${quotedName}`);
  return true;
}

assert.throws(
  () => assertPasswordlessLocalPgEnvironment({ PGPASSWORD: "hostile-test-sentinel" }),
  /PGPASSWORD/,
);
const hostileTargetConfig = localPoolConfig("hostile_target_sentinel", 1);
assert.deepEqual(
  { host: hostileTargetConfig.host, port: hostileTargetConfig.port, database: hostileTargetConfig.database },
  { host: socket, port, database: "hostile_target_sentinel" },
);
assertPasswordlessLocalPgEnvironment(process.env);

const admin = new Pool(localPoolConfig("postgres", 1));
let taskClient: ReturnType<typeof createQueryClient> | null = null;
let guardReuseClient: ReturnType<typeof createQueryClient> | null = null;
let apiServer: ReturnType<typeof startApiServer> | null = null;
let databaseCreated = false;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function waitForPg(
  predicate: () => Promise<boolean>,
  description: string,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await predicate()) return;
    await Bun.sleep(10);
  }
  throw new Error(`timed out waiting for PostgreSQL verifier state: ${description}`);
}

function eventVersion(
  base: IncidentProjectionRequestV1,
  incidentId: string,
  version: number,
  occurredAt: string,
): IncidentProjectionRequestV1 {
  const event = clone(base);
  const ids = computeIncidentProjectionIds(base.authority_id, incidentId, version);
  event.incident_id = incidentId;
  event.incident.id = incidentId;
  event.incident_version = version;
  event.incident.version = version;
  event.event_id = ids.event_id;
  event.transition_id = ids.transition_id;
  event.projection_key = ids.projection_key;
  event.occurred_at = occurredAt;
  event.incident.updated_at = occurredAt;
  return event;
}

try {
  const collisionDatabase = `${database}_collision`;
  const quotedCollisionDatabase = `"${collisionDatabase}"`;
  let collisionFixtureCreated = false;
  let collidingAttemptOwnedDatabase = false;
  try {
    await admin.query(`CREATE DATABASE ${quotedCollisionDatabase}`);
    collisionFixtureCreated = true;
    await assert.rejects(
      async () => {
        collidingAttemptOwnedDatabase = await createOwnedDatabase(admin, quotedCollisionDatabase);
      },
      (error: unknown) => (error as { code?: string }).code === "42P04",
    );
    assert.equal(collidingAttemptOwnedDatabase, false);
    assert.equal(
      Number((await admin.query(
        "SELECT COUNT(*) AS n FROM pg_database WHERE datname=$1",
        [collisionDatabase],
      )).rows[0]?.n),
      1,
    );
  } finally {
    if (collisionFixtureCreated) {
      await admin.query(`DROP DATABASE ${quotedCollisionDatabase} WITH (FORCE)`);
    }
  }

  databaseCreated = await createOwnedDatabase(admin, quotedDatabase);
  const pool = new Pool(localPoolConfig(database, 6));
  taskClient = createQueryClient(pool);
  for (const migration of PG_MIGRATIONS) await taskClient.execute(migration);

  const fixture = JSON.parse(
    readFileSync(new URL("../fixtures/todos-incident-projection-v1.json", import.meta.url), "utf8"),
  ) as IncidentProjectionRequestV1;
  const context: IncidentProjectorContext = {
    tenant_id: "tenant-a",
    authority_id: fixture.authority_id,
    routing: { channel: "incidents", project_id: "wks_8vJJzXTiFo6sxwRkpPqoI" },
  };

  const signingSecret = "x".repeat(48);
  const keys = new ApiKeyStore(taskClient);
  const verifier = verifyApiKey({
    app: "conversations",
    signingSecret,
    isRevoked: async () => false,
  });
  apiServer = startApiServer({
    host: "127.0.0.1",
    port: 0,
    deps: { client: taskClient, keys, verifier, incidentProjector: context },
  });
  const projectorKey = mintApiKey({
    app: "conversations",
    agent: "todos-projector",
    scopes: ["conversations:incident-project"],
    signingSecret,
  }).token;
  const sdk = new ConversationsClient({
    baseUrl: `http://127.0.0.1:${apiServer.port}`,
    apiKey: projectorKey,
  });
  const httpCreated = await sdk.appendIncidentProjection(fixture);
  const httpReplay = await sdk.appendIncidentProjection(fixture);
  assert.equal(httpCreated.projection.replayed, false);
  assert.equal(httpReplay.projection.replayed, true);
  assert.equal(httpCreated.projection.message_id, httpReplay.projection.message_id);

  await taskClient.query(
    `INSERT INTO channels (name, created_by) VALUES ('incidents', 'verifier') ON CONFLICT (name) DO NOTHING`,
  );
  await taskClient.query(
    `INSERT INTO channel_members (channel, agent) VALUES ('incidents', 'projector-02') ON CONFLICT DO NOTHING`,
  );
  const readerOneKey = mintApiKey({
    app: "conversations",
    agent: "projector-01",
    scopes: ["conversations:read", "conversations:write"],
    signingSecret,
  }).token;
  const readerTwoKey = mintApiKey({
    app: "conversations",
    agent: "projector-02",
    scopes: ["conversations:read", "conversations:write"],
    signingSecret,
  }).token;
  const apiBase = `http://127.0.0.1:${apiServer.port}`;
  const blockersFor = async (agent: string, apiKey: string): Promise<Array<{ id: number }>> => {
    const response = await fetch(`${apiBase}/v1/messages/blockers?agent=${encodeURIComponent(agent)}`, {
      headers: { "x-api-key": apiKey },
    });
    assert.equal(response.status, 200);
    return (await response.json() as { messages: Array<{ id: number }> }).messages;
  };
  assert((await blockersFor("projector-01", readerOneKey)).some((message) => message.id === httpCreated.projection.message_id));
  assert((await blockersFor("projector-02", readerTwoKey)).some((message) => message.id === httpCreated.projection.message_id));
  const spoofedBlockerRead = await fetch(`${apiBase}/v1/messages/blockers?agent=projector-02`, {
    headers: { "x-api-key": readerOneKey },
  });
  assert.equal(spoofedBlockerRead.status, 403);
  const acknowledged = await fetch(`${apiBase}/v1/messages/read`, {
    method: "POST",
    headers: { "x-api-key": readerOneKey, "content-type": "application/json" },
    body: JSON.stringify({ ids: [httpCreated.projection.message_id], reader: "projector-01" }),
  });
  assert.equal(acknowledged.status, 200);
  assert.equal((await acknowledged.json() as { marked: number }).marked, 1);
  const repeatedAcknowledgement = await fetch(`${apiBase}/v1/messages/read`, {
    method: "POST",
    headers: { "x-api-key": readerOneKey, "content-type": "application/json" },
    body: JSON.stringify({ ids: [httpCreated.projection.message_id] }),
  });
  assert.equal(repeatedAcknowledgement.status, 200);
  const repeatedReceipt = await fetch(`${apiBase}/v1/messages/${httpCreated.projection.message_id}/receipts`, {
    method: "POST",
    headers: { "x-api-key": readerOneKey, "content-type": "application/json" },
    body: JSON.stringify({ agent: "projector-01" }),
  });
  assert.equal(repeatedReceipt.status, 201);
  const outsiderKey = mintApiKey({
    app: "conversations",
    agent: "outsider",
    scopes: ["conversations:read", "conversations:write"],
    signingSecret,
  }).token;
  const outsiderAck = await fetch(`${apiBase}/v1/messages/read`, {
    method: "POST",
    headers: { "x-api-key": outsiderKey, "content-type": "application/json" },
    body: JSON.stringify({ ids: [httpCreated.projection.message_id] }),
  });
  assert.equal(outsiderAck.status, 403);
  assert(!(await blockersFor("projector-01", readerOneKey)).some((message) => message.id === httpCreated.projection.message_id));
  assert((await blockersFor("projector-02", readerTwoKey)).some((message) => message.id === httpCreated.projection.message_id));

  const identicalEvent = eventVersion(
    fixture,
    "66666666-6666-4666-8666-666666666666",
    1,
    "2026-07-18T20:02:00.000Z",
  );
  identicalEvent.incident.created_at = identicalEvent.occurred_at;
  const identical = await Promise.all([
    appendIncidentProjectionPg(taskClient, identicalEvent, context),
    appendIncidentProjectionPg(taskClient, identicalEvent, context),
  ]);
  assert.deepEqual(identical.map((result) => result.replayed).sort(), [false, true]);
  assert.equal(identical[0].message_id, identical[1].message_id);
  assert.equal(Number((await taskClient.get<{ n: string }>("SELECT COUNT(*) AS n FROM incident_projections"))?.n), 2);
  assert.equal(Number((await taskClient.get<{ n: string }>("SELECT COUNT(*) AS n FROM messages"))?.n), 2);
  assert.equal(Number((await taskClient.get<{ n: string }>("SELECT COUNT(*) AS n FROM incident_projection_scopes"))?.n), 8);

  const raceIncident = "77777777-7777-4777-8777-777777777777";
  const raceA = eventVersion(fixture, raceIncident, 1, "2026-07-18T20:03:00.000Z");
  raceA.incident.created_at = raceA.occurred_at;
  raceA.incident.title = "race candidate A";
  const raceB = clone(raceA);
  raceB.incident.title = "race candidate B";
  const raced = await Promise.allSettled([
    appendIncidentProjectionPg(taskClient, raceA, context),
    appendIncidentProjectionPg(taskClient, raceB, context),
  ]);
  assert.equal(raced.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = raced.find((result) => result.status === "rejected");
  assert(rejected && rejected.status === "rejected");
  assert(rejected.reason instanceof IncidentProjectionConflictError);
  assert.equal(Number((await taskClient.get<{ n: string }>("SELECT COUNT(*) AS n FROM messages"))?.n), 3);

  const v2 = eventVersion(fixture, fixture.incident_id, 2, "2026-07-18T20:04:00.000Z");
  const routed = await appendIncidentProjectionPg(taskClient, v2, {
    ...context,
    routing: { channel: "incident-archive", project_id: "platform-hirefast" },
  });
  assert.equal(routed.message.reply_to, httpCreated.projection.message_id);
  assert.equal(routed.message.channel, "incidents");
  assert.equal(routed.message.project_id, "wks_8vJJzXTiFo6sxwRkpPqoI");

  const oldIncidentId = "99999999-9999-4999-8999-999999999991";
  const replacementIncidentId = "99999999-9999-4999-8999-999999999992";
  const handoffV1 = eventVersion(fixture, oldIncidentId, 1, "2026-07-18T20:10:00.000Z");
  handoffV1.incident.created_at = handoffV1.occurred_at;
  handoffV1.incident.blocked_scopes = ["agent:handoff-agent"];
  await appendIncidentProjectionPg(taskClient, handoffV1, context);
  const handoffV2 = eventVersion(handoffV1, oldIncidentId, 2, "2026-07-18T20:11:00.000Z");
  handoffV2.incident.status = "superseded";
  handoffV2.incident.next_action = null;
  handoffV2.incident.resolved_at = handoffV2.occurred_at;
  handoffV2.incident.superseded_by_id = replacementIncidentId;
  const pendingHandoff = await appendIncidentProjectionPg(taskClient, handoffV2, context);
  const handoffKey = mintApiKey({
    app: "conversations",
    agent: "handoff-agent",
    scopes: ["conversations:read", "conversations:write"],
    signingSecret,
  }).token;
  assert.deepEqual((await blockersFor("handoff-agent", handoffKey)).map((message) => message.id), [pendingHandoff.message_id]);
  const handoffAck = await fetch(`${apiBase}/v1/messages/read`, {
    method: "POST",
    headers: { "x-api-key": handoffKey, "content-type": "application/json" },
    body: JSON.stringify({ ids: [pendingHandoff.message_id] }),
  });
  assert.equal(handoffAck.status, 200);
  assert.deepEqual((await blockersFor("handoff-agent", handoffKey)).map((message) => message.id), [pendingHandoff.message_id]);
  const replacement = eventVersion(fixture, replacementIncidentId, 1, "2026-07-18T20:12:00.000Z");
  replacement.incident.created_at = replacement.occurred_at;
  replacement.incident.blocked_scopes = ["agent:handoff-agent"];
  replacement.incident.supersedes_id = oldIncidentId;
  const projectedReplacement = await appendIncidentProjectionPg(taskClient, replacement, context);
  assert.deepEqual((await blockersFor("handoff-agent", handoffKey)).map((message) => message.id), [projectedReplacement.message_id]);

  const missingV3 = eventVersion(fixture, fixture.incident_id, 4, "2026-07-18T20:05:00.000Z");
  await assert.rejects(
    appendIncidentProjectionPg(taskClient, missingV3, context),
    (error: unknown) => error instanceof IncidentProjectionConflictError,
  );

  const beforeAtomic = Number((await taskClient.get<{ n: string }>("SELECT COUNT(*) AS n FROM messages"))?.n);
  const missingSupersession = eventVersion(
    fixture,
    "88888888-8888-4888-8888-888888888888",
    1,
    "2026-07-18T20:06:00.000Z",
  );
  missingSupersession.incident.created_at = missingSupersession.occurred_at;
  missingSupersession.incident.supersedes_id = "99999999-9999-4999-8999-999999999999";
  await assert.rejects(
    appendIncidentProjectionPg(taskClient, missingSupersession, context),
    (error: unknown) => error instanceof IncidentProjectionConflictError,
  );
  assert.equal(Number((await taskClient.get<{ n: string }>("SELECT COUNT(*) AS n FROM messages"))?.n), beforeAtomic);

  await assert.rejects(taskClient.query(
    `INSERT INTO messages (session_id, from_agent, to_agent, channel, project_id, content, reply_to)
     VALUES ('channel:incidents','child','incidents','incidents','p','orphan',999999)`,
  ));
  const parent = await taskClient.one<{ id: string }>(
    `INSERT INTO messages (session_id, from_agent, to_agent, channel, project_id, content)
     VALUES ('channel:ops','alice','ops','ops','p','root') RETURNING id`,
  );
  await assert.rejects(taskClient.query(
    `INSERT INTO messages (session_id, from_agent, to_agent, channel, project_id, content, reply_to)
     VALUES ('channel:other','bob','other','other','p','cross-scope',$1)`,
    [parent.id],
  ));
  await taskClient.query(
    `INSERT INTO messages (session_id, from_agent, to_agent, channel, project_id, content, reply_to)
     VALUES ('channel:ops','bob','ops','ops','p','reply',$1)`,
    [parent.id],
  );
  await assert.rejects(taskClient.query("UPDATE messages SET project_id='other' WHERE id=$1", [parent.id]));
  await assert.rejects(taskClient.query("DELETE FROM messages WHERE id=$1", [parent.id]));
  await assert.rejects(taskClient.query(
    "UPDATE messages SET content='rewrite' WHERE id=$1",
    [httpCreated.projection.message_id],
  ));

  await taskClient.query(
    `INSERT INTO channels (name, created_by) VALUES ('pg-thread-old', 'verifier')`,
  );
  const threadParent = await taskClient.one<{ id: string }>(
    `INSERT INTO messages (session_id, from_agent, to_agent, channel, project_id, content)
     VALUES ('channel:pg-thread-old','alice','pg-thread-old','pg-thread-old','project-a','thread root')
     RETURNING id`,
  );
  const threadReply = await taskClient.one<{ id: string }>(
    `INSERT INTO messages (session_id, from_agent, to_agent, channel, project_id, content, reply_to)
     VALUES ('channel:pg-thread-old','bob','pg-thread-old','pg-thread-old','project-a','thread reply',$1)
     RETURNING id`,
    [threadParent.id],
  );
  const sessionOnlyParent = await taskClient.one<{ id: string }>(
    `INSERT INTO messages (session_id, from_agent, to_agent, project_id, content)
     VALUES ('channel:pg-thread-old','legacy-a','legacy-b','project-a','session-only root') RETURNING id`,
  );
  const sessionOnlyReply = await taskClient.one<{ id: string }>(
    `INSERT INTO messages (session_id, from_agent, to_agent, project_id, content, reply_to)
     VALUES ('channel:pg-thread-old','legacy-b','legacy-a','project-a','session-only reply',$1) RETURNING id`,
    [sessionOnlyParent.id],
  );
  assert.deepEqual(await renameChannelServer(taskClient, "pg-thread-old", "pg-thread-new"), {
    ok: true,
    name: "pg-thread-new",
  });
  const renamedThread = await taskClient.many<{
    id: string; session_id: string; channel: string; to_agent: string; project_id: string; reply_to: string | null; content: string;
  }>(
    `SELECT id, session_id, channel, to_agent, project_id, reply_to, content
     FROM messages WHERE id IN ($1,$2) ORDER BY id`,
    [threadParent.id, threadReply.id],
  );
  assert.equal(renamedThread.length, 2);
  assert(renamedThread.every((message) => message.session_id === "channel:pg-thread-new"));
  assert(renamedThread.every((message) => message.channel === "pg-thread-new"));
  assert(renamedThread.every((message) => message.to_agent === "pg-thread-new"));
  assert(renamedThread.every((message) => message.project_id === "project-a"));
  assert.equal(String(renamedThread[1].reply_to), String(threadParent.id));
  assert.deepEqual(renamedThread.map((message) => message.content), ["thread root", "thread reply"]);
  const renamedSessionOnly = await taskClient.many<{
    id: string; session_id: string; channel: string | null; project_id: string; reply_to: string | null;
  }>(
    `SELECT id, session_id, channel, project_id, reply_to FROM messages WHERE id IN ($1,$2) ORDER BY id`,
    [sessionOnlyParent.id, sessionOnlyReply.id],
  );
  assert.equal(renamedSessionOnly.length, 2);
  assert(renamedSessionOnly.every((message) => message.session_id === "channel:pg-thread-new"));
  assert(renamedSessionOnly.every((message) => message.channel === null));
  assert(renamedSessionOnly.every((message) => message.project_id === "project-a"));
  assert.equal(String(renamedSessionOnly[1].reply_to), String(sessionOnlyParent.id));
  await assert.rejects(taskClient.query("UPDATE messages SET project_id='other' WHERE id=$1", [threadParent.id]));

  await taskClient.query(`INSERT INTO channels (name, created_by) VALUES ('pg-fail-old', 'verifier')`);
  const failedParent = await taskClient.one<{ id: string }>(
    `INSERT INTO messages (session_id, from_agent, to_agent, channel, project_id, content)
     VALUES ('channel:pg-fail-old','alice','pg-fail-old','pg-fail-old','project-a','failed root') RETURNING id`,
  );
  await taskClient.query(
    `INSERT INTO messages (session_id, from_agent, to_agent, channel, project_id, content, reply_to)
     VALUES ('channel:pg-fail-old','bob','pg-fail-old','pg-fail-old','project-a','failed reply',$1)`,
    [failedParent.id],
  );
  await taskClient.execute(`
    CREATE OR REPLACE FUNCTION fail_verifier_channel_rename() RETURNS trigger AS $$
    BEGIN
      IF NEW.channel = 'pg-fail-new' THEN RAISE EXCEPTION 'injected rename failure'; END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER fail_verifier_channel_rename_trigger
      BEFORE UPDATE OF channel ON messages FOR EACH ROW
      EXECUTE FUNCTION fail_verifier_channel_rename();
  `);
  const guardReusePool = new Pool(localPoolConfig(database, 1));
  guardReuseClient = createQueryClient(guardReusePool);
  await assert.rejects(renameChannelServer(guardReuseClient, "pg-fail-old", "pg-fail-new"));
  await guardReuseClient.transaction(async (tx) => {
    const guard = await tx.get<{ value: string | null }>(
      `SELECT current_setting('hasna.conversations.channel_scope_rewrite', TRUE) AS value`,
    );
    assert(!guard?.value);
    await assert.rejects(tx.query(
      `UPDATE messages
       SET session_id='channel:pg-fail-new', channel='pg-fail-new', to_agent='pg-fail-new'
       WHERE id=$1`,
      [failedParent.id],
    ));
  });
  assert(await taskClient.get("SELECT name FROM channels WHERE name='pg-fail-old'"));
  assert.equal(await taskClient.get("SELECT name FROM channels WHERE name='pg-fail-new'"), null);
  const failedMessages = await taskClient.many<{ session_id: string; channel: string; to_agent: string }>(
    "SELECT session_id, channel, to_agent FROM messages WHERE channel='pg-fail-old' ORDER BY id",
  );
  assert.equal(failedMessages.length, 2);
  assert(failedMessages.every((message) => message.session_id === "channel:pg-fail-old"));
  assert(failedMessages.every((message) => message.to_agent === "pg-fail-old"));
  await taskClient.execute(`
    DROP TRIGGER fail_verifier_channel_rename_trigger ON messages;
    DROP FUNCTION fail_verifier_channel_rename();
  `);

  // Deterministic projector-first race: the projection holds the source
  // channel row lock while a trigger pauses its message insert. Rename must
  // wait, then rewrite the committed projection to the new current channel.
  await taskClient.query(`INSERT INTO channels (name, created_by) VALUES ('pg-race-old', 'verifier')`);
  await taskClient.query(
    `INSERT INTO channel_members (channel, agent) VALUES ('pg-race-old', 'race-reader')`,
  );
  await taskClient.execute(`
    CREATE OR REPLACE FUNCTION pause_verifier_projection_insert() RETURNS trigger AS $$
    BEGIN
      IF NEW.content LIKE '%PG channel rename race%' THEN
        PERFORM pg_advisory_xact_lock(520048);
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER pause_verifier_projection_insert_trigger
      BEFORE INSERT ON messages FOR EACH ROW
      EXECUTE FUNCTION pause_verifier_projection_insert();
  `);
  const raceEvent = eventVersion(
    fixture,
    "13131313-1313-4313-8313-131313131313",
    1,
    "2026-07-18T20:13:00.000Z",
  );
  raceEvent.incident.created_at = raceEvent.occurred_at;
  raceEvent.incident.title = "PG channel rename race";
  raceEvent.incident.blocked_scopes = ["channel:pg-race-old"];
  const raceContext: IncidentProjectorContext = {
    ...context,
    routing: { channel: "pg-race-old", project_id: "wks_8vJJzXTiFo6sxwRkpPqoI" },
  };
  let releaseAdvisory = (): void => {};
  let signalAdvisoryHeld = (): void => {};
  const advisoryHeld = new Promise<void>((resolve) => { signalAdvisoryHeld = resolve; });
  const advisoryRelease = new Promise<void>((resolve) => { releaseAdvisory = resolve; });
  const advisoryController = taskClient.transaction(async (tx) => {
    await tx.get("SELECT pg_advisory_xact_lock(520048) AS locked");
    signalAdvisoryHeld();
    await advisoryRelease;
  });
  let raceProjectionPromise: ReturnType<typeof appendIncidentProjectionPg> | null = null;
  let raceRenamePromise: ReturnType<typeof renameChannelServer> | null = null;
  let raceProjection: Awaited<ReturnType<typeof appendIncidentProjectionPg>> | null = null;
  try {
    await advisoryHeld;
    raceProjectionPromise = appendIncidentProjectionPg(taskClient, raceEvent, raceContext);
    await waitForPg(async () => Number((await taskClient.get<{ n: string }>(
      `SELECT COUNT(*) AS n FROM pg_locks
       WHERE locktype='advisory' AND granted=FALSE AND objid=520048`,
    ))?.n ?? 0) > 0, "projection waiting on verifier advisory lock");
    raceRenamePromise = renameChannelServer(taskClient, "pg-race-old", "pg-race-new");
    await waitForPg(async () => Number((await taskClient.get<{ n: string }>(
      `SELECT COUNT(*) AS n FROM pg_locks
       WHERE locktype='advisory' AND granted=FALSE AND objid=$1`,
      [CHANNEL_IDENTITY_ADVISORY_LOCK],
    ))?.n ?? 0) > 0, "rename waiting on projector channel identity lock");
    releaseAdvisory();
    raceProjection = await raceProjectionPromise;
    assert.deepEqual(await raceRenamePromise, { ok: true, name: "pg-race-new" });
    await advisoryController;
  } finally {
    releaseAdvisory();
    await Promise.allSettled([
      advisoryController,
      ...(raceProjectionPromise ? [raceProjectionPromise] : []),
      ...(raceRenamePromise ? [raceRenamePromise] : []),
    ]);
    await taskClient.execute(`
      DROP TRIGGER IF EXISTS pause_verifier_projection_insert_trigger ON messages;
      DROP FUNCTION IF EXISTS pause_verifier_projection_insert();
    `);
  }
  assert(raceProjection);
  const racedMessage = await taskClient.one<{ channel: string; session_id: string; to_agent: string }>(
    "SELECT channel, session_id, to_agent FROM messages WHERE id=$1",
    [raceProjection.message_id],
  );
  assert.deepEqual(racedMessage, {
    channel: "pg-race-new",
    session_id: "channel:pg-race-new",
    to_agent: "pg-race-new",
  });
  const raceReaderKey = mintApiKey({
    app: "conversations",
    agent: "race-reader",
    scopes: ["conversations:read", "conversations:write"],
    signingSecret,
  }).token;
  assert((await blockersFor("race-reader", raceReaderKey)).some(
    (message) => message.id === raceProjection!.message_id,
  ));

  await taskClient.execute(`
    CREATE OR REPLACE FUNCTION pause_verifier_v2_insert() RETURNS trigger AS $$
    BEGIN
      IF NEW.content LIKE '%PG channel rename race%' AND NEW.reply_to IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(520051);
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER pause_verifier_v2_insert_trigger
      BEFORE INSERT ON messages FOR EACH ROW
      EXECUTE FUNCTION pause_verifier_v2_insert();
  `);
  const raceV2Event = eventVersion(
    raceEvent,
    raceEvent.incident_id,
    2,
    "2026-07-18T20:15:00.000Z",
  );
  const changedRaceContext: IncidentProjectorContext = {
    ...context,
    routing: { channel: "unrelated-config-route", project_id: "other-project" },
  };
  let releaseV2Advisory = (): void => {};
  let signalV2AdvisoryHeld = (): void => {};
  const v2AdvisoryHeld = new Promise<void>((resolve) => { signalV2AdvisoryHeld = resolve; });
  const v2AdvisoryRelease = new Promise<void>((resolve) => { releaseV2Advisory = resolve; });
  const v2AdvisoryController = taskClient.transaction(async (tx) => {
    await tx.get("SELECT pg_advisory_xact_lock(520051) AS locked");
    signalV2AdvisoryHeld();
    await v2AdvisoryRelease;
  });
  let raceV2Promise: ReturnType<typeof appendIncidentProjectionPg> | null = null;
  let raceV2RenamePromise: ReturnType<typeof renameChannelServer> | null = null;
  let raceV2: Awaited<ReturnType<typeof appendIncidentProjectionPg>> | null = null;
  try {
    await v2AdvisoryHeld;
    raceV2Promise = appendIncidentProjectionPg(taskClient, raceV2Event, changedRaceContext);
    await waitForPg(async () => Number((await taskClient.get<{ n: string }>(
      `SELECT COUNT(*) AS n FROM pg_locks
       WHERE locktype='advisory' AND granted=FALSE AND objid=520051`,
    ))?.n ?? 0) > 0, "v2 projection waiting after inheriting root routing");
    raceV2RenamePromise = renameChannelServer(taskClient, "pg-race-new", "pg-race-final");
    await waitForPg(async () => Number((await taskClient.get<{ n: string }>(
      `SELECT COUNT(*) AS n FROM pg_locks
       WHERE locktype='advisory' AND granted=FALSE AND objid=$1`,
      [CHANNEL_IDENTITY_ADVISORY_LOCK],
    ))?.n ?? 0) > 0, "root-channel rename waiting on v2 projector identity fence");
    releaseV2Advisory();
    raceV2 = await raceV2Promise;
    assert.deepEqual(await raceV2RenamePromise, { ok: true, name: "pg-race-final" });
    await v2AdvisoryController;
  } finally {
    releaseV2Advisory();
    await Promise.allSettled([
      v2AdvisoryController,
      ...(raceV2Promise ? [raceV2Promise] : []),
      ...(raceV2RenamePromise ? [raceV2RenamePromise] : []),
    ]);
    await taskClient.execute(`
      DROP TRIGGER IF EXISTS pause_verifier_v2_insert_trigger ON messages;
      DROP FUNCTION IF EXISTS pause_verifier_v2_insert();
    `);
  }
  assert(raceV2);
  const racedThread = await taskClient.many<{
    id: string; channel: string; session_id: string; to_agent: string; project_id: string; reply_to: string | null;
  }>(
    `SELECT id, channel, session_id, to_agent, project_id, reply_to
     FROM messages WHERE id IN ($1,$2) ORDER BY id`,
    [raceProjection.message_id, raceV2.message_id],
  );
  assert.equal(racedThread.length, 2);
  assert(racedThread.every((message) => message.channel === "pg-race-final"));
  assert(racedThread.every((message) => message.session_id === "channel:pg-race-final"));
  assert(racedThread.every((message) => message.to_agent === "pg-race-final"));
  assert(racedThread.every((message) => message.project_id === "wks_8vJJzXTiFo6sxwRkpPqoI"));
  assert.equal(String(racedThread[1].reply_to), String(raceProjection.message_id));
  assert((await blockersFor("race-reader", raceReaderKey)).some(
    (message) => message.id === raceV2!.message_id,
  ));

  // Deterministic rename-first race: rename holds the old channel row and
  // pauses before creating the replacement. The projector waits on that row,
  // then must re-read the committed alias and insert directly into the new
  // channel rather than leaving a stale post-scan message behind.
  await taskClient.query(`INSERT INTO channels (name, created_by) VALUES ('pg-race2-old', 'verifier')`);
  await taskClient.query(
    `INSERT INTO channel_members (channel, agent) VALUES ('pg-race2-old', 'race2-reader')`,
  );
  await taskClient.execute(`
    CREATE OR REPLACE FUNCTION pause_verifier_channel_create() RETURNS trigger AS $$
    BEGIN
      IF NEW.name = 'pg-race2-new' THEN
        PERFORM pg_advisory_xact_lock(520049);
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER pause_verifier_channel_create_trigger
      BEFORE INSERT ON channels FOR EACH ROW
      EXECUTE FUNCTION pause_verifier_channel_create();
  `);
  const race2Event = eventVersion(
    fixture,
    "14141414-1414-4414-8414-141414141414",
    1,
    "2026-07-18T20:14:00.000Z",
  );
  race2Event.incident.created_at = race2Event.occurred_at;
  race2Event.incident.blocked_scopes = ["channel:pg-race2-old"];
  const race2Context: IncidentProjectorContext = {
    ...context,
    routing: { channel: "pg-race2-old", project_id: "wks_8vJJzXTiFo6sxwRkpPqoI" },
  };
  let releaseRenameAdvisory = (): void => {};
  let signalRenameAdvisoryHeld = (): void => {};
  const renameAdvisoryHeld = new Promise<void>((resolve) => { signalRenameAdvisoryHeld = resolve; });
  const renameAdvisoryRelease = new Promise<void>((resolve) => { releaseRenameAdvisory = resolve; });
  const renameAdvisoryController = taskClient.transaction(async (tx) => {
    await tx.get("SELECT pg_advisory_xact_lock(520049) AS locked");
    signalRenameAdvisoryHeld();
    await renameAdvisoryRelease;
  });
  let race2RenamePromise: ReturnType<typeof renameChannelServer> | null = null;
  let race2ProjectionPromise: ReturnType<typeof appendIncidentProjectionPg> | null = null;
  let race2Projection: Awaited<ReturnType<typeof appendIncidentProjectionPg>> | null = null;
  try {
    await renameAdvisoryHeld;
    race2RenamePromise = renameChannelServer(taskClient, "pg-race2-old", "pg-race2-new");
    await waitForPg(async () => Number((await taskClient.get<{ n: string }>(
      `SELECT COUNT(*) AS n FROM pg_locks
       WHERE locktype='advisory' AND granted=FALSE AND objid=520049`,
    ))?.n ?? 0) > 0, "rename waiting on verifier advisory lock");
    race2ProjectionPromise = appendIncidentProjectionPg(taskClient, race2Event, race2Context);
    await waitForPg(async () => Number((await taskClient.get<{ n: string }>(
      `SELECT COUNT(*) AS n FROM pg_locks
       WHERE locktype='advisory' AND granted=FALSE AND objid=$1`,
      [CHANNEL_IDENTITY_ADVISORY_LOCK],
    ))?.n ?? 0) > 0, "projector waiting on rename channel identity lock");
    releaseRenameAdvisory();
    assert.deepEqual(await race2RenamePromise, { ok: true, name: "pg-race2-new" });
    race2Projection = await race2ProjectionPromise;
    await renameAdvisoryController;
  } finally {
    releaseRenameAdvisory();
    await Promise.allSettled([
      renameAdvisoryController,
      ...(race2RenamePromise ? [race2RenamePromise] : []),
      ...(race2ProjectionPromise ? [race2ProjectionPromise] : []),
    ]);
    await taskClient.execute(`
      DROP TRIGGER IF EXISTS pause_verifier_channel_create_trigger ON channels;
      DROP FUNCTION IF EXISTS pause_verifier_channel_create();
    `);
  }
  assert(race2Projection);
  const race2Message = await taskClient.one<{ channel: string; session_id: string; to_agent: string }>(
    "SELECT channel, session_id, to_agent FROM messages WHERE id=$1",
    [race2Projection.message_id],
  );
  assert.deepEqual(race2Message, {
    channel: "pg-race2-new",
    session_id: "channel:pg-race2-new",
    to_agent: "pg-race2-new",
  });
  const race2ReaderKey = mintApiKey({
    app: "conversations",
    agent: "race2-reader",
    scopes: ["conversations:read", "conversations:write"],
    signingSecret,
  }).token;
  assert((await blockersFor("race2-reader", race2ReaderKey)).some(
    (message) => message.id === race2Projection!.message_id,
  ));

  // Missing-channel race: a projection may legitimately arrive before the
  // routed channel exists. The shared global identity fence must make channel
  // creation wait even though no row exists to lock; the following rename then
  // rewrites the committed display atomically instead of leaving stale routing.
  await taskClient.execute(`
    CREATE OR REPLACE FUNCTION pause_verifier_absent_projection() RETURNS trigger AS $$
    BEGIN
      IF NEW.content LIKE '%PG absent channel race%' THEN
        PERFORM pg_advisory_xact_lock(520052);
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER pause_verifier_absent_projection_trigger
      BEFORE INSERT ON messages FOR EACH ROW
      EXECUTE FUNCTION pause_verifier_absent_projection();
  `);
  const absentEvent = eventVersion(
    fixture,
    "15151515-1515-4515-8515-151515151515",
    1,
    "2026-07-18T20:16:00.000Z",
  );
  absentEvent.incident.created_at = absentEvent.occurred_at;
  absentEvent.incident.title = "PG absent channel race";
  absentEvent.incident.blocked_scopes = ["channel:pg-absent-old"];
  const absentContext: IncidentProjectorContext = {
    ...context,
    routing: { channel: "pg-absent-old", project_id: "wks_8vJJzXTiFo6sxwRkpPqoI" },
  };
  let releaseAbsentAdvisory = (): void => {};
  let signalAbsentAdvisoryHeld = (): void => {};
  const absentAdvisoryHeld = new Promise<void>((resolve) => { signalAbsentAdvisoryHeld = resolve; });
  const absentAdvisoryRelease = new Promise<void>((resolve) => { releaseAbsentAdvisory = resolve; });
  const absentAdvisoryController = taskClient.transaction(async (tx) => {
    await tx.get("SELECT pg_advisory_xact_lock(520052) AS locked");
    signalAbsentAdvisoryHeld();
    await absentAdvisoryRelease;
  });
  let absentProjectionPromise: ReturnType<typeof appendIncidentProjectionPg> | null = null;
  let absentCreatePromise: Promise<Response> | null = null;
  let absentProjection: Awaited<ReturnType<typeof appendIncidentProjectionPg>> | null = null;
  try {
    await absentAdvisoryHeld;
    absentProjectionPromise = appendIncidentProjectionPg(taskClient, absentEvent, absentContext);
    await waitForPg(async () => Number((await taskClient.get<{ n: string }>(
      `SELECT COUNT(*) AS n FROM pg_locks
       WHERE locktype='advisory' AND granted=FALSE AND objid=520052`,
    ))?.n ?? 0) > 0, "absent-channel projection waiting after routing resolution");
    absentCreatePromise = fetch(`${apiBase}/v1/channels`, {
      method: "POST",
      headers: { "x-api-key": readerTwoKey, "content-type": "application/json" },
      body: JSON.stringify({ name: "pg-absent-old", created_by: "projector-02" }),
    });
    await waitForPg(async () => Number((await taskClient.get<{ n: string }>(
      `SELECT COUNT(*) AS n FROM pg_locks
       WHERE locktype='advisory' AND granted=FALSE AND objid=$1`,
      [CHANNEL_IDENTITY_ADVISORY_LOCK],
    ))?.n ?? 0) > 0, "channel create waiting on absent-channel projector identity fence");
    releaseAbsentAdvisory();
    absentProjection = await absentProjectionPromise;
    const createdAbsentChannel = await absentCreatePromise;
    assert.equal(createdAbsentChannel.status, 201);
    assert.deepEqual(await renameChannelServer(taskClient, "pg-absent-old", "pg-absent-new"), {
      ok: true,
      name: "pg-absent-new",
    });
    await absentAdvisoryController;
  } finally {
    releaseAbsentAdvisory();
    await Promise.allSettled([
      absentAdvisoryController,
      ...(absentProjectionPromise ? [absentProjectionPromise] : []),
      ...(absentCreatePromise ? [absentCreatePromise] : []),
    ]);
    await taskClient.execute(`
      DROP TRIGGER IF EXISTS pause_verifier_absent_projection_trigger ON messages;
      DROP FUNCTION IF EXISTS pause_verifier_absent_projection();
    `);
  }
  assert(absentProjection);
  assert.deepEqual(
    await taskClient.one<{ channel: string; session_id: string; to_agent: string }>(
      "SELECT channel, session_id, to_agent FROM messages WHERE id=$1",
      [absentProjection.message_id],
    ),
    { channel: "pg-absent-new", session_id: "channel:pg-absent-new", to_agent: "pg-absent-new" },
  );
  assert((await blockersFor("projector-02", readerTwoKey)).some(
    (message) => message.id === absentProjection!.message_id,
  ));

  const projectedBeforeRename = await taskClient.one<Record<string, unknown>>(
    "SELECT * FROM messages WHERE id=$1",
    [httpCreated.projection.message_id],
  );
  const projectedReplyBeforeRename = await taskClient.one<Record<string, unknown>>(
    "SELECT * FROM messages WHERE id=$1",
    [routed.message_id],
  );
  const canonicalChannelScopesBeforeRename = await taskClient.many<{ scope: string }>(
    `SELECT scope FROM incident_projection_scopes
     WHERE projection_id=$1 AND scope_type='blocked' ORDER BY scope`,
    [routed.id],
  );
  assert((await blockersFor("projector-02", readerTwoKey)).some(
    (message) => message.id === routed.message_id,
  ));
  assert.deepEqual(await renameChannelServer(taskClient, "incidents", "incident-log"), {
    ok: true,
    name: "incident-log",
  });
  const projectedAfterRename = await taskClient.one<Record<string, unknown>>(
    "SELECT * FROM messages WHERE id=$1",
    [httpCreated.projection.message_id],
  );
  const projectedReplyAfterRename = await taskClient.one<Record<string, unknown>>(
    "SELECT * FROM messages WHERE id=$1",
    [routed.message_id],
  );
  assert.equal(projectedAfterRename.session_id, "channel:incident-log");
  assert.equal(projectedAfterRename.channel, "incident-log");
  assert.equal(projectedAfterRename.to_agent, "incident-log");
  for (const field of [
    "uuid", "from_agent", "project_id", "content", "priority", "working_dir", "repository", "branch",
    "metadata", "created_at", "read_at", "edited_at", "pinned_at", "blocking", "attachments", "reply_to",
  ]) {
    assert.deepEqual(projectedAfterRename[field], projectedBeforeRename[field], `projected field changed: ${field}`);
  }
  assert.equal(projectedReplyAfterRename.session_id, "channel:incident-log");
  assert.equal(projectedReplyAfterRename.channel, "incident-log");
  assert.equal(projectedReplyAfterRename.to_agent, "incident-log");
  assert.equal(String(projectedReplyAfterRename.reply_to), String(httpCreated.projection.message_id));
  for (const field of [
    "uuid", "from_agent", "project_id", "content", "priority", "working_dir", "repository", "branch",
    "metadata", "created_at", "read_at", "edited_at", "pinned_at", "blocking", "attachments", "reply_to",
  ]) {
    assert.deepEqual(
      projectedReplyAfterRename[field],
      projectedReplyBeforeRename[field],
      `projected reply field changed: ${field}`,
    );
  }
  await assert.rejects(taskClient.query(
    "UPDATE messages SET content='rewrite after rename' WHERE id=$1",
    [httpCreated.projection.message_id],
  ));

  assert((await blockersFor("projector-02", readerTwoKey)).some(
    (message) => message.id === routed.message_id,
  ));
  assert.deepEqual(await renameChannelServer(taskClient, "incident-log", "incident-archive"), {
    ok: true,
    name: "incident-archive",
  });
  assert((await blockersFor("projector-02", readerTwoKey)).some(
    (message) => message.id === routed.message_id,
  ));
  assert.deepEqual(
    await taskClient.many<{ scope: string }>(
      `SELECT scope FROM incident_projection_scopes
       WHERE projection_id=$1 AND scope_type='blocked' ORDER BY scope`,
      [routed.id],
    ),
    canonicalChannelScopesBeforeRename,
  );
  assert.deepEqual(
    await taskClient.many<{ old_channel: string; current_channel: string }>(
      `SELECT old_channel, current_channel FROM channel_rename_aliases
       WHERE old_channel IN ('incidents','incident-log') ORDER BY old_channel`,
    ),
    [
      { old_channel: "incident-log", current_channel: "incident-archive" },
      { old_channel: "incidents", current_channel: "incident-archive" },
    ],
  );

  const postRenameEvent = eventVersion(
    fixture,
    "12121212-1212-4212-8212-121212121212",
    1,
    "2026-07-18T20:12:00.000Z",
  );
  postRenameEvent.incident.created_at = postRenameEvent.occurred_at;
  const postRenameProjection = await sdk.appendIncidentProjection(postRenameEvent);
  assert.equal(postRenameProjection.projection.message.channel, "incident-archive");
  assert.equal(postRenameProjection.projection.message.session_id, "channel:incident-archive");
  assert.equal(postRenameProjection.projection.message.to_agent, "incident-archive");
  const blockersAfterChain = await blockersFor("projector-02", readerTwoKey);
  assert(blockersAfterChain.some((message) => message.id === routed.message_id));
  assert(blockersAfterChain.some((message) => message.id === postRenameProjection.projection.message_id));
  assert.deepEqual(await blockersFor("outsider", outsiderKey), []);

  const channelReceipt = await fetch(`${apiBase}/v1/messages/read`, {
    method: "POST",
    headers: { "x-api-key": readerTwoKey, "content-type": "application/json" },
    body: JSON.stringify({ ids: [routed.message_id] }),
  });
  assert.equal(channelReceipt.status, 200);
  assert.equal((await channelReceipt.json() as { marked: number }).marked, 1);
  const repeatedChannelReceipt = await fetch(`${apiBase}/v1/messages/read`, {
    method: "POST",
    headers: { "x-api-key": readerTwoKey, "content-type": "application/json" },
    body: JSON.stringify({ ids: [routed.message_id] }),
  });
  assert.equal(repeatedChannelReceipt.status, 200);
  assert.equal((await repeatedChannelReceipt.json() as { marked: number }).marked, 0);
  const blockersAfterReceipt = await blockersFor("projector-02", readerTwoKey);
  assert(!blockersAfterReceipt.some((message) => message.id === routed.message_id));
  assert(blockersAfterReceipt.some((message) => message.id === postRenameProjection.projection.message_id));

  const recreateHistoricalAlias = await fetch(`${apiBase}/v1/channels`, {
    method: "POST",
    headers: { "x-api-key": readerTwoKey, "content-type": "application/json" },
    body: JSON.stringify({ name: "incidents", created_by: "projector-02" }),
  });
  assert.equal(recreateHistoricalAlias.status, 409);
  await taskClient.query(`INSERT INTO channels (name, created_by) VALUES ('unrelated-channel', 'verifier')`);
  assert.deepEqual(await renameChannelServer(taskClient, "unrelated-channel", "incidents"), {
    ok: false,
    error: "Channel #incidents is a reserved historical alias for #incident-archive.",
    status: 409,
  });
  assert.deepEqual(await renameChannelServer(taskClient, "incident-archive", "incidents"), {
    ok: true,
    name: "incidents",
  });
  assert((await blockersFor("projector-02", readerTwoKey)).some(
    (message) => message.id === postRenameProjection.projection.message_id,
  ));
  assert.deepEqual(
    await taskClient.many<{ old_channel: string; current_channel: string }>(
      `SELECT old_channel, current_channel FROM channel_rename_aliases
       WHERE old_channel IN ('incidents','incident-log','incident-archive') ORDER BY old_channel`,
    ),
    [
      { old_channel: "incident-archive", current_channel: "incidents" },
      { old_channel: "incident-log", current_channel: "incidents" },
    ],
  );

  console.log(`ok incident projection PG integration database=${database} cleanup=pending`);
} finally {
  if (apiServer) apiServer.stop(true);
  if (guardReuseClient) await guardReuseClient.close();
  if (taskClient) await taskClient.close();
  try {
    if (databaseCreated) {
      await admin.query(`DROP DATABASE ${quotedDatabase} WITH (FORCE)`);
    }
  } finally {
    await admin.end();
  }
  console.log(`ok incident projection PG integration cleanup database=${database}`);
}
