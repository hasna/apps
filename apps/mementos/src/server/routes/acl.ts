// Memory ACL routes.
//
// ACLs are an authorization surface, and they had no hosted route: `setAcl`
// and `listAcls` wrote a per-station SQLite table. A rule set on one machine
// bound nothing anywhere else, and `checkPermission`'s "no ACLs for this agent
// = full access" default meant every OTHER machine silently granted full
// access to a key the operator had just restricted.

import { setAcl, listAcls, removeAcl, checkPermission, type AclPermission } from "../../db/acl.js";
import { addRoute } from "../router.js";
import { json, errorResponse, readJson } from "../helpers.js";

const PERMISSIONS: readonly AclPermission[] = ["read", "readwrite", "admin"];

// POST /api/acl — set (upsert by agent_id + key_pattern)
addRoute("POST", "/api/acl", async (req) => {
  const body = ((await readJson(req)) ?? {}) as Record<string, unknown>;
  const agentId = body["agent_id"];
  const keyPattern = body["key_pattern"];
  const permission = body["permission"];
  if (typeof agentId !== "string" || !agentId.trim()) return errorResponse("agent_id is required", 400);
  if (typeof keyPattern !== "string" || !keyPattern.trim()) return errorResponse("key_pattern is required", 400);
  if (typeof permission !== "string" || !PERMISSIONS.includes(permission as AclPermission)) {
    return errorResponse(`permission must be one of ${PERMISSIONS.join(", ")}`, 400);
  }
  const projectId = typeof body["project_id"] === "string" ? (body["project_id"] as string) : undefined;
  return json(setAcl(agentId, keyPattern, permission as AclPermission, projectId), 201);
});

// GET /api/acl?agent_id= — an agent's rules
addRoute("GET", "/api/acl", (_req, url) => {
  const agentId = url.searchParams.get("agent_id");
  if (!agentId) return errorResponse("agent_id is required", 400);
  const acls = listAcls(agentId);
  return json({ acls, count: acls.length });
});

// GET /api/acl/check — the authorization decision itself, so a client never
// has to re-implement the glob match (and never has to decide on a partial
// rule set it could not read).
addRoute("GET", "/api/acl/check", (_req, url) => {
  const agentId = url.searchParams.get("agent_id");
  const key = url.searchParams.get("key");
  const permission = url.searchParams.get("permission") ?? "read";
  if (!agentId) return errorResponse("agent_id is required", 400);
  if (!key) return errorResponse("key is required", 400);
  if (permission !== "read" && permission !== "write") {
    return errorResponse("permission must be read or write", 400);
  }
  return json({ allowed: checkPermission(agentId, key, permission) });
});

// DELETE /api/acl/:id — remove one rule
addRoute("DELETE", "/api/acl/:id", (_req, _url, params) => {
  const removed = removeAcl(params["id"]!);
  if (!removed) return errorResponse(`ACL not found: ${params["id"]}`, 404);
  return json({ deleted: true });
});
