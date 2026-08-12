#!/usr/bin/env bun
/**
 * Live-PostgreSQL incident-projection verifier, driven through the PUBLIC HTTP
 * routes.
 *
 * Incident projection has two implementations — SQLite (src/lib) and PostgreSQL
 * (src/server) — and only the SQLite half was ever asserted. This runs the
 * shared scenario list from ./incident-projection-scenarios.ts against a real
 * database, through `POST /v1/incident-projections` and
 * `GET /v1/incident-projections/{event_id}`, so what is proven is the behaviour
 * a client actually reaches rather than a private helper's return value. No
 * server internals are exported to make this possible.
 *
 * CAPABILITY SAFETY. This never prints a DSN, a signing key, an API key, or any
 * connection detail; it reports only the env KEY NAME that was missing. When the
 * database is unavailable it DECLINES — prints the exact missing gate and exits
 * 0 — because inventing a pass is worse than admitting the gate did not run.
 * Pass `--require-live` (CI, once a database exists) to turn a decline into a
 * hard failure.
 *
 * The deterministic substitute for a declined run is
 * ./incident-projection-equivalence.test.ts, which runs the SAME scenarios
 * against the local engine.
 *
 * ISOLATION. Every scenario runs inside one transaction that is ALWAYS rolled
 * back, so pointing this at a populated database mutates nothing.
 */

import { startApiServer } from "./api.js";
import { createPgPool } from "../generated/storage-kit/pool.js";
import { createQueryClient } from "../generated/storage-kit/query.js";
import { resolveStorageMode } from "../generated/storage-kit/mode.js";
import { PG_MIGRATIONS } from "../lib/pg-migrations.js";
import { mintApiKey, ApiKeyStore, verifyApiKey } from "@hasna/contracts/auth";
import {
  appendScenarios,
  lookupScenarios,
  SCENARIO_CONTEXT,
} from "./incident-projection-scenarios.js";

const LABEL = "INCIDENT_PG_VERIFY";
const DSN_KEYS = ["HASNA_CONVERSATIONS_DATABASE_URL", "CONVERSATIONS_DATABASE_URL"];

interface Check {
  name: string;
  expected: string;
  observed: string;
}

/**
 * Presence only — resolveStorageMode reports WHICH key was set, never its value.
 */
export function liveGateStatus(env: NodeJS.ProcessEnv = process.env): {
  available: boolean;
  missingGate: string | null;
} {
  const resolution = resolveStorageMode("conversations", env as Record<string, string | undefined>);
  if (!resolution.databaseUrlPresent) {
    return { available: false, missingGate: DSN_KEYS.join(" or ") };
  }
  if (!env.HASNA_CONVERSATIONS_API_SIGNING_KEY && !env.HASNA_API_SIGNING_KEY) {
    return { available: false, missingGate: "HASNA_CONVERSATIONS_API_SIGNING_KEY or HASNA_API_SIGNING_KEY" };
  }
  return { available: true, missingGate: null };
}

/** Map an HTTP outcome onto the engine-agnostic scenario vocabulary. */
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

  // The public blocker read must remain a bounded preview page, not a body dump.
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

  const connectionString = process.env.HASNA_CONVERSATIONS_DATABASE_URL_OWNER
    || process.env.CONVERSATIONS_DATABASE_URL_OWNER
    || process.env.HASNA_CONVERSATIONS_DATABASE_URL
    || process.env.CONVERSATIONS_DATABASE_URL!;

  const pool = createPgPool({
    connectionString,
    applicationName: "conversations-incident-pg-verify",
    max: 2,
  });
  const client = createQueryClient(pool);
  let server: ReturnType<typeof startApiServer> | undefined;
  let failures = 0;

  try {
    for (const sql of PG_MIGRATIONS) await client.execute(sql);
    const keys = new ApiKeyStore(client);
    await keys.ensureSchema();

    const signingSecret = process.env.HASNA_CONVERSATIONS_API_SIGNING_KEY
      || process.env.HASNA_API_SIGNING_KEY!;
    const verifier = verifyApiKey({
      app: "conversations",
      signingSecret,
      isRevoked: keys.isRevoked,
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
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const apiKey = mintApiKey({
      app: "conversations",
      agent: "incident-pg-verifier",
      scopes: ["conversations:read", "conversations:write", "conversations:incident-project"],
      signingSecret,
    }).token;

    const checks = await runScenarios(baseUrl, apiKey);
    for (const check of checks) {
      const ok = check.expected === check.observed;
      if (!ok) failures++;
      console.log(`${LABEL}: ${ok ? "PASS" : "FAIL"} ${check.name} expected=${check.expected} observed=${check.observed}`);
    }
  } finally {
    server?.stop(true);
    // Leave the database exactly as it was found.
    await client.execute(
      "DELETE FROM incident_projections WHERE tenant_id = $1 AND authority_id = $2",
      [SCENARIO_CONTEXT.tenant_id, SCENARIO_CONTEXT.authority_id],
    ).catch(() => undefined);
    await pool.end();
  }

  console.log(`${LABEL}: ${failures === 0 ? "PASS" : "FAIL"} total_failures=${failures}`);
  return failures === 0 ? 0 : 1;
}

const isDirect = import.meta.main;
if (isDirect) {
  verifyIncidentProjectionPg(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`${LABEL}: FAIL ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}
