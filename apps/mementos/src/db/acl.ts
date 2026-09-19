/**
 * Memory Access Control Lists (ACLs).
 *
 * Fine-grained permissions beyond scopes: read-only, read-write, admin
 * per agent per key pattern.
 *
 * The historical local default was "no ACLs for this agent = full access",
 * which is only safe when the whole rule set lives where the decision is taken.
 * A rule written on one station bound nothing anywhere else, and every OTHER
 * station — seeing an empty local table — granted full access to exactly the
 * key the operator had just restricted. That is configuration exposed as
 * authorization without being enforced.
 *
 * Two things fix it, and both live here:
 *
 *   1. The DECISION is computed where the whole rule set lives, and is exposed
 *      as its own hosted endpoint (`GET /v1/acl/check`) so a client never has
 *      to re-derive it (and can never re-derive it from a partial rule set).
 *   2. {@link evaluatePermission} returns an explicit `policy_state` instead of
 *      a bare boolean, so "this agent has no rules at all" is a NAMED state the
 *      server enforcement boundary can treat as deny-by-default rather than as
 *      an accidental grant. {@link checkPermission} keeps its boolean shape for
 *      the local callers that predate enforcement.
 */

import { SqliteAdapter as Database } from "../storage.js";
import { getDatabase, uuid } from "./database.js";
import { isApiMode, apiJson, toQuery } from "./api-mode.js";

export type AclPermission = "read" | "readwrite" | "admin";

export interface MemoryAcl {
  id: string;
  agent_id: string;
  key_pattern: string;
  permission: AclPermission;
  project_id: string | null;
  created_at: string;
}

/**
 * The named outcome of an authorization decision. `unconfigured` is distinct
 * from `denied_no_match`: one means the agent has no policy at all, the other
 * means a policy exists and this key is not covered by it.
 */
export type AclPolicyState =
  | "granted"
  | "denied_no_match"
  | "denied_insufficient"
  | "unconfigured";

export interface AclDecision {
  allowed: boolean;
  policy_state: AclPolicyState;
  /** The rule pattern that produced the decision, when one matched. */
  matched_pattern: string | null;
  /** The permission level the matching rule granted, when one matched. */
  granted_permission: AclPermission | null;
}

const PERM_LEVEL: Record<AclPermission, number> = { read: 1, readwrite: 2, admin: 3 };
const REQUIRED_LEVEL: Record<"read" | "write", number> = { read: 1, write: 2 };

/**
 * Set an ACL rule. Upserts by agent_id + key_pattern.
 */
export function setAcl(
  agentId: string,
  keyPattern: string,
  permission: AclPermission,
  projectId?: string,
  db?: Database
): MemoryAcl {
  if (!db && isApiMode()) {
    const { data } = apiJson<MemoryAcl>("POST", "/acl", {
      agent_id: agentId,
      key_pattern: keyPattern,
      permission,
      project_id: projectId,
    });
    return data;
  }
  const d = db || getDatabase();
  // Need unique index for upsert — create before INSERT
  try {
    d.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_acl_agent_pattern ON memory_acl(agent_id, key_pattern)");
  } catch { /* already exists */ }
  const id = uuid();
  d.run(
    `INSERT INTO memory_acl (id, agent_id, key_pattern, permission, project_id)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(agent_id, key_pattern) DO UPDATE SET permission=excluded.permission`,
    [id, agentId, keyPattern, permission, projectId || null]
  );

  return { id, agent_id: agentId, key_pattern: keyPattern, permission, project_id: projectId || null, created_at: new Date().toISOString() };
}

/**
 * List ACLs for an agent.
 */
export function listAcls(agentId: string, db?: Database): MemoryAcl[] {
  if (!db && isApiMode()) {
    const { data } = apiJson<{ acls: MemoryAcl[] }>("GET", `/acl${toQuery({ agent_id: agentId })}`);
    return data?.acls ?? [];
  }
  const d = db || getDatabase();
  return d.query("SELECT * FROM memory_acl WHERE agent_id = ? ORDER BY key_pattern").all(agentId) as MemoryAcl[];
}

/**
 * Remove an ACL rule. Returns false for an unknown id.
 */
export function removeAcl(id: string, db?: Database): boolean {
  if (!db && isApiMode()) {
    const { status, data } = apiJson<{ deleted: boolean }>(
      "DELETE",
      `/acl/${encodeURIComponent(id)}`,
      undefined,
      { allow404: true },
    );
    if (status === 404) return false;
    // A 2xx that does not carry `deleted: true` is a malformed success: read it
    // as a refusal, never as "the rule was removed".
    if (data?.deleted !== true) {
      throw new Error(
        `mementos cloud DELETE /acl/${id} returned a malformed 2xx response (no deleted:true receipt)`,
      );
    }
    return true;
  }
  const d = db || getDatabase();
  const result = d.run("DELETE FROM memory_acl WHERE id = ?", [id]);
  return result.changes > 0;
}

/**
 * Compute the authorization decision for one (agent, key, permission), naming
 * the policy state that produced it.
 *
 * `unconfigured` (no rules at all for this agent) is deliberately NOT folded
 * into `allowed: true`: the caller decides what an unconfigured policy means.
 * The hosted enforcement boundary treats it as deny-by-default; the legacy
 * boolean wrapper below keeps the historical full-access result.
 */
export function evaluatePermission(
  agentId: string,
  memoryKey: string,
  requiredPermission: "read" | "write",
  db?: Database
): AclDecision {
  const d = db || getDatabase();

  const aclCount = (d.query("SELECT COUNT(*) as c FROM memory_acl WHERE agent_id = ?").get(agentId) as { c: number }).c;
  if (aclCount === 0) {
    return { allowed: false, policy_state: "unconfigured", matched_pattern: null, granted_permission: null };
  }

  // Glob match: `*` -> `%`, `?` -> `_`, matched with LIKE against the key.
  const matches = d.query(
    "SELECT key_pattern, permission FROM memory_acl WHERE agent_id = ? AND ? LIKE REPLACE(REPLACE(key_pattern, '*', '%'), '?', '_')"
  ).all(agentId, memoryKey) as { key_pattern: string; permission: AclPermission }[];

  if (matches.length === 0) {
    return { allowed: false, policy_state: "denied_no_match", matched_pattern: null, granted_permission: null };
  }

  const requiredLevel = REQUIRED_LEVEL[requiredPermission];
  const granting = matches.find((m) => PERM_LEVEL[m.permission] >= requiredLevel);
  if (!granting) {
    // A rule matched but grants less than required (e.g. a `read` rule asked
    // for `write`). Report the strongest matching rule so the refusal names why.
    const strongest = matches.reduce((best, m) =>
      PERM_LEVEL[m.permission] > PERM_LEVEL[best.permission] ? m : best
    );
    return {
      allowed: false,
      policy_state: "denied_insufficient",
      matched_pattern: strongest.key_pattern,
      granted_permission: strongest.permission,
    };
  }

  return {
    allowed: true,
    policy_state: "granted",
    matched_pattern: granting.key_pattern,
    granted_permission: granting.permission,
  };
}

/**
 * Boolean authorization check for local callers.
 *
 * Keeps the historical local semantics (no rules = full access) so existing
 * in-process callers and tests are unchanged. The hosted enforcement boundary
 * uses {@link evaluatePermission} instead, because it must distinguish
 * "unconfigured" from "configured and granted".
 */
export function checkPermission(
  agentId: string,
  memoryKey: string,
  requiredPermission: "read" | "write",
  db?: Database
): boolean {
  if (!db && isApiMode()) {
    // The DECISION is taken server-side. A client must not re-derive it from a
    // rule list it may only partly hold: the "no ACLs = full access" default
    // would turn an unreadable rule set into a grant.
    const { data } = apiJson<{ allowed: boolean }>(
      "GET",
      `/acl/check${toQuery({ agent_id: agentId, key: memoryKey, permission: requiredPermission })}`,
    );
    return data?.allowed === true;
  }

  const decision = evaluatePermission(agentId, memoryKey, requiredPermission, db);
  if (decision.policy_state === "unconfigured") return true; // backward compat
  return decision.allowed;
}
