import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mintApiKey, API_KEY_ISSUANCE_PENDING_REASON, type ApiKeyRecord, type MintedApiKey } from "@hasna/contracts/auth";
import { provisionCredential, type IssuanceStore } from "./provision.js";
function fixture() {
  const signingSecret = randomBytes(32); const records = new Map<string, ApiKeyRecord>(); let token: string | null = null; let writes = 0;
  const keys: IssuanceStore = {
    async findByKid(kid) { return records.get(kid) ?? null; },
    async insertMintedPending(key: MintedApiKey) { records.set(key.kid, { kid: key.kid, app: "trash", agent: key.claims.agent!, tid: key.claims.tid!, scopes: key.claims.scopes, tokenHash: key.tokenHash, issuedAt: new Date(key.claims.iat * 1000).toISOString(), expiresAt: new Date(key.claims.exp! * 1000).toISOString(), revokedAt: new Date().toISOString(), revokedReason: API_KEY_ISSUANCE_PENDING_REASON, lastUsedAt: null, createdBy: "fixture" }); },
    async activatePending(kid, hash) { const record = records.get(kid)!; if (record.tokenHash !== hash || (record.revokedReason !== null && record.revokedReason !== API_KEY_ISSUANCE_PENDING_REASON)) return false; record.revokedAt = null; record.revokedReason = null; return true; },
  };
  return { signingSecret, records, keys, get token() { return token; }, set token(value) { token = value; }, get writes() { return writes; }, vault: { async read() { return token; }, async write(value: string) { writes++; expect([...records.values()].every((r) => r.revokedAt !== null)).toBe(true); token = value; } } };
}
test("station mint remains pending until delivery readback, then retry reuses the same key", async () => {
  const f = fixture(); const options = { keys: f.keys, vault: f.vault, signingSecret: f.signingSecret, tenant: "fixture", subject: "station06", kind: "station" as const };
  const result = await provisionCredential(options); expect(result.subject).toBe("station06"); expect(result.scopes).toEqual(["trash:read", "trash:write"]);
  expect(JSON.stringify(result)).not.toContain(f.token!); expect(f.records.get(result.kid)?.revokedAt).toBeNull();
  expect((await provisionCredential(options)).kid).toBe(result.kid); expect(f.writes).toBe(1);
});
test("a lost vault write response recovers by exact readback", async () => {
  const f = fixture(); const vault = { read: f.vault.read, async write(token: string) { await f.vault.write(token); throw new Error("lost response"); } };
  const result = await provisionCredential({ keys: f.keys, vault, signingSecret: f.signingSecret, tenant: "fixture", subject: "backup-worker", kind: "backup-worker" });
  expect(result.scopes).toEqual(["trash:read", "trash:backup"]); expect(f.records.get(result.kid)?.revokedAt).toBeNull();
});
test("undelivered keys never become active and revoked keys are never reactivated", async () => {
  const f = fixture(); const options = { keys: f.keys, vault: { read: f.vault.read, async write() { throw new Error("denied"); } }, signingSecret: f.signingSecret, tenant: "fixture", subject: "station06", kind: "station" as const };
  await expect(provisionCredential(options)).rejects.toThrow(); expect([...f.records.values()].every((r) => r.revokedAt !== null)).toBe(true);
  const key = mintApiKey({ app: "trash", signingSecret: f.signingSecret, tid: "fixture", agent: "station06", scopes: ["trash:read", "trash:write"] });
  await f.keys.insertMintedPending(key); f.records.get(key.kid)!.revokedReason = "operator_revoked"; f.token = key.token;
  await expect(provisionCredential({ ...options, vault: f.vault })).rejects.toThrow();
});
test("wrong station, tenant or scopes in an existing credential are terminal", async () => {
  for (const change of [{ agent: "station01" }, { tid: "other" }, { scopes: ["trash:*"] }]) {
    const f = fixture(); const key = mintApiKey({ app: "trash", signingSecret: f.signingSecret, tid: "fixture", agent: "station06", scopes: ["trash:read", "trash:write"], ...change }); f.token = key.token;
    await expect(provisionCredential({ keys: f.keys, vault: f.vault, signingSecret: f.signingSecret, tenant: "fixture", subject: "station06", kind: "station" })).rejects.toThrow(); expect(f.writes).toBe(0);
  }
});
test("a delivered signed key whose database transaction rolled back can be registered on retry", async () => {
  const f = fixture(); const key = mintApiKey({ app: "trash", signingSecret: f.signingSecret, tid: "fixture", agent: "station06", scopes: ["trash:read", "trash:write"], ttlSeconds: 365 * 86400 }); f.token = key.token;
  const result = await provisionCredential({ keys: f.keys, vault: f.vault, signingSecret: f.signingSecret, tenant: "fixture", subject: "station06", kind: "station" });
  expect(result.kid).toBe(key.kid); expect(f.writes).toBe(0); expect(f.records.get(key.kid)?.revokedAt).toBeNull();
});
