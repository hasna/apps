import { customerOps } from "./customers.js";
import { subscriptionOps } from "./subscriptions.js";
import { invoiceOps } from "./invoices.js";
import { dunningOps } from "./dunning.js";
import { eventOps } from "./events.js";
import type { ServiceOp, ToolProfile } from "./context.js";

/**
 * The single service registry. CLI namespaces, MCP domain tools, /v1 routes,
 * the OpenAPI document, and the interface-parity op table are all GENERATED
 * from this list (BUILD-SPEC §7). Adding a capability here surfaces it on all
 * three transports at once — parity by construction.
 */
export const ALL_OPS: ServiceOp[] = [
  ...customerOps,
  ...subscriptionOps,
  ...invoiceOps,
  ...dunningOps,
  ...eventOps,
];

const OP_INDEX: Map<string, ServiceOp> = new Map(ALL_OPS.map((op) => [op.op, op]));

export function getOp(name: string): ServiceOp | undefined {
  return OP_INDEX.get(name);
}

export function opsForProfile(profile: ToolProfile): ServiceOp[] {
  return ALL_OPS.filter((op) => op.profiles.includes(profile));
}

export function opsByResource(): Map<string, ServiceOp[]> {
  const grouped = new Map<string, ServiceOp[]>();
  for (const op of ALL_OPS) {
    const list = grouped.get(op.resource) ?? [];
    list.push(op);
    grouped.set(op.resource, list);
  }
  return grouped;
}

/** Manifest consumed by the generated interface-parity test (BUILD-SPEC §7/§10.2). */
export interface OpManifestEntry {
  op: string;
  resource: string;
  action: string;
  scopes: string[];
  mutates: boolean;
  method: string;
  path: string;
  surfaces: ("cli" | "mcp" | "http")[];
}

export function opManifest(): OpManifestEntry[] {
  return ALL_OPS.map((op) => ({
    op: op.op,
    resource: op.resource,
    action: op.action,
    scopes: op.scopes,
    mutates: op.mutates,
    method: op.method,
    path: op.path,
    // Every op is exposed on all three surfaces by construction.
    surfaces: ["cli", "mcp", "http"],
  }));
}
