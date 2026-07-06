import type { OpDef } from "./op-types.js";
import { glOps } from "./ops/gl.js";
import { platformOps } from "./ops/platform.js";
import { referenceOps } from "./ops/reference.js";
import { runOps } from "./ops/runs.js";

// The op registry: the single source of truth for every domain operation. CLI,
// MCP, and /v1 are all generated/driven from this table (interface parity).
export const OPS: OpDef[] = [...referenceOps, ...glOps, ...runOps, ...platformOps];

const BY_OP = new Map(OPS.map((op) => [op.op, op]));
const BY_MCP_TOOL = new Map(OPS.map((op) => [op.mcpTool, op]));

export function getOp(op: string): OpDef | undefined {
  return BY_OP.get(op);
}

export function getOpByMcpTool(tool: string): OpDef | undefined {
  return BY_MCP_TOOL.get(tool);
}

/** Ops that participate in the generated interface-parity table. */
export function parityOps(): OpDef[] {
  return OPS.filter((op) => op.parity !== false);
}

/** Ops registered for a given MCP profile (full = everything). */
export function opsForProfile(profile: "minimal" | "standard" | "full"): OpDef[] {
  if (profile === "full") return OPS;
  return OPS.filter((op) => op.profiles.includes(profile));
}
