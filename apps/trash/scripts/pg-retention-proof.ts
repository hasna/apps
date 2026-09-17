import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PgTrashStore } from "../src/api/store.js";
import { sweepExpired } from "../src/api/retention.js";
import type { Entry } from "../src/api/domain.js";
import type { TrashObjects } from "../src/api/objects.js";

const databaseUrl = process.env.TRASH_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TRASH_TEST_DATABASE_URL must identify an explicitly disposable PostgreSQL database.");
const tenant = `test-${randomUUID()}`; const clock = Date.now();
const store = await PgTrashStore.open(databaseUrl, { migrate: true });
let fail = false; const removed: string[] = [];
const objects = { async remove(entry: Entry) { assert.equal(entry.state, "deleting"); assert.equal(entry.objectVersion, "fixture-version"); if (fail) throw new Error("fixture outage"); removed.push(entry.id); } } as TrashObjects;
try {
  const station = await store.registerStation(tenant, "fixture", { name: "station-test", hostname: "Mac", source: "tailscale", platform: "darwin", architecture: "arm64" });
  const base: Entry = { id: randomUUID(), stationId: station.id, originalPath: "/fixture", kind: "file", mode: 0o600, sizeBytes: 1, sha256: "a".repeat(64),
    artifact: { format: "hasna.trash.capsule.v1", sizeBytes: 512, sha256: "b".repeat(64) }, agent: { name: "fixture", harness: null, session: null },
    retentionDays: 90, version: 1, stationName: station.name, state: "trashed", capturedAt: new Date(clock - 91 * 86400_000).toISOString(),
    expiresAt: new Date(clock - 86400_000).toISOString(), held: false, backup: "none", objectKey: "fixture", objectVersion: "fixture-version" };
  async function add(changes: Partial<Entry>) {
    const entry = { ...base, ...changes, id: randomUUID() };
    await store.mutate(tenant, "fixture", "create", randomUUID(), entry, (tx) => store.insertEntry(tenant, entry, tx)); return entry;
  }
  const expired = await add({});
  const protectedEntries = await Promise.all([
    add({ held: true }), add({ backup: "requested" }), add({ backup: "failed" }), add({ backup: "running" }),
    add({ expiresAt: null }), add({ expiresAt: new Date(clock + 86400_000).toISOString() }),
    add({ downloadUntil: new Date(clock + 60_000).toISOString() }), add({ state: "ready" }),
  ]);
  const archived = await add({ backup: "verified", state: "restored", backupReceipt: { id: "archive", destination: "backup", artifactSha256: base.artifact.sha256, held: true, restoreVerified: true, verifiedAt: new Date(clock).toISOString() } });
  const result = await sweepExpired(store, objects, { now: () => clock, tenant });
  assert.equal(result.expired, 2); assert.deepEqual(new Set(removed), new Set([expired.id, archived.id]));
  for (const entry of protectedEntries) assert.equal((await store.entry(tenant, entry.id)).state, entry.state);
  assert.equal((await store.entry(tenant, archived.id)).backupReceipt?.id, "archive");
  const retry = await add({}); fail = true;
  assert.equal((await sweepExpired(store, objects, { now: () => clock, tenant })).failed, 1);
  assert.equal((await store.entry(tenant, retry.id)).state, "deleting");
  fail = false;
  assert.equal((await sweepExpired(store, objects, { now: () => clock, tenant })).expired, 1);
  assert.equal((await store.entry(tenant, retry.id)).state, "expired");
  const concurrent = await add({});
  let started!: () => void; let release!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const resume = new Promise<void>((resolve) => { release = resolve; });
  const remove = objects.remove;
  objects.remove = async (item) => { started(); await resume; await remove(item); };
  const first = sweepExpired(store, objects, { now: () => clock, tenant, limit: 1 });
  try {
    await Promise.race([entered, Bun.sleep(2000).then(() => { throw new Error("Claim was not observed"); })]);
    assert.equal((await store.entry(tenant, concurrent.id)).state, "deleting");
    assert.equal((await sweepExpired(store, objects, { now: () => clock, tenant, limit: 1 })).expired, 0);
  } finally { release(); }
  assert.equal((await first).expired, 1);
  assert.equal(removed.filter((id) => id === concurrent.id).length, 1);
  console.log(JSON.stringify({ proof: "postgres-retention", passed: true, checks: ["expiry", "pins", "pending-backup-hold", "failed-backup-hold", "running-backup-hold", "restore-lease", "never-expire", "future-retention", "verified-backup-independence", "deletion-tombstone", "retry-after-object-failure", "committed-before-object-delete", "concurrent-worker-exclusion"] }));
} finally {
  for (const table of ["trash_idempotency", "trash_entries", "trash_station_keys", "trash_stations"]) await store.sql.unsafe(`DELETE FROM ${table} WHERE tenant=$1`, [tenant]);
  await store.close();
}
