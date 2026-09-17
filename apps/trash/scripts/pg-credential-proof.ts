import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { ApiKeyStore, verifyApiKeyToken } from "@hasna/contracts/auth";
import { PgTrashStore } from "../src/api/store.js";
import { provisionCredential } from "../src/mint/provision.js";
const url = process.env.TRASH_TEST_DATABASE_URL;
if (!url) throw new Error("TRASH_TEST_DATABASE_URL must identify a disposable PostgreSQL database.");
const store = await PgTrashStore.open(url, { migrate: true }); const signingSecret = randomBytes(32); const tenant = `test-${randomUUID()}`;
let token: string | null = null; let writes = 0;
const keys = new ApiKeyStore(store.authQueryClient());
const vault = { async read() { return token; }, async write(value: string) {
  writes++; const claims = verifyApiKeyToken(value, { expectedApp: "trash", signingSecret, expectedTid: tenant }); assert.equal(claims.ok, true);
  if (claims.ok) assert.equal(await keys.status(claims.kid), "unknown", "uncommitted issuance must not authenticate");
  token = value; throw new Error("fixture lost vault response");
} };
const issue = (rollback = false) => store.sql.begin(async (tx) => {
  await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`credential-proof:${tenant}`]);
  const result = await provisionCredential({ keys: new ApiKeyStore(store.authQueryClient(tx)), vault, signingSecret, tenant, subject: "station-fixture", kind: "station" });
  if (rollback) throw new Error("fixture database rollback after vault delivery");
  return result;
});
try {
  await assert.rejects(issue(true)); assert.equal(writes, 1); assert.notEqual(token, null);
  const [first, second] = await Promise.all([issue(), issue()]); assert.equal(first.kid, second.kid); assert.equal(writes, 1); assert.equal(await keys.status(first.kid), "active");
  const rows = await store.sql.unsafe("SELECT kid FROM api_keys WHERE tid=$1", [tenant]); assert.equal(rows.length, 1);
  await keys.revoke(first.kid, "operator_revoked", Date.now(), { app: "trash" }); await assert.rejects(issue()); assert.equal(await keys.status(first.kid), "revoked");
  console.log(JSON.stringify({ proof: "postgres-credential-provision", passed: true, vault: "injected fixture; not Secrets Manager", checks: ["pending-before-delivery", "lost-vault-response", "database-rollback-recovery", "concurrent-exact-key-reuse", "revocation-terminal", "station-and-tenant-bound"] }));
} finally { await store.sql.unsafe("DELETE FROM api_keys WHERE tid=$1", [tenant]); await store.close(); }
