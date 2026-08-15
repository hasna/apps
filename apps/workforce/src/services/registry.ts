import type { AuthorizationAction } from "./authorization.js";

// Single source of truth for the app's operations. CLI namespaces, MCP domain
// tools, /v1 routes, OpenAPI paths, MCP profiles, and the generated
// interface-parity table are all derived from this registry — so a capability
// cannot exist on one surface without the others (interface parity).

export type Profile = "minimal" | "standard" | "full";

export interface OpSurfaces {
  /** CLI command path, space-separated (e.g. "member create"). */
  cli: string;
  /** MCP tool name (e.g. "create_member"). */
  mcp: string;
  /** REST route. */
  api: { method: "GET" | "POST" | "PATCH" | "DELETE"; path: string };
}

export interface OpDef {
  op: string;
  action: AuthorizationAction;
  mutating: boolean;
  profiles: Profile[];
  surfaces: OpSurfaces;
  summary: string;
}

const ALL: Profile[] = ["minimal", "standard", "full"];
const STD: Profile[] = ["standard", "full"];
const FULL: Profile[] = ["full"];

export const OP_REGISTRY: OpDef[] = [
  // members
  { op: "list_members", action: "read", mutating: false, profiles: ALL, summary: "List roster members", surfaces: { cli: "member list", mcp: "list_members", api: { method: "GET", path: "/v1/members" } } },
  { op: "get_member", action: "read", mutating: false, profiles: ALL, summary: "Get a member by id", surfaces: { cli: "member get", mcp: "get_member", api: { method: "GET", path: "/v1/members/:id" } } },
  { op: "create_member", action: "write", mutating: true, profiles: ALL, summary: "Onboard a member (human|contractor|agent)", surfaces: { cli: "member create", mcp: "create_member", api: { method: "POST", path: "/v1/members" } } },
  { op: "update_member", action: "write", mutating: true, profiles: STD, summary: "Update member attributes", surfaces: { cli: "member update", mcp: "update_member", api: { method: "PATCH", path: "/v1/members/:id" } } },
  // capabilities
  { op: "list_capabilities", action: "read", mutating: false, profiles: ALL, summary: "List a member's capabilities", surfaces: { cli: "capability list", mcp: "list_capabilities", api: { method: "GET", path: "/v1/members/:id/capabilities" } } },
  { op: "add_capability", action: "write", mutating: true, profiles: STD, summary: "Add a capability to a member", surfaces: { cli: "capability add", mcp: "add_capability", api: { method: "POST", path: "/v1/members/:id/capabilities" } } },
  { op: "remove_capability", action: "write", mutating: true, profiles: STD, summary: "Remove a capability", surfaces: { cli: "capability remove", mcp: "remove_capability", api: { method: "DELETE", path: "/v1/capabilities/:id" } } },
  // lifecycle
  { op: "list_member_lifecycle", action: "read", mutating: false, profiles: STD, summary: "List a member's lifecycle events", surfaces: { cli: "lifecycle list", mcp: "list_member_lifecycle", api: { method: "GET", path: "/v1/members/:id/lifecycle" } } },
  { op: "record_role_change", action: "lifecycle", mutating: true, profiles: STD, summary: "Record a role change (mover)", surfaces: { cli: "lifecycle role-change", mcp: "record_role_change", api: { method: "POST", path: "/v1/members/:id/role-change" } } },
  { op: "suspend_member", action: "lifecycle", mutating: true, profiles: STD, summary: "Suspend a member", surfaces: { cli: "lifecycle suspend", mcp: "suspend_member", api: { method: "POST", path: "/v1/members/:id/suspend" } } },
  { op: "reactivate_member", action: "lifecycle", mutating: true, profiles: STD, summary: "Reactivate a suspended member", surfaces: { cli: "lifecycle reactivate", mcp: "reactivate_member", api: { method: "POST", path: "/v1/members/:id/reactivate" } } },
  { op: "offboard_member", action: "lifecycle", mutating: true, profiles: STD, summary: "Offboard a member (leaver)", surfaces: { cli: "lifecycle offboard", mcp: "offboard_member", api: { method: "POST", path: "/v1/members/:id/offboard" } } },
  { op: "verify_lifecycle_audit", action: "admin", mutating: false, profiles: FULL, summary: "Verify the tamper-evident lifecycle audit chain", surfaces: { cli: "lifecycle verify", mcp: "verify_lifecycle_audit", api: { method: "GET", path: "/v1/lifecycle/verify" } } },
  // assignments
  { op: "list_assignments", action: "read", mutating: false, profiles: ALL, summary: "List assignments", surfaces: { cli: "assignment list", mcp: "list_assignments", api: { method: "GET", path: "/v1/assignments" } } },
  { op: "get_assignment", action: "read", mutating: false, profiles: STD, summary: "Get an assignment by id", surfaces: { cli: "assignment get", mcp: "get_assignment", api: { method: "GET", path: "/v1/assignments/:id" } } },
  { op: "create_assignment", action: "write", mutating: true, profiles: STD, summary: "Assign a member to an entity/project", surfaces: { cli: "assignment create", mcp: "create_assignment", api: { method: "POST", path: "/v1/assignments" } } },
  { op: "end_assignment", action: "write", mutating: true, profiles: STD, summary: "End an assignment", surfaces: { cli: "assignment end", mcp: "end_assignment", api: { method: "POST", path: "/v1/assignments/:id/end" } } },
  // export
  { op: "export_roster", action: "export", mutating: false, profiles: ALL, summary: "Export the payroll/timesheets roster contract", surfaces: { cli: "export roster", mcp: "export_roster", api: { method: "GET", path: "/v1/exports/roster" } } },
];

export const OP_BY_NAME: Record<string, OpDef> = Object.fromEntries(OP_REGISTRY.map((op) => [op.op, op]));

export function opsForProfile(profile: Profile): OpDef[] {
  return OP_REGISTRY.filter((op) => op.profiles.includes(profile));
}

export function isMcpToolInProfile(toolName: string, profile: Profile): boolean {
  const op = OP_REGISTRY.find((o) => o.surfaces.mcp === toolName);
  return Boolean(op && op.profiles.includes(profile));
}
