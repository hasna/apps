import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { runMigrations } from "./migrate.js";
import { PostgresSkillsStore } from "./store.js";

const configured = process.env.HASNA_SKILLS_TEST_DATABASE_URL?.trim();
const adminUrl = configured || "postgres://hasna@127.0.0.1:5432/postgres";
const bunWithSql = Bun as unknown as { SQL: new (url: string, options?: { max?: number }) => any };

async function open(url: string): Promise<any> {
  return new bunWithSql.SQL(url, { max: 1 });
}

async function scratch(): Promise<{ url: string; name: string } | null> {
  const name = `skills_operator_${randomUUID().replace(/-/g, "")}`;
  const admin = await open(adminUrl).catch(() => null);
  if (!admin) {
    if (configured) throw new Error("configured PostgreSQL test backend is unreachable");
    return null;
  }
  try {
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    const target = new URL(adminUrl);
    target.pathname = `/${name}`;
    return { url: target.toString(), name };
  } catch (error) {
    if (configured) throw error;
    return null;
  } finally {
    await admin.close?.();
  }
}

const database = await scratch();
const postgresTest = database ? test : test.skip;

postgresTest("operator enrollment is atomic, concurrent and readback-verifiable on PostgreSQL", async () => {
  const first = new PostgresSkillsStore(database!.url);
  const second = new PostgresSkillsStore(database!.url);
  const input = {
    keyId: "pg-operator-key",
    stationId: "station04",
    orgId: "pg-operator-org",
    expectedScopes: ["skills:read", "runs:write"],
    operationId: "pg-operation-1",
    manifestDigest: "a".repeat(64),
    operatorJobId: "job-derived",
    operatorTaskArn: "arn:aws:ecs:eu-west-1:123456789012:task/cluster/task-1",
  };
  try {
    await runMigrations(database!.url);
    await first.ensureBootstrapApiKey("pg-operator-secret", { apiKeyId: input.keyId, orgId: input.orgId, scopes: [...input.expectedScopes] });
    const before = await open(database!.url);
    const original = await before`SELECT key_hash, org_id, scopes_json FROM api_keys WHERE id = ${input.keyId}`;
    await before.close?.();

    const [one, two] = await Promise.all([first.enrollPublishScopeByOperator(input), second.enrollPublishScopeByOperator(input)]);
    expect([one.kind, two.kind].sort()).toEqual(["already_applied", "updated"]);
    expect(one).toMatchObject({ scopes: [...input.expectedScopes, "skills:publish"] });
    expect(two).toMatchObject({ scopes: [...input.expectedScopes, "skills:publish"] });

    const conflict = await first.enrollPublishScopeByOperator({ ...input, manifestDigest: "b".repeat(64) });
    expect(conflict.kind).toBe("target_mismatch");
    const stale = await first.enrollPublishScopeByOperator({ ...input, operationId: "pg-operation-2" });
    expect(stale).toMatchObject({ kind: "stale", scopes: [...input.expectedScopes, "skills:publish"] });
    expect((await first.enrollPublishScopeByOperator({ ...input, orgId: "foreign-org", operationId: "foreign-op" })).kind).toBe("target_mismatch");
    await first.ensureBootstrapApiKey("pg-second-secret", { apiKeyId: "pg-second-key", orgId: input.orgId, scopes: [...input.expectedScopes] });
    expect((await first.enrollPublishScopeByOperator({ ...input, keyId: "pg-second-key" })).kind).toBe("target_mismatch");

    const check = await open(database!.url);
    const after = await check`SELECT key_hash, org_id, scopes_json FROM api_keys WHERE id = ${input.keyId}`;
    const receipt = await check`SELECT operator_operation_id, metadata_json FROM skills_audit_events WHERE operator_operation_id = ${input.operationId}`;
    expect(after[0].key_hash).toBe(original[0].key_hash);
    expect(after[0].org_id).toBe(original[0].org_id);
    expect(JSON.parse(after[0].scopes_json)).toEqual([...input.expectedScopes, "skills:publish"]);
    expect(receipt).toHaveLength(1);
    expect(receipt[0].operator_operation_id).toBe(input.operationId);
    await check.close?.();

    const revoke = await open(database!.url);
    await revoke`UPDATE api_keys SET revoked_at = now() WHERE id = ${input.keyId} AND org_id = ${input.orgId}`;
    await revoke.close?.();
    expect((await first.enrollPublishScopeByOperator({ ...input, operationId: "revoked-op" })).kind).toBe("not_found");
  } finally {
    await first.close();
    await second.close();
    const admin = await open(adminUrl);
    try { await admin.unsafe(`DROP DATABASE IF EXISTS "${database!.name}" WITH (FORCE)`); } finally { await admin.close?.(); }
  }
});

postgresTest("operator enrollment rolls back scope mutation when audit insertion fails", async () => {
  const own = await scratch();
  if (!own) return;
  await runMigrations(own.url);
  const store = new PostgresSkillsStore(own.url);
  const input = {
    keyId: "pg-rollback-key", stationId: "station04", orgId: "pg-rollback-org", expectedScopes: ["skills:read"],
    operationId: "rollback-op", manifestDigest: "c".repeat(64), operatorJobId: "job", operatorTaskArn: "task",
  };
  const sql = await open(own.url);
  try {
    await store.ensureBootstrapApiKey("rollback-secret", { apiKeyId: input.keyId, orgId: input.orgId, scopes: [...input.expectedScopes] });
    await sql.unsafe(`CREATE OR REPLACE FUNCTION fail_operator_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END; $$`);
    await sql.unsafe(`CREATE TRIGGER fail_operator_audit BEFORE INSERT ON skills_audit_events FOR EACH ROW WHEN (NEW.operator_operation_id IS NOT NULL) EXECUTE FUNCTION fail_operator_audit()`);
    await expect(store.enrollPublishScopeByOperator(input)).rejects.toThrow("synthetic audit failure");
    const row = await sql`SELECT scopes_json FROM api_keys WHERE id = ${input.keyId}`;
    const audit = await sql`SELECT operator_operation_id FROM skills_audit_events WHERE operator_operation_id = ${input.operationId}`;
    expect(JSON.parse(row[0].scopes_json)).toEqual(input.expectedScopes);
    expect(audit).toHaveLength(0);
  } finally {
    await sql.close?.();
    await store.close();
    const admin = await open(adminUrl);
    try { await admin.unsafe(`DROP DATABASE IF EXISTS "${own.name}" WITH (FORCE)`); } finally { await admin.close?.(); }
  }
});
