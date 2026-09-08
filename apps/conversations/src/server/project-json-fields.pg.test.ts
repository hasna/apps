import { adoptCorpus, inspectCorpus } from "./corpus-binding.js";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { ApiKeyStore, mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import { createQueryClient } from "../generated/storage-kit/query.js";
import { PG_MIGRATIONS } from "../lib/pg-migrations.js";
import { getStore, type ConversationsStore } from "../lib/store/index.js";
import { startApiServer } from "./api.js";

const dsn = process.env.CONVERSATIONS_TEST_DATABASE_URL;
const pgTest = dsn ? test : test.skip;
const schema = `project_json_${randomUUID().replaceAll("-", "")}`;
const role = `${schema}_role`;
let admin: Pool;
let pool: Pool;
let server: ReturnType<typeof startApiServer>;
let store: ConversationsStore;
let home: string;
let request: (path: string, method?: string, body?: unknown) => Promise<Response>;

beforeAll(async () => {
  if (!dsn) return;
  admin = new Pool({ connectionString: dsn, max: 1 });
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
  pool = new Pool({ connectionString: dsn, options: `-csearch_path=${schema} -crole=${role}`, max: 3 });
  const currentRole = await pool.query("SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user");
  expect(currentRole.rows[0]).toEqual({ name: role, rolsuper: false, rolbypassrls: false });
  const client = createQueryClient(pool);
  const signingSecret = randomBytes(32).toString("hex");
  const minted = mintApiKey({ app: "conversations", tid: "default", agent: "project-json-fixture", scopes: ["*"], signingSecret });
  server = startApiServer({ port: 0, host: "127.0.0.1", deps: {
    client, keys: new ApiKeyStore(client), incidentProjector: null,
    verifier: verifyApiKey({ app: "conversations", signingSecret, keyStatus: async () => "active" as const }),
  } });
  const url = `http://127.0.0.1:${server.port}`;
  home = mkdtempSync(join(tmpdir(), "conversations-project-json-"));
  store = getStore({ HOME: home, HASNA_STATION: randomUUID(), HASNA_CONVERSATIONS_API_URL: url, HASNA_CONVERSATIONS_API_KEY: minted.token }, { credentials: { keychain: { enabled: false } } });
  request = (path, method = "GET", body) => fetch(`${url}/v1${path}`, { method,
    headers: { "x-api-key": minted.token, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  expect((await fetch(`${url}/v1/projects`)).status).toBe(401);
}, 60000);

afterAll(async () => {
  if (!dsn) return;
  server?.stop(true);
  await pool?.end();
  if (admin) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.query(`DROP ROLE IF EXISTS ${role}`);
    await admin.end();
  }
  if (home) {
    const databases = readdirSync(home, { recursive: true }).map(String).filter(path => /\.(db|sqlite|sqlite3)(-wal|-shm)?$/.test(path));
    rmSync(home, { recursive: true, force: true });
    expect(databases).toEqual([]);
  }
}, 30000);

pgTest("actual authenticated API preserves every project JSON field on create and readback", async () => {
  const fields = { tags: ["one", "unicode-λ"], metadata: { nested: { count: 0, enabled: false }, list: [null, "fixture"] }, settings: { layout: "compact" } };
  const created = await store.createProject({ name: randomUUID(), created_by: "fixture", ...fields });
  for (const value of [created, await store.getProject(created.id), await store.getProjectByName(created.name)]) {
    expect(value).toMatchObject(fields);
  }
  const listed = await (await request("/projects?tag=one")).json() as { projects: Array<{ id: string }> };
  expect(listed.projects.some(project => project.id === created.id)).toBe(true);
});

pgTest("metadata-only updates and empty JSON values persist without dropping other fields", async () => {
  const created = await store.createProject({ name: randomUUID(), created_by: "fixture", tags: ["preserved"], settings: { enabled: false }, metadata: { initial: true } });
  const updated = await store.updateProject(created.id, { metadata: { replacement: [1, 2] } });
  expect(updated).toMatchObject({ metadata: { replacement: [1, 2] }, tags: ["preserved"], settings: { enabled: false } });
  await store.updateProject(created.id, { tags: [], settings: {}, metadata: {} });
  expect(await store.getProject(created.id)).toMatchObject({ tags: [], settings: {}, metadata: {} });
  const cleared = await request(`/projects/${created.id}`, "PATCH", { tags: null, settings: null, metadata: null });
  expect(cleared.status).toBe(200);
  const stored = await pool.query("SELECT tags,settings,metadata FROM projects WHERE id=$1", [created.id]);
  expect(stored.rows[0]).toEqual({ tags: null, settings: null, metadata: null });
});

pgTest("invalid JSON types or bounds reject before any project change and never echo content", async () => {
  const created = await store.createProject({ name: randomUUID(), created_by: "fixture", description: "preserved", metadata: { intact: true } });
  const before = (await pool.query("SELECT * FROM projects ORDER BY id")).rows;
  const marker = `synthetic-private-${randomUUID()}`;
  for (const invalid of [{ metadata: [marker] }, { settings: marker }, { tags: [marker, 1] }, { metadata: { data: marker.repeat(3000) } }, { settings: { number: "overflow-number-fixture" } }]) {
    for (const [path, method, body] of [
      ["/projects", "POST", { name: randomUUID(), created_by: "fixture", ...invalid }],
      [`/projects/${created.id}`, "PATCH", { description: "must-not-change", ...invalid }],
    ] as const) {
      // Preserve an overflowing JSON number through the actual HTTP parser.
      const response = await request(path, method, JSON.stringify(body).replace('"overflow-number-fixture"', '1e400'));
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain(marker);
    }
  }
  expect((await pool.query("SELECT * FROM projects ORDER BY id")).rows).toEqual(before);
});

pgTest("a database rejection rolls back scalar and JSON fields together", async () => {
  const created = await store.createProject({ name: randomUUID(), created_by: "fixture", description: "original", tags: ["original"], metadata: { keep: true } });
  await admin.query(`CREATE FUNCTION ${schema}.reject_project_patch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tags LIKE '%reject-fixture%' THEN RAISE EXCEPTION 'synthetic project write rejection'; END IF; RETURN NEW; END $$`);
  await admin.query(`CREATE TRIGGER reject_project_patch BEFORE UPDATE ON ${schema}.projects FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_project_patch()`);
  const before = (await pool.query("SELECT * FROM projects WHERE id=$1", [created.id])).rows;
  const response = await request(`/projects/${created.id}`, "PATCH", { description: "changed", tags: ["reject-fixture"], metadata: { replaced: true } });
  expect(response.ok).toBe(false);
  expect((await pool.query("SELECT * FROM projects WHERE id=$1", [created.id])).rows).toEqual(before);
});
