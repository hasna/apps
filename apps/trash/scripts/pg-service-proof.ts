import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiKeyStore, mintApiKey } from "@hasna/contracts/auth";
import { PgTrashStore } from "../src/api/store.js";
import { createTrashHandler } from "../src/api/service.js";
import { ApiError } from "../src/api/domain.js";
import type { TrashObjects } from "../src/api/objects.js";
import { createCapsule, inspectCapsule } from "../src/capsule.js";
import { verifyClientCredential } from "./ci/verify-client-key.js";
import { VERSION } from "../src/version.js";

const databaseUrl = process.env.TRASH_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TRASH_TEST_DATABASE_URL must identify an explicitly disposable PostgreSQL database.");
const tenant = `test-${randomUUID()}`; const signingSecret = randomBytes(32);
const store = await PgTrashStore.open(databaseUrl, { migrate: true });
const root = realpathSync(mkdtempSync(join(tmpdir(), "trash-service-proof-")));
const source = join(root, "source"); const capsule = join(root, "capsule"); writeFileSync(source, "service proof bytes\n");
const receipt = createCapsule(source, capsule);
let uploaded = false; let clock = Date.now();
const objects: TrashObjects = {
  async ready() {},
  async upload() { return { url: "https://objects.example.test/upload", method: "PUT", headers: {}, expiresAt: new Date(clock + 60_000).toISOString() }; },
  async download() { return { url: "https://objects.example.test/download", method: "GET", headers: {}, expiresAt: new Date(clock + 60_000).toISOString() }; },
  async verify() { if (!uploaded) throw new ApiError(409, "upload_missing", "The payload is not uploaded."); return { version: "test-object-version", receipt: inspectCapsule(capsule) }; },
  async remove() {},
};
const handler = createTrashHandler(store, objects, { signingSecret, now: () => clock });
const keys = new ApiKeyStore(store.authQueryClient());
async function key(agent: string, scopes = ["trash:read", "trash:write"], tid = tenant) {
  const minted = mintApiKey({ app: "trash", signingSecret, tid, agent, scopes }); await keys.insertMinted(minted); return minted;
}
type Wire = Record<string, any>;
async function request(token: string | null, path: string, options: { body?: unknown; version?: number; key?: string; status?: number } = {}): Promise<Wire> {
  const headers = new Headers(); if (token) headers.set("authorization", `Bearer ${token}`);
  if (options.body !== undefined) { headers.set("content-type", "application/json"); headers.set("idempotency-key", options.key ?? randomUUID()); }
  if (options.version !== undefined) headers.set("if-match", String(options.version));
  const response = await handler(new Request(`https://trash.example.test${path}`, { method: options.body === undefined ? "GET" : "POST", headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }));
  const body = await response.json() as Wire;
  assert.equal(response.status, options.status ?? 200, `unexpected status for ${path}: ${body.error?.code ?? response.status}`);
  return body;
}
try {
  const first = await key("station-one"); const second = await key("station-two");
  const reader = await key("read-only", ["trash:read"]);
  const worker = await key("backup-worker", ["trash:read", "trash:backup"]);
  const foreign = await key("foreign", ["trash:read"], `${tenant}-other`);
  assert.equal((await verifyClientCredential(first.token, VERSION, (url, init) =>
    handler(new Request(url.replace("/trash/v1/", "/v1/"), init)))).authenticated, true);
  await request(null, "/health"); await request(null, "/ready");
  await request(null, "/v1/entries", { status: 401 });
  await request("invalid", "/v1/entries", { status: 401 });
  const stationBody = { name: "station-one", hostname: "Mac", source: "tailscale", platform: "darwin", architecture: "arm64" };
  await request(first.token, "/v1/stations/register", { body: { ...stationBody, name: "station-two" }, status: 403 });
  await request(reader.token, "/v1/stations/register", { body: stationBody, status: 403 });
  const station = await request(first.token, "/v1/stations/register", { body: stationBody });
  await request(second.token, "/v1/stations/register", { body: { ...stationBody, name: "station-two" } });
  const input = { id: randomUUID(), stationId: station.id, originalPath: source, ...receipt, agent: { name: "proof", harness: "codex", session: null } };
  await request(second.token, "/v1/entries", { body: input, status: 403 });
  const captureKey = randomUUID();
  let entry = await request(first.token, "/v1/entries", { body: input, key: captureKey, status: 201 });
  assert.deepEqual(await request(first.token, "/v1/entries", { body: input, key: captureKey, status: 201 }), entry);
  const path = `/v1/entries/${entry.id}`;
  await request(first.token, `${path}/commit`, { body: {}, version: entry.version, status: 409 });
  await request(first.token, `${path}/verify`, { body: {}, version: entry.version, status: 409 });
  assert.equal((await request(first.token, `${path}/upload`, { body: {}, version: entry.version })).transfer.method, "PUT");
  uploaded = true;
  entry = await request(first.token, `${path}/verify`, { body: {}, version: entry.version });
  assert.equal(entry.state, "ready");
  await request(second.token, `${path}/commit`, { body: {}, version: entry.version, status: 403 });
  entry = await request(first.token, `${path}/commit`, { body: {}, version: entry.version });
  assert.equal(entry.state, "trashed"); assert.equal(Date.parse(entry.expiresAt) - clock, 90 * 86_400_000);
  assert.deepEqual(await request(first.token, `${path}/verify`, { body: {}, version: entry.version }), entry);
  assert.equal("objectKey" in entry, false); assert.equal("objectVersion" in entry, false);
  await request(foreign.token, path, { status: 404 });
  const list = await request(first.token, "/v1/entries?limit=1");
  assert.equal(list.items.length, 1); assert.equal("artifact" in list.items[0], false);
  await request(first.token, "/v1/entries?limit=1&limit=2", { status: 400 });
  await request(second.token, `${path}/restore`, { body: {}, version: entry.version, status: 409 });
  entry = await request(first.token, `${path}/hold`, { body: { held: true }, version: entry.version });
  entry = await request(first.token, `${path}/backup`, { body: {}, version: entry.version });
  await request(first.token, `${path}/backup/claim`, { body: {}, version: entry.version, status: 403 });
  let job = await request(worker.token, `${path}/backup/claim`, { body: {}, version: entry.version }); entry = job.entry;
  const backupReceipt = { id: "proof", destination: "test-archive", artifactSha256: receipt.artifact.sha256, verifiedAt: new Date(clock).toISOString(), held: true, restoreVerified: true };
  await request(worker.token, `${path}/backup/complete`, { body: { jobId: job.job.id, receipt: { ...backupReceipt, artifactSha256: "0".repeat(64) } }, version: entry.version, status: 422 });
  entry = await request(worker.token, `${path}/backup/fail`, { body: { jobId: job.job.id }, version: entry.version });
  assert.equal(entry.backup, "failed"); assert.equal(entry.held, true);
  job = await request(worker.token, `${path}/backup/claim`, { body: {}, version: entry.version }); entry = job.entry;
  entry = await request(worker.token, `${path}/backup/complete`, { body: { jobId: job.job.id, receipt: backupReceipt }, version: entry.version });
  assert.equal(entry.backup, "verified"); assert.equal(entry.held, true);
  const restore = await request(second.token, `${path}/restore`, { body: { crossStation: true }, version: entry.version }); entry = restore.entry;
  const resumed = await request(second.token, `${path}/restore`, { body: { crossStation: true }, version: entry.version }); entry = resumed.entry;
  assert.equal(resumed.lease.id, restore.lease.id);
  entry = await request(first.token, `${path}/hold`, { body: { held: false }, version: entry.version });
  // Expiry during an active download cannot prevent its matching completion.
  await store.sql.begin(async (tx) => {
    const current = await store.entry(tenant, entry.id, tx, true);
    await store.replaceEntry(tenant, { ...current, expiresAt: new Date(clock - 1).toISOString() }, current.version, tx);
  });
  entry = await request(second.token, path);
  await request(first.token, `${path}/restore/complete`, { body: { leaseId: restore.lease.id, sha256: entry.sha256 }, version: entry.version, status: 409 });
  entry = await request(second.token, `${path}/restore/complete`, { body: { leaseId: restore.lease.id, sha256: entry.sha256 }, version: entry.version });
  assert.equal(entry.state, "restored"); assert.equal((await request(first.token, "/v1/entries")).items.length, 0);
  await keys.revoke(first.kid, "proof", Date.now(), { app: "trash" });
  await request(first.token, path, { status: 401 });
  console.log(JSON.stringify({ proof: "postgres-http-service", passed: true, objectPlane: "injected fixture adapter; not S3", checks: ["public-probes", "auth-denial", "read-only-denial", "signed-station-binding", "capture-replay", "verified-before-commit", "station-isolation", "tenant-isolation", "90-day-expiry", "compact-list", "backup-hold-and-receipt", "backup-worker-scope", "cross-station-restore-lease", "restored-list-filter", "live-revocation"] }));
} finally {
  await store.sql.unsafe("DELETE FROM api_keys WHERE tid=$1 OR tid=$2", [tenant, `${tenant}-other`]);
  for (const table of ["trash_idempotency", "trash_entries", "trash_station_keys", "trash_stations"]) await store.sql.unsafe(`DELETE FROM ${table} WHERE tenant=$1`, [tenant]);
  await store.close(); rmSync(root, { recursive: true, force: true });
}
