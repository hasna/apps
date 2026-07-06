import { opsByResource } from "../services/registry.js";
import type { ServiceOp } from "../services/context.js";

/**
 * CLI namespaces, one per domain resource, generated from the service registry
 * so CLI coverage tracks MCP + /v1 (interface parity, BUILD-SPEC §7).
 */
export interface CliNamespace {
  resource: string;
  ops: ServiceOp[];
}

export function cliNamespaces(): CliNamespace[] {
  const grouped = opsByResource();
  return Array.from(grouped.entries())
    .map(([resource, ops]) => ({ resource, ops }))
    .sort((a, b) => a.resource.localeCompare(b.resource));
}
