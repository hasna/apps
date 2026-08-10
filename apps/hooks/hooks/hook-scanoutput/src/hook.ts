#!/usr/bin/env bun

/**
 * Claude Code Hook: scanoutput
 *
 * PostToolUse hook that scans tool output for credential shapes and WARNS.
 *
 * THIS IS DETECTION, NOT PREVENTION, AND THE DISTINCTION IS THE WHOLE DESIGN.
 *
 * PostToolUse fires after the tool has run and after its result exists. Measured
 * across the 48-hook catalog at @hasna/hooks 0.5.0: no output-rewriting field
 * exists on any event — `continue`, `decision`, `hookSpecificOutput`,
 * `additionalContext`, `suppressOutput` and `permissionDecision` are the whole
 * surface, and `suppressOutput` hides THE HOOK'S OWN stdout rather than the
 * tool's. So by the time this hook can see a credential, that credential is
 * already in the transcript. This hook cannot and does not stop that.
 *
 * It is worth running anyway because today nothing notices at all: a credential
 * emitted by a third-party tool into ordinary output is indistinguishable from
 * ordinary output until a human happens to look. This converts a silent
 * exposure into a recorded one with a named blast radius, which is what the
 * incident duty needs and currently cannot get.
 *
 * Do not describe it as prevention anywhere — in docs, help text, commit
 * messages or channel posts. A guard advertised as preventing a leak it only
 * reports afterwards retires the worry without retiring the exposure, and that
 * is worse than no guard.
 *
 * It never blocks. Every path answers `{ continue: true }`, including its own
 * failures, following the fail-open idiom the catalog already uses.
 */

import { readFileSync } from "fs";

/** The scanner surface this hook uses: `scanInputExposures` from @hasna/secrets. */
export type ScanFn = (options: { text?: string; maxBytes?: number }) => {
  schema: string;
  version: number;
  source: string;
  root: string;
  redacted: true;
  limits: { findings: number; maxFileBytes?: number; timeoutMs?: number };
  stats: {
    filesScanned: number;
    filesSkipped: number;
    bytesScanned: number;
    errors: string[];
    skipped?: { path: string; reason: string; bytes?: number }[];
  };
  truncated: boolean;
  truncatedReason?: string;
  findings: {
    id: string;
    detector: string;
    severity: string;
    path: string;
    line: number;
    column: number;
    /** Already redacted by the scanner — the value never appears here. */
    preview: string;
    evidencePath: string;
  }[];
};

export interface HookInput {
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: Record<string, unknown> | string;
}

export interface HookOutput {
  continue: true;
}

export interface ScanOutcome {
  /**
   * `unscanned` exists so that "I looked at all of it and it was clean" and "I
   * could not look" do not share an answer. A guard that reports those
   * identically is the defect this hook was built to notice, committed inside
   * the hook itself.
   */
  status: "clean" | "found" | "unscanned" | "empty" | "error";
  findingCount: number;
  detectors: string[];
  previews: string[];
  bytesScanned?: number;
  reason?: string;
  error?: string;
}

/** Ceiling on what we hand the scanner. Above it the outcome is `unscanned`, never `clean`. */
export const MAX_SCAN_BYTES = 4_000_000;

const OUTPUT_FIELDS = ["stdout", "stderr", "output", "content", "text", "error", "result"] as const;

/** Pull the text out of a tool result, whether it arrived as a string or a record. */
export function extractToolOutputText(input: HookInput): string {
  const output = input.tool_output;
  if (output === undefined || output === null) return "";
  if (typeof output === "string") return output;
  if (typeof output !== "object") return String(output);

  const parts: string[] = [];
  for (const field of OUTPUT_FIELDS) {
    const value = (output as Record<string, unknown>)[field];
    if (typeof value === "string" && value.length > 0) parts.push(value);
  }
  // Nothing recognised but the record is non-empty: scan its serialised form rather
  // than silently skipping an output shape this list does not know about.
  if (parts.length === 0) {
    try {
      const serialised = JSON.stringify(output);
      if (serialised && serialised !== "{}") return serialised;
    } catch {
      return "";
    }
    return "";
  }
  return parts.join("\n");
}

/**
 * Scan the text and classify the result.
 *
 * `scan` is injected so the hook's own behaviour is testable without the
 * scanner, and so a missing or broken @hasna/secrets degrades to `error` and a
 * warning rather than taking the session down with it.
 */
export function analyzeToolOutput(text: string, scan: ScanFn): ScanOutcome {
  if (!text || text.length === 0) {
    return { status: "empty", findingCount: 0, detectors: [], previews: [] };
  }

  let result: ReturnType<ScanFn>;
  try {
    result = scan({ text, maxBytes: MAX_SCAN_BYTES });
  } catch (err) {
    return {
      status: "error",
      findingCount: 0,
      detectors: [],
      previews: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const findings = result?.findings ?? [];
  if (findings.length > 0) {
    return {
      status: "found",
      findingCount: findings.length,
      detectors: [...new Set(findings.map((f) => f.detector))],
      previews: findings.slice(0, 5).map((f) => `${f.evidencePath} ${f.detector}/${f.severity} ${f.preview}`),
      bytesScanned: result.stats?.bytesScanned,
    };
  }

  // No findings is only good news if the whole input was actually read.
  const stats = result?.stats;
  const skipped = stats?.skipped?.length ?? 0;
  const errors = stats?.errors?.length ?? 0;
  const bytes = stats?.bytesScanned ?? 0;
  if (result?.truncated || skipped > 0 || errors > 0 || bytes <= 0) {
    const reason =
      result?.truncatedReason ??
      stats?.skipped?.[0]?.reason ??
      stats?.errors?.[0] ??
      (bytes <= 0 ? "zero bytes scanned" : "incomplete scan");
    return { status: "unscanned", findingCount: 0, detectors: [], previews: [], bytesScanned: bytes, reason };
  }

  return { status: "clean", findingCount: 0, detectors: [], previews: [], bytesScanned: bytes };
}

/** The stderr line(s) a human or agent actually reads. Empty string means stay silent. */
export function formatWarning(outcome: ScanOutcome): string {
  if (outcome.status === "clean" || outcome.status === "empty") return "";

  if (outcome.status === "error") {
    return `[scanoutput] could not scan this tool output: ${outcome.error ?? "unknown error"} — treat it as UNSCANNED, not clean.`;
  }

  if (outcome.status === "unscanned") {
    return `[scanoutput] UNSCANNED tool output (${outcome.reason ?? "incomplete"}) — no finding here is not evidence of no credential.`;
  }

  const lines = [
    `[scanoutput] ${outcome.findingCount} credential shape(s) in tool output ` +
      `[${outcome.detectors.join(", ")}] — this output is ALREADY in the transcript; ` +
      `this hook reports it and cannot remove it.`,
    ...outcome.previews.map((p) => `  ${p}`),
    `  Record it to the incidents channel by NAME and SCOPE only, never the value, then continue.`,
  ];
  return lines.join("\n");
}

export function buildHookOutput(_outcome: ScanOutcome): HookOutput {
  // Unconditional. A guard that fails closed on its own bug gets uninstalled.
  return { continue: true };
}

function readStdinJson(): HookInput | null {
  try {
    const raw = readFileSync(0, "utf-8").trim();
    if (!raw) return null;
    return JSON.parse(raw) as HookInput;
  } catch {
    return null;
  }
}

/**
 * Resolve the real scanner. Imported lazily and in-process: a CLI spawn costs a
 * fixed ~1.3-1.8s on this fleet regardless of payload, while the in-process call
 * is ~25ms of import plus ~2ms for 11 KB and ~80ms for 2.2 MB (measured
 * 2026-08-10, station01). The spawn is the dominant term and is avoidable.
 */
async function loadScanner(): Promise<ScanFn> {
  const mod = (await import("@hasna/secrets/scanner")) as unknown as { scanInputExposures: ScanFn };
  if (typeof mod?.scanInputExposures !== "function") {
    throw new Error("@hasna/secrets/scanner does not export scanInputExposures");
  }
  return mod.scanInputExposures;
}

function respond(output: HookOutput): void {
  console.log(JSON.stringify(output));
}

function warn(message: string): void {
  if (message) console.error(message);
}

export async function run(): Promise<void> {
  try {
    const input = readStdinJson();
    if (!input) {
      respond({ continue: true });
      return;
    }

    const text = extractToolOutputText(input);
    if (!text) {
      respond({ continue: true });
      return;
    }

    let scan: ScanFn;
    try {
      scan = await loadScanner();
    } catch (err) {
      warn(
        `[scanoutput] could not scan this tool output: ${
          err instanceof Error ? err.message : String(err)
        } — treat it as UNSCANNED, not clean.`,
      );
      respond({ continue: true });
      return;
    }

    const outcome = analyzeToolOutput(text, scan);
    warn(formatWarning(outcome));
    respond(buildHookOutput(outcome));
  } catch (err) {
    // Nothing this hook does may end a session.
    warn(`[scanoutput] hook failed: ${err instanceof Error ? err.message : String(err)}`);
    respond({ continue: true });
  }
}

if (import.meta.main) {
  void run();
}
