#!/usr/bin/env bun
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getPackageVersion } from "../lib/package-version.js";
import { handleV1Request } from "./v1.js";
import {
  getHonoAuthMiddleware,
  isPostgresBackendEnabled,
  pingCloud,
  resolveCloudDatabaseUrl,
  ensureCloudSchema,
  closeCloud,
} from "./cloud.js";
import { buildV1OpenApiDocument } from "./openapi.js";

// ── One-shot schema migration (used by the ECS migration task) ───────────────
//   instructions-serve migrate   |   instructions db migrate
if (process.argv.includes("migrate")) {
  if (!resolveCloudDatabaseUrl()) {
    console.error("migrate: no database URL (HASNA_INSTRUCTIONS_DATABASE_URL / INSTRUCTIONS_DATABASE_URL / DATABASE_URL)");
    process.exit(2);
  }
  console.log("migrate: connecting…");
  await pingCloud();
  console.log("migrate: applying schema (instructions tables + api_keys)…");
  await ensureCloudSchema();
  console.log("migrate: done");
  await closeCloud();
  process.exit(0);
}

if (process.argv.includes("--version") || process.argv.includes("-V")) {
  console.log(getPackageVersion());
  process.exit(0);
}

// Binds-before-help class (todos row c8067fdd, O15-00628): --help/-h must
// answer BEFORE any bind. They previously fell through to the Hono app export
// and bound :3457, serving forever with no help output.
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage: instructions-serve [options]

HTTP API server for @hasna/instructions (backend: sqlite or postgresql).

Options:
  -V, --version  output the version number
  -h, --help     display help for command
  migrate        apply the schema migration to the configured database and exit

Environment:
  PORT / INSTRUCTIONS_PORT        HTTP port (default: 3457)
  HOST / INSTRUCTIONS_HOST        bind host (default: localhost)
  HASNA_INSTRUCTIONS_DATABASE_URL / INSTRUCTIONS_DATABASE_URL / DATABASE_URL
                                  postgresql backend URL (enables the cloud backend)`);
  process.exit(0);
}

const PORT = Number(
  process.env["PORT"] ?? process.env["INSTRUCTIONS_PORT"] ?? 3457,
);

const app = new Hono();
app.use("*", cors());

// ── Service surface probes (unauthenticated): /health /ready /version ─────────
function serviceBackend(): "postgresql" | "sqlite" {
  return isPostgresBackendEnabled() ? "postgresql" : "sqlite";
}

app.get("/health", (c) => c.json({ status: "ok", version: getPackageVersion(), backend: serviceBackend(), name: "instructions" }));

app.get("/version", (c) => c.json({ status: "ok", version: getPackageVersion(), backend: serviceBackend(), name: "instructions" }));

app.get("/ready", async (c) => {
  const version = getPackageVersion();
  const backend = serviceBackend();
  if (backend === "postgresql") {
    try {
      await pingCloud();
    } catch (e) {
      return c.json({ status: "unavailable", version, backend, error: (e as Error).message }, 503);
    }
  }
  return c.json({ status: "ready", version, backend });
});

// ── OpenAPI document (unauthenticated; the SDK's source of truth) ─────────────
app.get("/openapi.json", (c) => c.json(buildV1OpenApiDocument()));
app.get("/v1/openapi.json", (c) => c.json(buildV1OpenApiDocument()));

// ── Versioned cloud API (/v1/*): A1 pure-remote, contracts API-key auth ───────
// Auth is the contracts `honoApiKey` middleware; reads need `instructions:read`,
// writes need `instructions:write` (an `instructions:*` key satisfies both).
app.use("/v1/*", async (c, next) => {
  const isWrite = c.req.method !== "GET" && c.req.method !== "HEAD";
  let mw;
  try {
    mw = getHonoAuthMiddleware([isWrite ? "instructions:write" : "instructions:read"]);
  } catch (e) {
    // Fail closed: /v1 is never an unauthenticated backdoor.
    return c.json({ error: (e as Error).message }, 503);
  }
  return mw(c, next);
});

app.all("/v1/*", async (c) => {
  const res = await handleV1Request(c.req.raw, new URL(c.req.url));
  return res ?? c.json({ error: "Not found" }, 404);
});

// ── MCP is a CLIENT transport, never mounted on the cloud server ─────────────
// The MCP server (src/mcp) runs on the operator's machine (stdio or the local
// `instructions mcp --http` process on 127.0.0.1). Its tools resolve the Store
// from the client env through the shared @hasna/contracts resolver, so a hosted
// credential (Keychain / credentials file / HASNA_INSTRUCTIONS_API_KEY) routes
// them to this server's authenticated /v1 API — the same path the CLI/SDK use.
//
// It is deliberately NOT mounted here: on ECS the container holds a DATABASE_URL
// (not the client API env), so a server-mounted /mcp would resolve to an
// ephemeral on-container SQLite store instead of RDS (split-brain), and being
// outside the /v1/* auth middleware it would be unauthenticated. Only /v1/* (and
// the unauthenticated health/version probes above) are exposed by the server.

const HOST = process.env["HOST"] ?? process.env["INSTRUCTIONS_HOST"] ?? "localhost";
console.log(`instructions-serve listening on http://${HOST}:${PORT} (backend: ${serviceBackend()})`);
export default { port: PORT, hostname: HOST, fetch: app.fetch };
