/**
 * Lane adapter registry (slice E) — the four lanes exactly per owner
 * 2026-08-25: claude (@anthropic-ai/claude-agent-sdk), codex
 * (@openai/codex-sdk), cursor (@cursor/sdk, local mode), grok (xAI Grok SDK
 * — no npm package exists, measured; local CLI substrate).
 */
import { createClaudeAdapter } from "./claude.js";
import { createCodexAdapter } from "./codex.js";
import { createCursorAdapter } from "./cursor.js";
import { createGrokAdapter } from "./grok.js";
import { LANE_KINDS, type LaneAdapter, type LaneJob, type LaneResult, type LaneKind } from "./types.js";

export type { LaneAdapter, LaneJob, LaneResult, LaneKind } from "./types.js";
export { LANE_KINDS, LaneDependencyMissingError, LaneAdapterShapeError } from "./types.js";
export { createClaudeAdapter } from "./claude.js";
export { createCodexAdapter } from "./codex.js";
export { createCursorAdapter } from "./cursor.js";
export { createGrokAdapter } from "./grok.js";

const adapters = new Map<LaneKind, LaneAdapter>([
  ["claude", createClaudeAdapter()],
  ["codex", createCodexAdapter()],
  ["cursor", createCursorAdapter()],
  ["grok", createGrokAdapter()],
]);

export function resolveLane(kind: LaneKind): LaneAdapter {
  const adapter = adapters.get(kind);
  if (!adapter) throw new Error(`unknown lane ${kind} (expected one of ${LANE_KINDS.join(", ")})`);
  return adapter;
}

/** Run one lane job through the registry (used by the daemon's default runner). */
export async function runLaneJob(job: LaneJob): Promise<LaneResult> {
  return resolveLane(job.lane).run(job);
}

/** List the four lanes with their substrate availability. */
export function laneInventory(): { kind: LaneKind; sdk: string; substrate: string }[] {
  return [
    { kind: "claude", sdk: "@anthropic-ai/claude-agent-sdk", substrate: "sdk or claude CLI" },
    { kind: "codex", sdk: "@openai/codex-sdk", substrate: "sdk or codex CLI" },
    { kind: "cursor", sdk: "@cursor/sdk", substrate: "sdk (local mode) or cursor-agent CLI" },
    { kind: "grok", sdk: "no npm SDK (measured 2026-08-25)", substrate: "grok CLI" },
  ];
}
