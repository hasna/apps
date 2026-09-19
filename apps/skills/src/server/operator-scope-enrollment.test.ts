import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { MemorySkillsStore } from "./store.js";
import { SqliteSkillsStore } from "./sqlite-store.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const input = {
  keyId: "station-key",
  stationId: "station04",
  orgId: "org_a",
  expectedScopes: ["skills:read", "runs:write"],
  operationId: "enroll-1",
  manifestDigest: "a".repeat(64),
  operatorJobId: "job-1",
  operatorTaskArn: "task-1",
};

describe("operator publication-scope enrollment", () => {
  test("memory CAS adds only publish and reconciles the same operation", async () => {
    const store = new MemorySkillsStore([{ token: "station-secret", principal: { apiKeyId: input.keyId, orgId: input.orgId, scopes: input.expectedScopes } }]);
    expect(await store.enrollPublishScopeByOperator!(input)).toEqual({ kind: "updated", scopes: [...input.expectedScopes, "skills:publish"] });
    expect(await store.enrollPublishScopeByOperator!(input)).toEqual({ kind: "already_applied", scopes: [...input.expectedScopes, "skills:publish"] });
    expect(await store.enrollPublishScopeByOperator!({ ...input, manifestDigest: "b".repeat(64) })).toEqual({ kind: "target_mismatch" });
    expect(await store.enrollPublishScopeByOperator!({ ...input, operationId: "other", expectedScopes: input.expectedScopes })).toEqual({ kind: "stale", scopes: [...input.expectedScopes, "skills:publish"] });
    expect(await store.enrollPublishScopeByOperator!({ ...input, orgId: "org_b", operationId: "foreign" })).toEqual({ kind: "not_found" });
  });

  test("sqlite updates scope metadata while preserving key hash and tenant", async () => {
    const dir = mkdtempSync(join(process.env.TMPDIR || "/tmp", "skills-operator-scope-"));
    const store = new SqliteSkillsStore(join(dir, "skills.db"));
    try {
      await store.ensureBootstrapApiKey!("station-secret", { apiKeyId: input.keyId, orgId: input.orgId, scopes: input.expectedScopes });
      const before = store.database.query("SELECT key_hash, org_id, user_id, name FROM api_keys WHERE id = ?").get(input.keyId) as Record<string, string>;
      expect(await store.enrollPublishScopeByOperator!(input)).toEqual({ kind: "updated", scopes: [...input.expectedScopes, "skills:publish"] });
      const after = store.database.query("SELECT key_hash, org_id, user_id, name, scopes_json FROM api_keys WHERE id = ?").get(input.keyId) as Record<string, string>;
      expect(after.key_hash).toBe(before.key_hash);
      expect(after.org_id).toBe(before.org_id);
      expect(after.user_id).toBe(before.user_id);
      expect(after.name).toBe(before.name);
      expect(JSON.parse(after.scopes_json)).toEqual([...input.expectedScopes, "skills:publish"]);
      const audit = store.database.query("SELECT user_id, api_key_id, metadata_json FROM skills_audit_events WHERE target_id = ?").get(input.keyId) as Record<string, string>;
      expect(audit.user_id).toBeNull();
      expect(audit.api_key_id).toBeNull();
      expect(JSON.parse(audit.metadata_json).operator_task_arn).toBe("task-1");
    } finally {
      await store.close();
    }
  });
});
