import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { randomBytes } from "node:crypto";
import { ApiKeyStore, mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import { PgTrashStore } from "../src/api/store.js";
import { parseInput, captureSchema, type Entry } from "../src/api/domain.js";

const databaseUrl = process.env.TRASH_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TRASH_TEST_DATABASE_URL must identify an explicitly disposable PostgreSQL database.");
const tenant = `test-${randomUUID()}`;
const principal = `key-${randomUUID()}`;
const store = await PgTrashStore.open(databaseUrl, { migrate: true });
try {
  await store.ready();
  const signingSecret = randomBytes(32);
  const keys = new ApiKeyStore(store.authQueryClient());
  const minted = mintApiKey({ app: "trash", signingSecret, tid: tenant, agent: "station-test", scopes: ["trash:read", "trash:write"] });
  await keys.insertMinted(minted);
  const storedKey = await keys.findByKid(minted.kid);
  assert.deepEqual(storedKey?.scopes, ["trash:read", "trash:write"]);
  assert.equal(storedKey?.tid, tenant);
  const verifier = verifyApiKey({ app: "trash", signingSecret, keyStatus: keys.keyStatus, requireTenant: true });
  const headers = new Headers({ authorization: `Bearer ${minted.token}` });
  assert.equal((await verifier.authenticate(headers, { requiredScopes: ["trash:write"] })).ok, true);
  assert.equal((await verifier.authenticate(headers, { requiredScopes: ["trash:backup"] })).ok, false);
  assert.equal((await verifier.authenticate(new Headers())).ok, false);
  await keys.revoke(minted.kid, "proof", Date.now(), { app: "trash" });
  assert.equal((await verifier.authenticate(headers)).ok, false);
  const station = await store.registerStation(tenant, principal, {
    name: "station-test", hostname: "Mac", source: "tailscale", platform: "darwin", architecture: "arm64",
  });
  assert.equal((await store.stationForKey(tenant, principal)).id, station.id);
  let executions = 0;
  const result = await store.mutate(tenant, principal, "proof", "proof-replay-0001", { value: 1 }, async () => {
    executions++;
    return { value: "saved" };
  });
  assert.deepEqual(result, { value: "saved" });
  assert.deepEqual(await store.mutate(tenant, principal, "proof", "proof-replay-0001", { value: 1 }, async () => {
    executions++; return { value: "wrong" };
  }), result);
  assert.equal(executions, 1);
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => store.mutate(tenant, principal, "concurrent", "concurrent-key-01", {}, async () => {
    executions++; await Bun.sleep(10); return { executions };
  })));
  assert.equal(executions, 2);
  assert.equal(new Set(concurrent.map((value) => JSON.stringify(value))).size, 1);
  await assert.rejects(store.mutate(tenant, principal, "rollback", "rollback-key-001", {}, async () => { throw new Error("fixture rollback"); }), /fixture rollback/);
  assert.deepEqual(await store.mutate(tenant, principal, "rollback", "rollback-key-001", {}, async () => ({ recovered: true })), { recovered: true });
  await assert.rejects(store.mutate(tenant, principal, "proof", "proof-replay-0001", { value: 2 }, async () => ({})), /different request/);

  const input = parseInput(captureSchema, {
    id: randomUUID(), stationId: station.id, originalPath: "/fixture/report.txt", kind: "file", sizeBytes: 7,
    sha256: "a".repeat(64), mode: 0o600, artifact: { format: "hasna.trash.capsule.v1", sha256: "b".repeat(64), sizeBytes: 512 },
    agent: { name: "proof", harness: "codex", session: null },
  });
  const entry: Entry = { ...input, version: 1, stationName: station.name, state: "trashed", capturedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 90 * 86400_000).toISOString(), held: false, backup: "none", objectKey: "fixture/object", objectVersion: "fixture-version" };
  await store.mutate(tenant, principal, "create", randomUUID(), input, async (tx) => store.insertEntry(tenant, entry, tx));
  assert.equal((await store.entry(tenant, entry.id)).sha256, entry.sha256);
  await assert.rejects(store.entry(`other-${tenant}`, entry.id), /not found/);
  assert.equal((await store.list(tenant, { limit: 20 })).items.length, 1);
  const otherEntries = [
    { ...entry, id: randomUUID(), originalPath: "/fixture/literal%_bang!.txt" },
    { ...entry, id: randomUUID(), originalPath: "/fixture/third.txt" },
  ];
  for (const item of otherEntries) await store.mutate(tenant, principal, "create", randomUUID(), item, (tx) => store.insertEntry(tenant, item, tx));
  const ids = new Set<string>(); let cursor: string | undefined;
  do {
    const page = await store.list(tenant, { limit: 1, ...(cursor ? { cursor } : {}) });
    assert.equal(page.items.length, 1); assert.equal(ids.has(page.items[0]!.id), false); ids.add(page.items[0]!.id);
    if (page.nextCursor) {
      await assert.rejects(store.list(tenant, { limit: 1, cursor: page.nextCursor, station: "changed-filter" }), /cursor/);
      await assert.rejects(store.list(`other-${tenant}`, { limit: 1, cursor: page.nextCursor }), /cursor/);
      await assert.rejects(store.list(tenant, { limit: 1, cursor: page.nextCursor + "x" }), /cursor/);
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(ids.size, 3);
  assert.equal((await store.list(tenant, { limit: 20, path: "%_bang!" })).items.length, 1);
  await store.mutate(tenant, principal, "hold", randomUUID(), { id: entry.id }, async (tx) => {
    const locked = await store.entry(tenant, entry.id, tx, true);
    return store.replaceEntry(tenant, { ...locked, held: true }, locked.version, tx);
  });
  assert.equal((await store.entry(tenant, entry.id)).held, true);
  assert.equal((await store.entry(tenant, entry.id)).version, 2);
  await assert.rejects(store.mutate(tenant, principal, "stale", randomUUID(), {}, async (tx) => store.replaceEntry(tenant, entry, 1, tx)), /changed/);
  console.log(JSON.stringify({ proof: "postgres-domain", passed: true, checks: ["migration", "signed-auth", "scope-denial", "anonymous-denial", "revocation", "station-binding", "idempotency-replay", "concurrent-replay", "rollback-retry", "body-conflict", "tenant-isolation", "keyset-pagination", "cursor-filter-and-tenant-binding", "cursor-tamper-denial", "literal-path-search", "locked-mutation", "optimistic-version"] }));
} finally {
  await store.sql.unsafe("DELETE FROM api_keys WHERE tid=$1", [tenant]);
  for (const table of ["trash_idempotency", "trash_entries", "trash_station_keys", "trash_stations"]) {
    await store.sql.unsafe(`DELETE FROM ${table} WHERE tenant = $1`, [tenant]);
  }
  await store.close();
}
