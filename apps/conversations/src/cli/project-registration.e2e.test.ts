import { adoptCorpus, inspectCorpus } from "../server/corpus-binding.js";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { Pool } from "pg";
import { ApiKeyStore, mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import { createQueryClient } from "../generated/storage-kit/query.js";
import { PG_MIGRATIONS } from "../lib/pg-migrations.js";
import { startApiServer } from "../server/api.js";
import { assertNoClientDatabase } from "../lib/store/test-support/loopback-api-fixture.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectChannelRegistrationDigest } from "../lib/project-channel-registration.js";

const TEST_DIR = mkdtempSync(join(tmpdir(), "conversations-project-registration-cli-"));
const CLIENT_HOME = join(TEST_DIR, "client");
const UNAUTHENTICATED_HOME = join(TEST_DIR, "unauthenticated");
mkdirSync(CLIENT_HOME, { mode: 0o700 });
mkdirSync(UNAUTHENTICATED_HOME, { mode: 0o700 });
// This durable contract runs in the required live-PostgreSQL gate. The ordinary
// package suite still exercises the unauthenticated, no-client-database boundary.
const dsn = process.env.CONVERSATIONS_TEST_DATABASE_URL;
const pgTest = dsn ? test : test.skip;
const schema = `registration_${randomUUID().replaceAll("-", "")}`;
const role = `${schema}_role`;
let admin: Pool | undefined;
let pool: Pool;
let server: ReturnType<typeof startApiServer> | undefined;
let clientEnv: Record<string, string>;
let startBackend: () => Promise<void>;
const REQUEST_FILE = join(TEST_DIR, "registration.json");
const LOOKUP_FILE = join(TEST_DIR, "registration-lookup.json");
const INVERSE_FORWARD_FILE = join(TEST_DIR, "registration-inverse-forward.json");
const INVERSE_FILE = join(TEST_DIR, "registration-inverse.json");
const BIND_FILE = join(TEST_DIR, "registration-bind-existing.json");
const BIND_NO_INTENT_FILE = join(TEST_DIR, "registration-bind-existing-no-intent.json");
const ADOPT_NO_INTENT_FILE = join(TEST_DIR, "registration-adopt-existing-no-intent.json");
const BIND_INVERSE_FILE = join(TEST_DIR, "registration-bind-existing-inverse.json");
const PROJECT_ID = "wks_ys8tzpsZJMNtx0ORZtLsA";
const PACKAGE_ROOT = join(import.meta.dir, "../..");
const CLI = [process.execPath, "--no-env-file", "./src/cli/index.tsx"];

function isolatedEnv(home: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home,
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    HASNA_STATION: `fixture-${randomUUID()}`,
    CONVERSATIONS_AGENT_ID: "project-registration-cli-test",
    FORCE_COLOR: "0", NO_COLOR: "1",
  };
}

async function runCli(args: string[], env = clientEnv) {
  // Async subprocesses let the real in-process HTTP server service requests.
  const child = Bun.spawn([...CLI, ...args], {
    cwd: PACKAGE_ROOT, env, stdout: "pipe", stderr: "pipe",
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 15_000);
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    return { exitCode, stdout, stderr };
  } finally { clearTimeout(timeout); }
}

beforeAll(async () => {
  if (!dsn) return;
  admin = new Pool({ connectionString: dsn, max: 1, connectionTimeoutMillis: 5_000 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const setup = new Pool({ connectionString: dsn, options: `-csearch_path=${schema}`, max: 1 });
  try {
    for (const sql of PG_MIGRATIONS) await setup.query(sql);
    const ownerClient = createQueryClient(setup);
    await adoptCorpus(ownerClient, { ...await inspectCorpus(ownerClient), tenant_id: "default", authority_id: "conversations", actor: "fixture-operator" });
    await admin.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
    await admin.query(`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${role}`);
  } finally { await setup.end(); }
  const signingSecret = randomBytes(32);
  const minted = mintApiKey({ app: "conversations", tid: "default", agent: "registration-fixture", scopes: ["conversations:read", "conversations:write"], signingSecret });
  clientEnv = isolatedEnv(CLIENT_HOME);
  startBackend = async () => {
    pool = new Pool({ connectionString: dsn, options: `-csearch_path=${schema} -crole=${role}`, max: 4 });
    const identity = (await pool.query("SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
    expect(identity).toEqual({ name: role, rolsuper: false, rolbypassrls: false });
    const client = createQueryClient(pool);
    server = startApiServer({ port: 0, host: "127.0.0.1", deps: {
      client, keys: new ApiKeyStore(client), incidentProjector: null,
      verifier: verifyApiKey({ app: "conversations", signingSecret,
        keyStatus: async kid => kid === minted.kid ? "active" : "unknown" }),
    } });
    const url = `http://127.0.0.1:${server.port}`;
    const config = join(CLIENT_HOME, ".hasna", "conversations", "config");
    mkdirSync(config, { recursive: true, mode: 0o700 });
    writeFileSync(join(config, "credentials"), `HASNA_CONVERSATIONS_API_URL=${url}\nHASNA_CONVERSATIONS_API_KEY=${minted.token}\n`, { mode: 0o600 });
    expect((await fetch(`${url}/v1/project-registration/channels/capability`)).status).toBe(401);
  };
  await startBackend();
}, 60_000);

afterAll(async () => {
  try {
    server?.stop(true);
    await pool?.end();
    if (admin) {
      try {
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await admin.query(`DROP ROLE IF EXISTS ${role}`);
      } finally { await admin.end(); }
    }
    assertNoClientDatabase(CLIENT_HOME);
    assertNoClientDatabase(UNAUTHENTICATED_HOME);
  } finally { rmSync(TEST_DIR, { recursive: true, force: true }); }
}, 30_000);

test("project-registration requires shared API credentials without creating a client database", async () => {
  const result = await runCli(["project-registration", "capability", "--json"], isolatedEnv(UNAUTHENTICATED_HOME));
  expect(result.exitCode).toBe(1);
  expect(`${result.stdout}\n${result.stderr}`).toContain("HASNA_CONVERSATIONS_API_KEY");
  assertNoClientDatabase(UNAUTHENTICATED_HOME);
});

describe("project-registration CLI producer contract", () => {
  pgTest("creates one channel and drains its inherited parent/reply collection", async () => {
    const capabilityResult = await runCli(["project-registration", "capability", "--json"]);
    expect(capabilityResult.exitCode, capabilityResult.stderr).toBe(0);
    const capability = JSON.parse(capabilityResult.stdout) as {
      route: string;
      package_version: string;
      authority_id: string;
      tenant_id: string;
      corpus_id: string;
    };
    const desired = {
      channel: "cli-project-feed",
      project_id: PROJECT_ID,
      project_slug: "cli-project-feed",
      project_kind: "work",
    };
    writeFileSync(REQUEST_FILE, JSON.stringify({
      operation_id: "cli-operation",
      step_id: "conversations-channel",
      resource_kind: "channel",
      direction: "forward",
      authority_route: capability.route,
      package_version: capability.package_version,
      authority_id: capability.authority_id,
      tenant_id: capability.tenant_id,
      corpus_id: capability.corpus_id,
      target_selector: "cli-project-feed",
      idempotency_key: "cli-operation:conversations-channel:forward",
      request_digest: projectChannelRegistrationDigest(desired),
      precondition_digest: projectChannelRegistrationDigest({
        target_selector: "cli-project-feed",
        expected: "absent",
      }),
      project_id: PROJECT_ID,
      project_slug: "cli-project-feed",
      project_name: "CLI Project Feed",
      desired,
      target_digest: "cli-target-digest",
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    }));

    const createdResult = await runCli([
      "project-registration",
      "create",
      "--request",
      REQUEST_FILE,
      "--json",
    ]);
    expect(createdResult.exitCode, createdResult.stderr).toBe(0);
    const created = JSON.parse(createdResult.stdout) as Record<string, any> & { target_id: string };
    expect(created.target_id).toMatch(/^chn_[0-9a-f]{32}$/);
    const bindWithCreateShape = await runCli([
      "project-registration",
      "bind-existing",
      "--request",
      REQUEST_FILE,
      "--json",
    ]);
    expect(bindWithCreateShape.exitCode).toBe(1);
    expect(bindWithCreateShape.stderr).toContain(
      "bind_existing surface requires operation_intent=bind_existing",
    );

    writeFileSync(LOOKUP_FILE, JSON.stringify({
      operation_id: created.operation_id,
      step_id: created.step_id,
      resource_kind: created.resource_kind,
      direction: created.direction,
      authority: created.authority,
      authority_route: created.route,
      package_version: created.package_version,
      authority_id: created.authority_id,
      tenant_id: created.tenant_id,
      corpus_id: created.corpus_id,
      target_selector: "cli-project-feed",
      idempotency_key: created.idempotency_key,
      request_digest: created.request_digest,
      precondition_digest: created.precondition_digest,
      max_items: 1,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    }));
    server!.stop(true);
    await pool.end();
    await startBackend();
    const restartedCapability = await runCli(["project-registration", "capability", "--json"]);
    expect(restartedCapability.exitCode, restartedCapability.stderr).toBe(0);
    expect(JSON.parse(restartedCapability.stdout)).toMatchObject(capability);
    const lookupResult = await runCli([
      "project-registration",
      "lookup-receipt",
      "--request",
      LOOKUP_FILE,
      "--json",
    ]);
    expect(lookupResult.exitCode, lookupResult.stderr).toBe(0);
    expect(JSON.parse(lookupResult.stdout).receipt).toMatchObject({
      receipt_id: created.receipt_id,
      outcome: "accepted",
      target_id: created.target_id,
    });

    expect((await pool.query("SELECT target_id,outcome FROM project_channel_registration_receipts WHERE receipt_id=$1", [created.receipt_id])).rows).toEqual([
      { target_id: created.target_id, outcome: "accepted" },
    ]);
    const replayResult = await runCli(["project-registration", "create", "--request", REQUEST_FILE, "--json"]);
    expect(replayResult.exitCode, replayResult.stderr).toBe(0);
    expect(JSON.parse(replayResult.stdout)).toMatchObject({ target_id: created.target_id, outcome: "duplicate_of_accepted" });
    expect(Number((await pool.query("SELECT count(*) FROM channels WHERE name=$1", [desired.channel])).rows[0].count)).toBe(1);

    const unboundResult = await runCli([
      "channel",
      "create",
      "cli-unbound",
      "--from",
      "alice",
      "--json",
    ]);
    expect(unboundResult.exitCode, unboundResult.stderr).toBe(0);

    const parentResult = await runCli([
      "channel",
      "send",
      "cli-project-feed",
      "parent",
      "--from",
      "alice",
      "--json",
    ]);
    expect(parentResult.exitCode, parentResult.stderr).toBe(0);
    const parent = JSON.parse(parentResult.stdout) as { id: number; uuid: string };
    const replyResult = await runCli([
      "reply",
      "--to",
      parent.uuid,
      "reply",
      "--from",
      "bob",
      "--json",
    ]);
    expect(replyResult.exitCode, replyResult.stderr).toBe(0);
    const reply = JSON.parse(replyResult.stdout) as { id: number; uuid: string };

    const channelsResult = await runCli([
      "project-registration",
      "channels",
      "--project",
      PROJECT_ID,
      "--limit",
      "1",
      "--json",
    ]);
    expect(channelsResult.exitCode, channelsResult.stderr).toBe(0);
    const channels = JSON.parse(channelsResult.stdout) as {
      items: Array<Record<string, unknown>>;
      complete: boolean;
      truncated: boolean;
    };
    expect(channels.items).toEqual([{
      target_id: created.target_id,
      channel: "cli-project-feed",
      authority: "conversations",
      resource_kind: "channel",
      scope: "collection",
      project_id: PROJECT_ID,
      revision: expect.any(String),
      digest: expect.any(String),
    }]);
    expect(channels.complete).toBe(true);
    expect(channels.truncated).toBe(false);

    await pool.query(
      "INSERT INTO channels (id,name,project_id,created_by) VALUES ($1,$2,$3,$4),($5,$6,$3,$4)",
      ["chn_10000000000000000000000000000000", "cli-project-first", PROJECT_ID, "tester",
        "chn_f0000000000000000000000000000000", "cli-project-last"],
    );

    const allChannelsResult = await runCli([
      "project-registration",
      "channels",
      "--project",
      PROJECT_ID,
      "--limit",
      "1",
      "--all",
      "--json",
    ]);
    expect(allChannelsResult.exitCode, allChannelsResult.stderr).toBe(0);
    const allChannels = JSON.parse(allChannelsResult.stdout) as {
      collection_revision: string;
      items: Array<{ target_id: string }>;
      item_count: number;
      next_cursor: string | null;
      complete: boolean;
      truncated: boolean;
    };
    expect(allChannels.collection_revision).toMatch(/^[0-9a-f]{64}$/);
    expect(allChannels.items.map((item) => item.target_id).sort()).toEqual([
      "chn_10000000000000000000000000000000",
      created.target_id,
      "chn_f0000000000000000000000000000000",
    ].sort());
    expect(new Set(allChannels.items.map((item) => item.target_id)).size).toBe(3);
    expect(allChannels).toMatchObject({
      item_count: 3,
      next_cursor: null,
      complete: true,
      truncated: false,
    });
    await pool.query("DELETE FROM channels WHERE id = ANY($1::text[])", [[
      "chn_10000000000000000000000000000000", "chn_f0000000000000000000000000000000",
    ]]);

    const firstMessagesResult = await runCli([
      "project-registration",
      "messages",
      created.target_id,
      "--project",
      PROJECT_ID,
      "--limit",
      "1",
      "--json",
    ]);
    expect(firstMessagesResult.exitCode, firstMessagesResult.stderr).toBe(0);
    const firstMessages = JSON.parse(firstMessagesResult.stdout) as {
      items: Array<{ target_id: string; reply_to_target_id: string | null }>;
      next_cursor: number;
      complete: boolean;
      truncated: boolean;
    };
    expect(firstMessages.items).toEqual([
      expect.objectContaining({
        target_id: parent.uuid,
        reply_to_target_id: null,
      }),
    ]);
    expect(firstMessages.next_cursor).toBe(parent.id);
    expect(firstMessages.complete).toBe(false);
    expect(firstMessages.truncated).toBe(true);

    const secondMessagesResult = await runCli([
      "project-registration",
      "messages",
      created.target_id,
      "--project",
      PROJECT_ID,
      "--cursor",
      String(firstMessages.next_cursor),
      "--limit",
      "1",
      "--json",
    ]);
    expect(secondMessagesResult.exitCode, secondMessagesResult.stderr).toBe(0);
    const secondMessages = JSON.parse(secondMessagesResult.stdout) as {
      items: Array<{ target_id: string; reply_to_target_id: string | null }>;
      complete: boolean;
      truncated: boolean;
    };
    expect(secondMessages.items).toEqual([
      expect.objectContaining({
        target_id: reply.uuid,
        reply_to_target_id: parent.uuid,
      }),
    ]);
    expect(secondMessages.complete).toBe(true);
    expect(secondMessages.truncated).toBe(false);

    const inverseTargetDesired = {
      channel: "cli-inverse-target",
      project_id: PROJECT_ID,
      project_slug: "cli-inverse-target",
      project_kind: "work",
    };
    writeFileSync(INVERSE_FORWARD_FILE, JSON.stringify({
      operation_intent: "create",
      operation_id: "cli-inverse-operation",
      step_id: "conversations-channel",
      resource_kind: "channel",
      direction: "forward",
      authority_route: capability.route,
      package_version: capability.package_version,
      authority_id: capability.authority_id,
      tenant_id: capability.tenant_id,
      corpus_id: capability.corpus_id,
      target_selector: "cli-inverse-target",
      idempotency_key: "cli-inverse-operation:conversations-channel:forward",
      request_digest: projectChannelRegistrationDigest(inverseTargetDesired),
      precondition_digest: projectChannelRegistrationDigest({
        target_selector: "cli-inverse-target",
        expected: "absent",
      }),
      project_id: PROJECT_ID,
      project_slug: "cli-inverse-target",
      project_name: "CLI Inverse Target",
      desired: inverseTargetDesired,
      target_digest: "cli-target-digest",
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    }));
    const inverseCreatedResult = await runCli([
      "project-registration",
      "create",
      "--request",
      INVERSE_FORWARD_FILE,
      "--json",
    ]);
    expect(inverseCreatedResult.exitCode, inverseCreatedResult.stderr).toBe(0);
    const inverseCreated = JSON.parse(inverseCreatedResult.stdout) as Record<string, any> & { target_id: string };
    const inverseDesired = {
      accepted_receipt_id: inverseCreated.receipt_id,
      target_id: inverseCreated.target_id,
    };
    writeFileSync(INVERSE_FILE, JSON.stringify({
      operation_intent: "create",
      operation_id: inverseCreated.operation_id,
      step_id: inverseCreated.step_id,
      resource_kind: "channel",
      direction: "inverse",
      authority_route: inverseCreated.route,
      package_version: inverseCreated.package_version,
      authority_id: inverseCreated.authority_id,
      tenant_id: inverseCreated.tenant_id,
      corpus_id: inverseCreated.corpus_id,
      target_selector: inverseCreated.target_id,
      idempotency_key: `${inverseCreated.operation_id}:${inverseCreated.step_id}:inverse`,
      request_digest: projectChannelRegistrationDigest(inverseDesired),
      precondition_digest: projectChannelRegistrationDigest({
        target_id: inverseCreated.target_id,
        expected_revision: inverseCreated.result_revision,
        expected_digest: inverseCreated.result_digest,
      }),
      project_id: PROJECT_ID,
      project_slug: "cli-inverse-target",
      project_name: "CLI Inverse Target",
      desired: inverseDesired,
      accepted_receipt: inverseCreated,
      target_digest: "cli-target-digest",
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    }));
    const compensatedResult = await runCli([
      "project-registration",
      "compensate",
      "--request",
      INVERSE_FILE,
      "--json",
    ]);
    expect(compensatedResult.exitCode, compensatedResult.stderr).toBe(0);
    const compensated = JSON.parse(compensatedResult.stdout) as Record<string, unknown>;
    expect(compensated).toMatchObject({
      direction: "inverse",
      outcome: "accepted",
      target_id: inverseCreated.target_id,
      accepted_receipt_id: inverseCreated.receipt_id,
    });

    const verifiedResult = await runCli([
      "project-registration",
      "verify-inverse",
      "--request",
      INVERSE_FILE,
      "--json",
    ]);
    expect(verifiedResult.exitCode, verifiedResult.stderr).toBe(0);
    expect(JSON.parse(verifiedResult.stdout)).toEqual({
      target_id: inverseCreated.target_id,
      accepted_receipt_id: inverseCreated.receipt_id,
      absent: true,
      digest: compensated.result_digest,
    });

    const existingResult = await runCli([
      "channel",
      "create",
      "cli-bind-existing",
      "--from",
      "human",
      "--json",
    ]);
    expect(existingResult.exitCode, existingResult.stderr).toBe(0);
    const existing = JSON.parse(existingResult.stdout) as { id: string; name: string };
    const existingMessageResult = await runCli([
      "channel",
      "send",
      existing.name,
      "legacy message ownership",
      "--from",
      "human",
      "--json",
    ]);
    expect(existingMessageResult.exitCode, existingMessageResult.stderr).toBe(0);
    const existingMessage = JSON.parse(existingMessageResult.stdout) as { uuid: string };
    const priorReadResult = await runCli([
      "project-registration",
      "read-channel",
      existing.id,
      "--channel",
      existing.name,
      "--target-digest",
      "cli-target-digest",
      "--json",
    ]);
    expect(priorReadResult.exitCode, priorReadResult.stderr).toBe(0);
    const priorRead = JSON.parse(priorReadResult.stdout) as {
      target_id: string;
      revision: string;
      digest: string;
    };
    const bindDesired = {
      channel: existing.name,
      project_id: PROJECT_ID,
      project_slug: existing.name,
      project_kind: "work",
      registration_mode: "bind_existing",
      target_id: existing.id,
      expected_project_id: null,
    };
    const bindRequest = {
      operation_intent: "bind_existing",
      operation_id: "cli-bind-existing-operation",
      step_id: "conversations-channel",
      resource_kind: "channel",
      direction: "forward",
      authority_route: capability.route,
      package_version: capability.package_version,
      authority_id: capability.authority_id,
      tenant_id: capability.tenant_id,
      corpus_id: capability.corpus_id,
      target_selector: existing.name,
      idempotency_key: "cli-bind-existing-operation:conversations-channel:forward",
      request_digest: projectChannelRegistrationDigest(bindDesired),
      precondition_digest: projectChannelRegistrationDigest({
        target_id: existing.id,
        target_selector: existing.name,
        expected_project_id: null,
        expected_revision: priorRead.revision,
        expected_digest: priorRead.digest,
        desired_project_id: PROJECT_ID,
      }),
      project_id: PROJECT_ID,
      project_slug: existing.name,
      project_name: "CLI Bind Existing",
      desired: bindDesired,
      bind_existing: {
        target_id: existing.id,
        expected_project_id: null,
        expected_revision: priorRead.revision,
        expected_digest: priorRead.digest,
      },
      target_digest: "cli-target-digest",
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    };
    writeFileSync(BIND_FILE, JSON.stringify(bindRequest));
    const { operation_intent: _operationIntent, ...bindWithoutIntent } = bindRequest;
    writeFileSync(BIND_NO_INTENT_FILE, JSON.stringify(bindWithoutIntent));
    const createWithBindShape = await runCli([
      "project-registration",
      "create",
      "--request",
      BIND_FILE,
      "--json",
    ]);
    expect(createWithBindShape.exitCode).toBe(1);
    expect(createWithBindShape.stderr).toContain(
      "create surface requires operation_intent=create",
    );
    const createWithBindShapeWithoutIntent = await runCli([
      "project-registration",
      "create",
      "--request",
      BIND_NO_INTENT_FILE,
      "--json",
    ]);
    expect(createWithBindShapeWithoutIntent.exitCode).toBe(1);
    expect(createWithBindShapeWithoutIntent.stderr).toContain(
      "create surface rejects bind-existing intent",
    );
    writeFileSync(ADOPT_NO_INTENT_FILE, JSON.stringify({
      ...bindWithoutIntent,
      desired: {
        ...bindDesired,
        registration_mode: "adopt_existing",
      },
      bind_existing: undefined,
      adopt_existing: {
        target_id: existing.id,
      },
    }));
    const createWithAdoptShapeWithoutIntent = await runCli([
      "project-registration",
      "create",
      "--request",
      ADOPT_NO_INTENT_FILE,
      "--json",
    ]);
    expect(createWithAdoptShapeWithoutIntent.exitCode).toBe(1);
    expect(createWithAdoptShapeWithoutIntent.stderr).toContain(
      "create surface rejects adopt-existing intent",
    );
    const bindWithoutIntentResult = await runCli([
      "project-registration",
      "bind-existing",
      "--request",
      BIND_NO_INTENT_FILE,
      "--json",
    ]);
    expect(bindWithoutIntentResult.exitCode).toBe(1);
    expect(bindWithoutIntentResult.stderr).toContain(
      "bind_existing surface requires operation_intent=bind_existing",
    );
    const boundResult = await runCli([
      "project-registration",
      "bind-existing",
      "--request",
      BIND_FILE,
      "--json",
    ]);
    expect(boundResult.exitCode, boundResult.stderr).toBe(0);
    const bound = JSON.parse(boundResult.stdout) as Record<string, any>;
    expect(bound).toMatchObject({
      outcome: "accepted",
      target_id: existing.id,
      created_by_operation: false,
      prior_state: {
        target_id: existing.id,
        project_id: null,
        bound_project_id: PROJECT_ID,
        revision: priorRead.revision,
        digest: priorRead.digest,
        message_transition: {
          source_project_id: null,
          target_project_id: PROJECT_ID,
          message_count: 1,
        },
      },
    });
    const boundMessagesResult = await runCli([
      "project-registration",
      "messages",
      existing.id,
      "--project",
      PROJECT_ID,
      "--json",
    ]);
    expect(boundMessagesResult.exitCode, boundMessagesResult.stderr).toBe(0);
    expect(JSON.parse(boundMessagesResult.stdout)).toMatchObject({
      item_count: 1,
      items: [{
        target_id: existingMessage.uuid,
        project_id: PROJECT_ID,
      }],
    });
    const boundMessage = (await pool.query(
      "SELECT project_id,content FROM messages WHERE uuid=$1", [existingMessage.uuid],
    )).rows[0];
    expect(boundMessage).toEqual({
      project_id: PROJECT_ID,
      content: "legacy message ownership",
    });

    const bindInverseDesired = {
      accepted_receipt_id: bound.receipt_id,
      target_id: bound.target_id,
    };
    writeFileSync(BIND_INVERSE_FILE, JSON.stringify({
      operation_intent: "bind_existing",
      operation_id: bound.operation_id,
      step_id: bound.step_id,
      resource_kind: "channel",
      direction: "inverse",
      authority_route: bound.route,
      package_version: bound.package_version,
      authority_id: bound.authority_id,
      tenant_id: bound.tenant_id,
      corpus_id: bound.corpus_id,
      target_selector: bound.target_id,
      idempotency_key: `${bound.operation_id}:${bound.step_id}:inverse`,
      request_digest: projectChannelRegistrationDigest(bindInverseDesired),
      precondition_digest: projectChannelRegistrationDigest({
        target_id: bound.target_id,
        expected_revision: bound.result_revision,
        expected_digest: bound.result_digest,
      }),
      project_id: PROJECT_ID,
      project_slug: existing.name,
      project_name: "CLI Bind Existing",
      desired: bindInverseDesired,
      accepted_receipt: bound,
      target_digest: "cli-target-digest",
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    }));
    const bindRestoredResult = await runCli([
      "project-registration",
      "compensate",
      "--request",
      BIND_INVERSE_FILE,
      "--json",
    ]);
    expect(bindRestoredResult.exitCode, bindRestoredResult.stderr).toBe(0);
    expect(JSON.parse(bindRestoredResult.stdout)).toMatchObject({
      outcome: "accepted",
      target_id: existing.id,
      created_by_operation: false,
      result_revision: priorRead.revision,
      result_digest: priorRead.digest,
    });
    const bindVerifiedResult = await runCli([
      "project-registration",
      "verify-inverse",
      "--request",
      BIND_INVERSE_FILE,
      "--json",
    ]);
    expect(bindVerifiedResult.exitCode, bindVerifiedResult.stderr).toBe(0);
    expect(JSON.parse(bindVerifiedResult.stdout)).toEqual({
      target_id: existing.id,
      accepted_receipt_id: bound.receipt_id,
      absent: false,
      restored: true,
      project_id: null,
      revision: priorRead.revision,
      digest: priorRead.digest,
    });
    const restoredMessage = (await pool.query(
      "SELECT project_id,content FROM messages WHERE uuid=$1", [existingMessage.uuid],
    )).rows[0];
    expect(restoredMessage).toEqual({
      project_id: null,
      content: "legacy message ownership",
    });

    const channelsAfterInverse = await runCli([
      "project-registration",
      "channels",
      "--project",
      PROJECT_ID,
      "--json",
    ]);
    expect(channelsAfterInverse.exitCode, channelsAfterInverse.stderr).toBe(0);
    expect(JSON.parse(channelsAfterInverse.stdout).items).toEqual([
      expect.objectContaining({ target_id: created.target_id, channel: "cli-project-feed" }),
    ]);
  }, 60_000);
});
