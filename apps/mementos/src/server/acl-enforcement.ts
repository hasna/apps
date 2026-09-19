/**
 * Server-side ACL enforcement for the authoritative memory boundaries.
 *
 * The closed predecessor of this change exposed ACL *configuration*
 * (`POST/GET/DELETE /v1/acl`) but never enforced it: `checkPermission` was
 * referenced only by its own definition and tests. An operator could restrict a
 * key and every read or write of it still succeeded. Configuration that is not
 * enforced is not authorization, so this module is the part that matters.
 *
 * Design:
 *
 *  - The SUBJECT of a policy is the agent on the VERIFIED principal (the API
 *    key's `agent` claim). It is never read from the request body or a header:
 *    a direct HTTP caller must not be able to choose which policy applies by
 *    naming a different agent, which is exactly how the old local design let a
 *    restriction bind nothing.
 *  - A request whose key carries no `agent` claim has no ACL subject. That is a
 *    named, explicit state (`unconfigured subject`), not a silent grant: no
 *    policy exists to evaluate, so the boundary is inert for that caller. It is
 *    tested and reported rather than assumed.
 *  - Once a subject is known and has at least one rule, the decision is
 *    deny-by-default: a key with no matching rule, or a matching rule with
 *    insufficient permission, is refused with a diagnosable 403.
 *  - `evaluatePermission`'s `unconfigured` state (the agent has NO rules at
 *    all) keeps the historical full-access result, now as an explicitly tested
 *    policy state rather than an accidental fall-through.
 */

import { evaluatePermission, listAcls, type AclDecision } from "../db/acl.js";
import { getDatabase } from "../db/database.js";
import { getAuthenticatedAgent } from "./auth.js";
import { errorResponse } from "./helpers.js";
import type { Memory } from "../types/index.js";

/**
 * The agent whose policy governs this request, or `null` when the verified key
 * names no agent. `/v1` request bodies are untrusted for this purpose.
 */
export function aclSubject(req: Request): string | null {
  return getAuthenticatedAgent(req);
}

/**
 * Refuse a read or write of `memoryKey` when the caller's agent policy denies
 * it. Returns an error `Response` to reject, or `null` to allow.
 *
 * `null` (allowed) covers three distinct cases, all intentional:
 *  - no subject on the key (nothing to enforce),
 *  - the subject has no policy at all (documented compatibility default),
 *  - a policy exists and grants the requested permission.
 */
export function enforceMemoryAcl(
  req: Request,
  memoryKey: string | null | undefined,
  permission: "read" | "write",
): Response | null {
  const subject = aclSubject(req);
  if (!subject || !memoryKey) return null;

  const decision = evaluatePermission(subject, memoryKey, permission, getDatabase());
  if (decision.policy_state === "granted" || decision.policy_state === "unconfigured") {
    return null;
  }

  return errorResponse(
    `Memory access denied by the ACL for agent "${subject}": ${describeDenial(decision, permission)}`,
    403,
    {
      code: "MEMORY_ACL_DENIED",
      agent_id: subject,
      key: memoryKey,
      required_permission: permission,
      policy_state: decision.policy_state,
      matched_pattern: decision.matched_pattern,
      granted_permission: decision.granted_permission,
    },
  );
}

/**
 * The keys the caller may not read, as a predicate. Loads the subject's rules
 * once so a collection boundary does not issue one query per row.
 */
export function readableMemoryFilter(req: Request): (memory: Pick<Memory, "key">) => boolean {
  const subject = aclSubject(req);
  if (!subject) return () => true;

  const rules = listAcls(subject, getDatabase());
  if (rules.length === 0) return () => true; // unconfigured subject: documented default

  // Delegate the glob semantics to the single decision engine so a collection
  // boundary and a single-key boundary can never disagree.
  return (memory) =>
    evaluatePermission(subject, memory.key, "read", getDatabase()).allowed;
}

/** Keep a collection result to the rows the caller is permitted to read. */
export function filterReadable<T extends { key: string }>(req: Request, memories: T[]): T[] {
  const subject = aclSubject(req);
  if (!subject) return memories;
  const rules = listAcls(subject, getDatabase());
  if (rules.length === 0) return memories;
  return memories.filter((m) => evaluatePermission(subject, m.key, "read", getDatabase()).allowed);
}

function describeDenial(decision: AclDecision, permission: "read" | "write"): string {
  if (decision.policy_state === "denied_insufficient") {
    return `the matching rule "${decision.matched_pattern}" grants "${decision.granted_permission}", which is not enough for "${permission}"`;
  }
  return "no rule matches this key";
}
