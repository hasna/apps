import { afterEach, beforeEach, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCoreApp } from "../src/server/core-app.js";
import { migrateCoreSchema } from "../src/server/core-schema.js";
import { assertTokenSigningPosture } from "../src/server/core-domain/tokens.js";
import type { CorePool } from "../src/server/core-store.js";
import { createTokenSigner, currentTokenSigner, withTokenSigner } from "../src/server/core-signing.js";

const KEY = "isolated-review-signing-material-alpha";
const OTHER = "isolated-review-signing-material-bravo";
const names = ["HASNA_ACCESS_TOKEN_SIGNING_KEY", "ACCESS_TOKEN_SIGNING_KEY", "HASNA_ACCESS_TOKEN_SIGNING_KEY_FILE", "ACCESS_TOKEN_SIGNING_KEY_FILE"];
let previous: Record<string, string | undefined>;
let temporary: string;
beforeEach(() => {
  previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  process.env.HASNA_ACCESS_TOKEN_SIGNING_KEY = KEY;
  temporary = mkdtempSync(join(tmpdir(), "access-review-signing-"));
});
afterEach(() => {
  for (const name of names) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
  rmSync(temporary, { recursive: true, force: true });
});

async function fixture() {
  const pg = new PGlite();
  const pool: CorePool = { async connect() { return { async query(sql, params) { return pg.query(sql, params); }, release() {} }; }, async end() { await pg.close(); } };
  await migrateCoreSchema(pool);
  const entityA = crypto.randomUUID(), entityB = crypto.randomUUID();
  const credentials = JSON.stringify([
    { id: "owner", token: "test-owner", roles: ["owner"], entity_ids: [entityA, entityB] },
    { id: "writer", token: "test-writer", roles: [], scopes: ["access:write"], entity_ids: [entityA] },
    { id: "unscoped", token: "test-unscoped", roles: [], scopes: ["access:write"] },
  ]);
  const env = { HASNA_ACCESS_API_CREDENTIALS: credentials, HASNA_ACCESS_TOKEN_SIGNING_KEY: KEY };
  const app = buildCoreApp(pool, env);
  const request = async (path: string, method = "GET", body?: unknown, token = "test-owner") => app.request(`/v1/${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const create = async (entity_id: string) => (await (await request("identities", "POST", { entity_id, kind: "agent", name: "review" })).json()) as { id: string };
  return { pg, pool, entityA, entityB, request, create, env, app };
}

test("P1 elevation expiry cannot mutate foreign or unscoped tenant rows", async () => {
  const f = await fixture();
  try {
    const a = await f.create(f.entityA), b = await f.create(f.entityB);
    const ids: string[] = [];
    for (const identity of [a, b]) for (const status of ["pending", "active"]) {
      const id = crypto.randomUUID(); ids.push(id);
      await f.pg.query("INSERT INTO elevations (id, identity_id, entity_id, scope, reason, expires_at, status) VALUES ($1,$2,$3,'access:read','test','2000-01-01T00:00:00.000Z',$4)", [id, identity.id, identity === a ? f.entityA : f.entityB, status]);
    }
    expect(await (await f.request("elevations/expire", "POST", {}, "test-unscoped")).json()).toEqual({ expired: 0 });
    expect(await (await f.request("elevations/expire", "POST", {}, "test-writer")).json()).toEqual({ expired: 2 });
    expect((await f.pg.query("SELECT status FROM elevations WHERE entity_id=$1 ORDER BY status", [f.entityB])).rows).toEqual([{ status: "active" }, { status: "pending" }]);
    expect((await f.pg.query("SELECT entity_id FROM audit_log WHERE event_type='elevation.expired'")).rows).toEqual([{ entity_id: f.entityA }, { entity_id: f.entityA }]);
    expect(await (await f.request("elevations/expire", "POST", {}, "test-writer")).json()).toEqual({ expired: 0 });
  } finally { await f.pool.end(); }
}, 60_000);

for (const status of ["suspend", "retire"]) test(`P1 ${status} makes issued bearer unusable and prevents fresh issuance`, async () => {
  const f = await fixture();
  try {
    const identity = await f.create(f.entityA);
    await f.request("scopes", "POST", { identity_id: identity.id, scope: "access:read" });
    const token = await (await f.request("tokens", "POST", { identity_id: identity.id })).json() as { token: string };
    expect((await f.request(`identities/${identity.id}`, "GET", undefined, token.token)).status).toBe(200);
    expect((await f.request(`identities/${identity.id}/${status}`, "POST", {})).status).toBe(200);
    expect((await f.request(`identities/${identity.id}`, "GET", undefined, token.token)).status).toBe(401);
    expect((await f.request("tokens/verify", "POST", { token: token.token })).status).toBe(401);
    expect((await f.request("tokens", "POST", { identity_id: identity.id })).status).toBe(400);
    expect((await f.pg.query("SELECT id FROM issued_tokens")).rows).toHaveLength(1);
  } finally { await f.pool.end(); }
}, 60_000);

test("P1 explicit signing declarations fail closed instead of falling through", () => {
  const blankFile = join(temporary, "blank"); writeFileSync(blankFile, "\n");
  const otherFile = join(temporary, "other"); writeFileSync(otherFile, OTHER);
  for (const additions of [
    { HASNA_ACCESS_TOKEN_SIGNING_KEY_FILE: join(temporary, "missing") },
    { HASNA_ACCESS_TOKEN_SIGNING_KEY_FILE: blankFile },
    { ACCESS_TOKEN_SIGNING_KEY_FILE: "" },
    { ACCESS_TOKEN_SIGNING_KEY: "" },
    { ACCESS_TOKEN_SIGNING_KEY: OTHER },
    { HASNA_ACCESS_TOKEN_SIGNING_KEY_FILE: otherFile },
  ]) {
    for (const name of names) delete process.env[name];
    Object.assign(process.env, { HASNA_ACCESS_TOKEN_SIGNING_KEY: KEY }, additions);
    expect(() => assertTokenSigningPosture()).toThrow();
  }
});

test("P1 signing stays bound across configuration mutation and key-file replacement", async () => {
  const f = await fixture();
  try {
    const file = join(temporary, "key"); writeFileSync(file, KEY + "\n");
    const env = { HASNA_ACCESS_API_CREDENTIALS: f.env.HASNA_ACCESS_API_CREDENTIALS, HASNA_ACCESS_TOKEN_SIGNING_KEY_FILE: file };
    const app = buildCoreApp(f.pool, env);
    const identity = await f.create(f.entityA);
    await f.request("scopes", "POST", { identity_id: identity.id, scope: "access:read" });
    writeFileSync(file, OTHER);
    process.env.HASNA_ACCESS_TOKEN_SIGNING_KEY = OTHER;
    env.HASNA_ACCESS_TOKEN_SIGNING_KEY_FILE = join(temporary, "missing-after-start");
    const response = await app.request("/v1/tokens", { method: "POST", headers: { Authorization: "Bearer test-owner", "Content-Type": "application/json" }, body: JSON.stringify({ identity_id: identity.id }) });
    expect(response.status).toBe(201);
    const { token } = await response.json() as { token: string };
    const [header, payload, signature] = token.split(".");
    expect(signature).toBe(createHmac("sha256", KEY).update(`${header}.${payload}`).digest("base64url"));
    expect((await app.request(`/v1/identities/${identity.id}`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
  } finally { await f.pool.end(); }
}, 60_000);

test("P1 signing authorities remain isolated across overlapping async contexts", async () => {
  const a = createTokenSigner({ HASNA_ACCESS_TOKEN_SIGNING_KEY: KEY });
  const b = createTokenSigner({ HASNA_ACCESS_TOKEN_SIGNING_KEY: OTHER });
  const results = await Promise.all([a, b].map(signer => withTokenSigner(signer, async () => {
    await Promise.resolve();
    return currentTokenSigner().sign("context-probe");
  })));
  expect(results).toEqual([a.sign("context-probe"), b.sign("context-probe")]);
  expect(results[0]).not.toBe(results[1]);
  expect(() => currentTokenSigner()).toThrow("bound server signing context");
  expect(JSON.stringify(a)).not.toContain(KEY);
});

test("P1 equivalent signing aliases and newline-terminated file are allowed, weak/missing inputs are not", () => {
  const file = join(temporary, "equivalent"); writeFileSync(file, KEY + "\n");
  const signer = createTokenSigner({ HASNA_ACCESS_TOKEN_SIGNING_KEY: KEY, ACCESS_TOKEN_SIGNING_KEY: KEY, HASNA_ACCESS_TOKEN_SIGNING_KEY_FILE: file, ACCESS_TOKEN_SIGNING_KEY_FILE: file });
  expect(signer.sign("probe")).toBe(createHmac("sha256", KEY).update("probe").digest("base64url"));
  for (const env of [{}, { HASNA_ACCESS_TOKEN_SIGNING_KEY: "short" }, { HASNA_ACCESS_TOKEN_SIGNING_KEY: "access-dev-signing-key-local-only-do-not-use-in-prod" }, { HASNA_ACCESS_TOKEN_SIGNING_KEY: KEY, HASNA_ACCESS_TOKEN_SIGNING_KEY_FILE: temporary }]) expect(() => createTokenSigner(env)).toThrow();
});
