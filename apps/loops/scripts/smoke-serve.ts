#!/usr/bin/env bun
// LOCAL smoke test: assemble the real loops-serve server (createLoopsApiServer +
// PostgresLoopStorage + contracts verifyApiKey) against the tunnelled RDS, mint
// a real API key into the api_keys table, then drive an authenticated CRUD
// roundtrip through the generated LoopsClient. Tunnel-only relaxed TLS.
import { Pool } from "pg";
import { ApiKeyStore, mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import { createLoopsApiServer, type ApiAuthenticator } from "../src/api/index.js";
import { createQueryClient } from "../src/generated/storage-kit/query.js";
import { createPostgresLoopStorage } from "../src/lib/storage/postgres-loop-storage.js";
import { LoopsClient } from "../src/sdk/http.js";

const dsn = process.env.TUNNEL_DATABASE_URL?.trim();
if (!dsn) throw new Error("set TUNNEL_DATABASE_URL");
const signingSecret = process.env.SMOKE_SIGNING_SECRET?.trim();
if (!signingSecret) throw new Error("set SMOKE_SIGNING_SECRET");

const pool = new Pool({ connectionString: dsn.split("?")[0], ssl: { rejectUnauthorized: false }, max: 3 });
const client = createQueryClient(pool);
const storage = createPostgresLoopStorage(client);
const keys = new ApiKeyStore(client);
await keys.ensureSchema();

const authenticator = verifyApiKey({
  app: "loops",
  signingSecret,
  isRevoked: keys.statusChecker(),
}) as unknown as ApiAuthenticator;

const server = createLoopsApiServer({ host: "127.0.0.1", port: 18795, storage, authenticator });
const base = `http://127.0.0.1:${server.port}`;

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`SMOKE FAIL: ${msg}`);
}

// Foundation probes (open)
const health = await (await fetch(`${base}/health`)).json();
assert(health.status === "ok" && health.version && health.mode, "health {status,version,mode}");
const ready = await fetch(`${base}/ready`);
const readyBody = await ready.json();
assert(ready.status === 200 && readyBody.status === "ready", `ready -> ${ready.status} ${JSON.stringify(readyBody)}`);
const version = await (await fetch(`${base}/version`)).json();
assert(version.version && version.mode, "version {version,mode}");

// Unauthenticated /v1 must be rejected
const noauth = await fetch(`${base}/v1/loops`);
assert(noauth.status === 401, `unauth /v1 -> ${noauth.status} (expected 401)`);

// Mint + persist a real API key
const minted = await mintApiKey({ app: "loops", agent: "smoke", scopes: ["loops:*"], signingSecret });
await keys.insertMinted(minted, "smoke");

// Drive CRUD through the generated client
const api = new LoopsClient({ baseUrl: base, apiKey: minted.token });
const created = await api.createLoop({
  name: `smoke-${Date.now()}`,
  schedule: { kind: "interval", everyMs: 3_600_000 },
  target: { type: "command", command: "date" },
});
assert(created.ok && created.loop?.id, "createLoop");
const id = created.loop.id;
const got = await api.getLoop(id);
assert(got.loop.id === id, "getLoop");
const listed = await api.listLoops({});
assert(Array.isArray(listed.loops) && listed.loops.some((l) => l.id === id), "listLoops");
const patched = await api.updateLoop(id, { status: "paused" });
assert(patched.loop.status === "paused", `updateLoop -> ${patched.loop.status}`);
const deleted = await api.deleteLoop(id);
assert(deleted.deleted === true, "deleteLoop");

// Revocation takes effect
await keys.revoke(minted.kid, "smoke-cleanup");
const afterRevoke = await fetch(`${base}/v1/loops`, { headers: { "x-api-key": minted.token } });
assert(afterRevoke.status === 403 || afterRevoke.status === 401, `revoked key -> ${afterRevoke.status}`);

console.log(JSON.stringify({ evt: "smoke_ok", loopId: id, kid: minted.kid }));
server.stop();
await pool.end();
process.exit(0);
