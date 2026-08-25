/**
 * Lane adapter registry (slice E) — the four lanes exactly per owner
 * 2026-08-25: claude (@anthropic-ai/claude-agent-sdk), codex
 * (@openai/codex-sdk), cursor (@cursor/sdk, local mode), grok (xAI Grok SDK
 * — no npm package exists, measured; local CLI substrate).
 *
 * The registry exposes a wired-vs-not-ready-with-reason shape: laneInventory()
 * and probeLane() re-run each adapter's maturity check on THIS machine and
 * report whether a usable substrate exists (SDK importable or CLI on PATH)
 * and, when not, exactly why. `wired` is about substrate presence — a live
 * authenticated call is the workflow's live-verify gate, not a probe.
 */
import { createClaudeAdapter } from "./claude.js";
import { createCodexAdapter } from "./codex.js";
import { createCursorAdapter } from "./cursor.js";
import { createGrokAdapter } from "./grok.js";
import {
  LANE_KINDS,
  type LaneAdapter,
  type LaneJob,
  type LaneProbe,
  type LaneResult,
  type LaneKind,
} from "./types.js";

export type { LaneAdapter, LaneJob, LaneProbe, LaneResult, LaneKind } from "./types.js";
export { LANE_KINDS, LaneDependencyMissingError, LaneAdapterShapeError, binaryOnPath } from "./types.js";
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

/** Re-run one lane's maturity check and report wired / not-ready-with-reason. */
export async function probeLane(kind: LaneKind): Promise<LaneProbe> {
  return resolveLane(kind).probe();
}

/** Probe all four lanes and return the wired-vs-not-ready registry shape. */
export async function laneInventory(): Promise<LaneProbe[]> {
  return Promise.all(LANE_KINDS.map((kind) => probeLane(kind)));
}
