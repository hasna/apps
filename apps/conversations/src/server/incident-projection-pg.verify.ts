#!/usr/bin/env bun
/**
 * Live-PostgreSQL incident-projection verifier, driven through the public HTTP
 * routes.
 *
 * Incident projection has two implementations - SQLite (src/lib) and
 * PostgreSQL (src/server) - and only the SQLite half was ever asserted. This
 * runs the shared scenario list from ./incident-projection-scenarios.ts against
 * a real database, through `POST /v1/incident-projections` and
 * `GET /v1/incident-projections/{event_id}`, so what is proven is the behavior
 * a client actually reaches rather than a private helper's return value.
 *
 * Capability safety: this never prints a DSN, a signing key, an API key, or
 * any connection detail; it reports only the env key name that was missing.
 * When the isolated database is unavailable it declines - prints the exact
 * missing gate and exits 0. Pass `--require-live` to turn a decline into a hard
 * failure.
 *
 * The deterministic substitute for a declined run is
 * ./incident-projection-equivalence.test.ts, which runs the same scenarios
 * against the local engine.
 *
 * Isolation: the verifier provisions a disposable schema under the owner DSN,
 * runs migrations plus the public HTTP scenarios inside that schema, then drops
 * the schema. A failed drop fails the verifier.
 */

import { randomUUID } from "crypto";
import { mintApiKey, ApiKeyStore, verifyApiKey } from "@hasna/contracts/auth";
import { createPgPool } from "../generated/storage-kit/pool.js";
import { createQueryClient } from "../generated/storage-kit/query.js";
import { PG_MIGRATIONS } from "../lib/pg-migrations.js";
import { startApiServer } from "./api.js";
import {
  appendScenarios,
  lookupScenarios,
  SCENARIO_CONTEXT,
} from "./incident-projection-scenarios.js";

const LABEL = "INCIDENT_PG_VERIFY";
const OWNER_DSN_KEYS = ["HASNA_CONVERSATIONS_DATABASE_URL_OWNER", "CONVERSATIONS_DATABASE_URL_OWNER"];

interface Check {
  name: string;
  expected: string;
  observed: string;
}

export function liveGateStatus(env: NodeJS.ProcessEnv = process.env): {
  available: boolean;
  missingGate: string | null;
} {
  const ownerDsn = env.HASNA_CONVERSATIONS_DATABASE_URL_OWNER || env.CONVERSATIONS_DATABASE_URL_OWNER;
  if (!ownerDsn) {
    return { available: false, missingGate: OWNER_DSN_KEYS.join(" or ") };
  }
  if (!env.HASNA_CONVERSATIONS_API_SIGNING_KEY && !env.HASNA_API_SIGNING_KEY) {
    return { available: false, missingGate: "HASNA_CONVERSATIONS_API_SIGNING_KEY or HASNA_API_SIGNING_KEY" };
  }
  return { available: true, missingGate: null };
}

function appendSearchPath(connectionString: string, schema: string): string {
  const url = new URL(connectionString);
  const existing = url.searchParams.get("options");
  const searchPath = `-csearch_path=${schema}`;
  url.searchParams.set("options", existing ? `${existing} ${searchPath}` : searchPath);
  return url.toString();
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

function outcomeOf(status: number, body: { projection?: { replayed?: boolean } }): string {
  if (status === 409) return "conflict";
  if (status === 400) return "conflict";
  if (status === 200 || status === 201) return body.projection?.replayed ? "replayed" : "created";
  return `http_${status}`;
}

async function runScenarios(baseUrl: string, apiKey: string): Promise<Check[]> {
  const checks: Check[] = [];

  for (const scenario of appendScenarios()) {
    const res = await fetch(`${baseUrl}/v1/incident-projections`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify(scenario.request),
    });
    const body = await res.json().catch(() => ({})) as { projection?: { replayed?: boolean } };
    checks.push({
      name: `append/${scenario.name}`,
      expected: scenario.expect.kind,
      observed: outcomeOf(res.status, body),
    });
  }

  for (const lookup of lookupScenarios()) {
    const res = await fetch(`${baseUrl}/v1/incident-projections/${lookup.event_id}`, {
      headers: { "x-api-key": apiKey },
    });
    checks.push({
      name: `lookup/${lookup.name}`,
      expected: lookup.found ? "found" : "absent",
      observed: res.status === 200 ? "found" : res.status === 404 ? "absent" : `http_${res.status}`,
    });
  }

  const blockers = await fetch(`${baseUrl}/v1/messages/blockers?limit=5`, {
    headers: { "x-api-key": apiKey },
  });
  const blockerBody = await blockers.json().catch(() => ({})) as Record<string, unknown>;
  const envelopeComplete = ["has_more", "next_cursor", "skipped_count", "max_bytes", "timeout_ms"]
    .every((field) => field in blockerBody);
  checks.push({
    name: "blockers/bounded-envelope",
    expected: "complete",
    observed: blockers.status === 200 && envelopeComplete ? "complete" : `status=${blockers.status} envelope=${envelopeComplete}`,
  });

  return checks;
}

/**
 * Hosted-PG regression for task 041b4e3a (incident 731890): the message-create
 * path binds the outbox envelope `time` into conversations_event_outbox
 * created_at (TIMESTAMPTZ NOT NULL) inside the SAME PG transaction as the
 * message insert. `pg` returns a real Date for TIMESTAMPTZ; `String(date)`
 * yields "Mon Aug 24 2026 ... GMT+0000 (Coordinated Universal Time)", which
 * Postgres rejects — every POST /v1/messages 400'd on the hosted env. With the
 * bug present the POST fails and the transaction rolls back; with the fix the
 * POST succeeds and the outbox row carries an ISO-8601 created_at.
 */
async function runOutboxMessageCreateCheck(
  baseUrl: string,
  apiKey: string,
  client: ReturnType<typeof createQueryClient>,
): Promise<Check[]> {
  const checks: Check[] = [];
  const channelName = `outbox-iso-${Date.now()}`;

  const channel = await fetch(`${baseUrl}/v1/channels`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({ name: channelName, created_by: "incident-pg-verifier" }),
  });
  checks.push({
    name: "outbox/channel-seed",
    expected: "201",
    observed: String(channel.status),
  });
  if (channel.status !== 201) return checks;

  const sent = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      from: "incident-pg-verifier",
      to: channelName,
      channel: channelName,
      content: "outbox-iso regression",
    }),
  });
  checks.push({
    name: "outbox/message-create",
    expected: "201",
    observed: String(sent.status),
  });

  const row = await client.get<{ created_at: unknown; envelope_json: string }>(
    `SELECT created_at, envelope_json FROM conversations_event_outbox
     WHERE type = 'conversations.message.created' AND source = 'conversations'
     ORDER BY created_at DESC LIMIT 1`,
  );
  if (!row) {
    checks.push({ name: "outbox/row-present", expected: "row", observed: "absent" });
    return checks;
  }
  checks.push({ name: "outbox/row-present", expected: "row", observed: "row" });

  let envelope: { time?: unknown } | null = null;
  try {
    envelope = JSON.parse(row.envelope_json) as { time?: unknown };
  } catch {
    envelope = null;
  }
  const time = envelope === null ? "unparseable" : String(envelope.time ?? "");
  checks.push({
    name: "outbox/envelope-time-iso",
    expected: "iso8601",
    observed: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(time) ? "iso8601" : time,
  });

  const created = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
  checks.push({
    name: "outbox/column-created-at-iso",
    expected: "iso8601",
    observed: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(created) ? "iso8601" : created,
  });

  return checks;
}

export async function verifyIncidentProjectionPg(argv: string[] = []): Promise<number> {
  const requireLive = argv.includes("--require-live");
  const gate = liveGateStatus();

  if (!gate.available) {
    console.log(`${LABEL}: DECLINED missing_gate=${gate.missingGate}`);
    console.log(
      `${LABEL}: substitute=src/server/incident-projection-equivalence.test.ts `
      + "(same scenarios, local engine)",
    );
    return requireLive ? 1 : 0;
  }

  const ownerConnectionString = process.env.HASNA_CONVERSATIONS_DATABASE_URL_OWNER
    || process.env.CONVERSATIONS_DATABASE_URL_OWNER!;
  const signingSecret = process.env.HASNA_CONVERSATIONS_API_SIGNING_KEY?.trim()
    || process.env.HASNA_API_SIGNING_KEY!.trim();
  const schemaName = `incident_pg_verify_${randomUUID().replace(/-/g, "")}`;
  const schemaConnectionString = appendSearchPath(ownerConnectionString, schemaName);

  const adminPool = createPgPool({
    connectionString: ownerConnectionString,
    applicationName: "conversations-incident-pg-verify-admin",
    max: 1,
  });
  const adminClient = createQueryClient(adminPool);
  const pool = createPgPool({
    connectionString: schemaConnectionString,
    applicationName: "conversations-incident-pg-verify",
    max: 2,
  });
  const client = createQueryClient(pool);

  let server: ReturnType<typeof startApiServer> | undefined;
  let failures = 0;

  try {
    await adminClient.execute(`CREATE SCHEMA ${quoteIdent(schemaName)}`);
    for (const sql of PG_MIGRATIONS) await client.execute(sql);

    const keys = new ApiKeyStore(client);
    await keys.ensureSchema();

    const verifier = verifyApiKey({
      app: "conversations",
      signingSecret,
      keyStatus: keys.keyStatus,
    });

    server = startApiServer({
      port: 0,
      host: "127.0.0.1",
      deps: {
        client: client as never,
        keys,
        verifier,
        incidentProjector: SCENARIO_CONTEXT,
      },
    });

    const apiKey = mintApiKey({
      app: "conversations",
      agent: "incident-pg-verifier",
      scopes: ["conversations:read", "conversations:write", "conversations:incident-project"],
      signingSecret,
    }).token;

    const baseUrl = `http://127.0.0.1:${server.port}`;
    const checks = await runScenarios(baseUrl, apiKey);
    checks.push(...await runOutboxMessageCreateCheck(baseUrl, apiKey, client));
    for (const check of checks) {
      const ok = check.expected === check.observed;
      if (!ok) failures++;
      console.log(`${LABEL}: ${ok ? "PASS" : "FAIL"} ${check.name} expected=${check.expected} observed=${check.observed}`);
    }
  } finally {
    server?.stop(true);
    await pool.end();
    try {
      await adminClient.execute(`DROP SCHEMA ${quoteIdent(schemaName)} CASCADE`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures++;
      console.log(`${LABEL}: FAIL cleanup expected=dropped_schema observed=${message}`);
    } finally {
      await adminPool.end();
    }
  }

  console.log(`${LABEL}: ${failures === 0 ? "PASS" : "FAIL"} total_failures=${failures}`);
  return failures === 0 ? 0 : 1;
}

if (import.meta.main) {
  verifyIncidentProjectionPg(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`${LABEL}: FAIL ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}
