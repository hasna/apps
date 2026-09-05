#!/usr/bin/env bun
/**
 * Live-PostgreSQL outbox-timestamp verifier, driven through the public HTTP
 * routes.
 *
 * BUG 041b4e3a / incident 731890: `POST /v1/messages` (and `POST /v1/tasks`)
 * returned 400 against the hosted server with
 *   error=invalid input syntax for type timestamp with time zone:
 *   "Mon Aug 24 2026 17:34:34 GMT+0000 (Coordinated Universal Time)"
 *
 * The server create path built the outbox event with
 * `time: String(inserted.created_at)` (api.ts message-create emit, and the
 * same shape on the task-create emit). Postgres returns `timestamptz` columns
 * as a JS Date, and `String(date)` produces the JS toString format, which the
 * `INSERT INTO conversations_event_outbox (... created_at ...)` into a
 * TIMESTAMPTZ column refuses to parse — so the enclosing transaction rolled
 * back and every send/reply 400'd.
 *
 * This verifier exercises the REAL server create path against a real Postgres
 * through the public HTTP routes, then reads the outbox row back and asserts
 * the timestamps round-trip as ISO8601 (never the JS toString format). It
 * fails on the pre-fix `String()` serialization and passes after.
 *
 * Capability safety: never prints a DSN, a signing key, an API key, or any
 * connection detail; reports only the env key name that was missing. When the
 * isolated database is unavailable it declines - prints the exact missing gate
 * and exits 0. Pass `--require-live` to turn a decline into a hard failure.
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

const LABEL = "OUTBOX_TIMESTAMP_PG_VERIFY";
const OWNER_DSN_KEYS = ["HASNA_CONVERSATIONS_DATABASE_URL_OWNER", "CONVERSATIONS_DATABASE_URL_OWNER"];

/** ISO8601 UTC with milliseconds, as `new Date().toISOString()` produces. */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** The JS `Date.prototype.toString()` shape Postgres timestamptz maps to. */
const JS_TO_STRING = /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d{4} \d{2}:\d{2}:\d{2} GMT/;

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

interface OutboxRow {
  created_at: Date | string;
  envelope_json: string;
}

function isIso(value: string): boolean {
  return ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}

function describeTimestamp(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) return "null";
  const iso = new Date(value).toISOString();
  return isIso(iso) ? iso : String(value);
}

async function runOutboxTimestampScenarios(
  baseUrl: string,
  apiKey: string,
  client: ReturnType<typeof createQueryClient>,
): Promise<Check[]> {
  const checks: Check[] = [];

  // ---- message create: exercises api.ts message-create outbox emit ----
  const messageUuid = randomUUID();
  const channelName = `outbox-ts-${randomUUID().slice(0, 8)}`;
  const channelRes = await fetch(`${baseUrl}/v1/channels`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({ name: channelName, created_by: "outbox-verifier" }),
  });
  checks.push({
    name: "channels/create-http",
    expected: "201",
    observed: String(channelRes.status),
  });

  const messageRes = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      from: "outbox-verifier",
      to: channelName,
      channel: channelName,
      content: "outbox timestamp regression",
      uuid: messageUuid,
    }),
  });
  const messageBody = await messageRes.json().catch(() => ({})) as { error?: string };
  checks.push({
    name: "messages/create-http",
    expected: "201",
    observed: String(messageRes.status) + (messageBody.error ? ` error=${messageBody.error}` : ""),
  });

  const messageOutboxId = `conversations:message:${messageUuid}:created`;
  if (messageRes.status === 201) {
    const row = await client.get<OutboxRow>(
      "SELECT created_at, envelope_json FROM conversations_event_outbox WHERE id = $1",
      [messageOutboxId],
    );
    checks.push({
      name: "messages/outbox-row-present",
      expected: "present",
      observed: row ? "present" : "absent",
    });
    if (row) {
      const envelope = JSON.parse(row.envelope_json) as { time?: string };
      const envelopeTime = typeof envelope.time === "string" ? envelope.time : String(envelope.time ?? "");
      checks.push({
        name: "messages/outbox-created-at-iso",
        expected: "iso",
        observed: isIso(describeTimestamp(row.created_at))
          ? "iso"
          : describeTimestamp(row.created_at),
      });
      checks.push({
        name: "messages/outbox-envelope-time-iso",
        expected: "iso",
        observed: isIso(envelopeTime) ? "iso" : JS_TO_STRING.test(envelopeTime)
          ? `js-toString(${envelopeTime})`
          : envelopeTime,
      });
    }
  } else {
    checks.push({ name: "messages/outbox-row-present", expected: "present", observed: "skipped" });
    checks.push({ name: "messages/outbox-created-at-iso", expected: "iso", observed: "skipped" });
    checks.push({ name: "messages/outbox-envelope-time-iso", expected: "iso", observed: "skipped" });
  }

  // ---- task create: exercises api.ts task-create outbox emit ----
  const taskSubject = `outbox-ts-task-${randomUUID().slice(0, 8)}`;
  const taskRes = await fetch(`${baseUrl}/v1/tasks`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({ subject: taskSubject, reporter: "outbox-verifier" }),
  });
  const taskBody = await taskRes.json().catch(() => ({})) as { error?: string };
  checks.push({
    name: "tasks/create-http",
    expected: "201",
    observed: String(taskRes.status) + (taskBody.error ? ` error=${taskBody.error}` : ""),
  });

  if (taskRes.status === 201) {
    const row = await client.get<OutboxRow>(
      "SELECT created_at, envelope_json FROM conversations_event_outbox"
      + " WHERE type = 'conversations.task.created'"
      + " ORDER BY created_at DESC LIMIT 1",
    );
    checks.push({
      name: "tasks/outbox-row-present",
      expected: "present",
      observed: row ? "present" : "absent",
    });
    if (row) {
      const envelope = JSON.parse(row.envelope_json) as { time?: string };
      const envelopeTime = typeof envelope.time === "string" ? envelope.time : String(envelope.time ?? "");
      checks.push({
        name: "tasks/outbox-created-at-iso",
        expected: "iso",
        observed: isIso(describeTimestamp(row.created_at))
          ? "iso"
          : describeTimestamp(row.created_at),
      });
      checks.push({
        name: "tasks/outbox-envelope-time-iso",
        expected: "iso",
        observed: isIso(envelopeTime) ? "iso" : JS_TO_STRING.test(envelopeTime)
          ? `js-toString(${envelopeTime})`
          : envelopeTime,
      });
    }
  } else {
    checks.push({ name: "tasks/outbox-row-present", expected: "present", observed: "skipped" });
    checks.push({ name: "tasks/outbox-created-at-iso", expected: "iso", observed: "skipped" });
    checks.push({ name: "tasks/outbox-envelope-time-iso", expected: "iso", observed: "skipped" });
  }

  return checks;
}

export async function verifyOutboxTimestampPg(argv: string[] = []): Promise<number> {
  const requireLive = argv.includes("--require-live");
  const gate = liveGateStatus();

  if (!gate.available) {
    console.log(`${LABEL}: DECLINED missing_gate=${gate.missingGate}`);
    console.log(
      `${LABEL}: no_local_substitute=true ` +
      "(the defect only manifests against a real Postgres, which returns " +
      "timestamptz as a JS Date; SQLite returns ISO text, so a local engine " +
      "cannot reproduce the serialization failure)",
    );
    return requireLive ? 1 : 0;
  }

  const ownerConnectionString = process.env.HASNA_CONVERSATIONS_DATABASE_URL_OWNER
    || process.env.CONVERSATIONS_DATABASE_URL_OWNER!;
  const signingSecret = process.env.HASNA_CONVERSATIONS_API_SIGNING_KEY?.trim()
    || process.env.HASNA_API_SIGNING_KEY!.trim();
  const schemaName = `outbox_timestamp_verify_${randomUUID().replace(/-/g, "")}`;
  const schemaConnectionString = appendSearchPath(ownerConnectionString, schemaName);

  const adminPool = createPgPool({
    connectionString: ownerConnectionString,
    applicationName: "conversations-outbox-timestamp-pg-verify-admin",
    max: 1,
  });
  const adminClient = createQueryClient(adminPool);
  const pool = createPgPool({
    connectionString: schemaConnectionString,
    applicationName: "conversations-outbox-timestamp-pg-verify",
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
      },
    });

    const minted = mintApiKey({
      app: "conversations",
      agent: "outbox-timestamp-pg-verifier",
      scopes: ["conversations:read", "conversations:write"],
      signingSecret,
    });
    // The key-status hook refuses unregistered keys ("API key is not registered
    // with this service"), so the minted key must be persisted in the store
    // before any request can authenticate.
    await keys.insertMinted(minted, "outbox-timestamp-pg-verify");

    const baseUrl = `http://127.0.0.1:${server.port}`;
    const checks = await runOutboxTimestampScenarios(baseUrl, minted.token, client);
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
  verifyOutboxTimestampPg(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`${LABEL}: FAIL ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}
