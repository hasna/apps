/**
 * Gate mode — report-only vs hard, one switch per fleet-alignment gate.
 *
 * A new gate lands in REPORT mode: it measures the tree, prints every
 * violation with a stable `[report <gate>]` prefix, and passes. Once the
 * owners of the reported violations have shipped their fixes (or recorded a
 * deliberate exception), the entry below flips to HARD and the same test
 * refuses. Nothing else changes — the measurement, the fixture self-test and
 * the report shape are identical in both modes, so a flip cannot introduce a
 * new false positive.
 *
 * `HASNA_GATE_MODE_<GATE>=hard|report` overrides the table for a local run
 * (e.g. to preview what a flip would refuse). CI never sets it.
 *
 * Mode changes are deliberate and reviewed: edit GATE_MODES in the PR that
 * flips a gate and say why in the PR body.
 */
import { expect } from "bun:test";

export type GateMode = "report" | "hard";

export const GATE_MODES: Record<string, GateMode> = {
  // hasna/apps fleet-alignment wave 1 (2026-09-11): every gate below lands in
  // report mode so nothing goes red on main; each flips to hard once the
  // reported members are fixed (see the per-gate header for the owner lane).
  "fleet-hostnames": "report",
  "no-mode-vocabulary": "report",
  "client-fail-closed": "report",
  "client-sqlite-isolation": "report",
  "nested-packages": "report",
};

export function gateMode(gate: string): GateMode {
  const envKey = `HASNA_GATE_MODE_${gate.toUpperCase().replace(/-/g, "_")}`;
  const override = process.env[envKey];
  if (override === "hard" || override === "report") return override;
  const configured = GATE_MODES[gate];
  if (!configured) throw new Error(`gate "${gate}" has no GATE_MODES entry — add one before using gateMode()`);
  return configured;
}

/**
 * Assert a gate's violation list according to its mode. In report mode the
 * violations are printed and the test passes; in hard mode the test fails
 * with the full list. Always prints a one-line census so a green run still
 * shows what was measured.
 */
export function assertGate(gate: string, violations: string[], remedy: string): void {
  const mode = gateMode(gate);
  const sorted = [...violations].sort();
  if (sorted.length === 0) {
    console.info(`[${mode === "hard" ? "gate" : "report"} ${gate}] 0 violations`);
    return;
  }
  const body = sorted.map((v) => `  ${v}`).join("\n");
  if (mode === "report") {
    console.info(`[report ${gate}] ${sorted.length} violation(s) (REPORT-ONLY — flips to hard once fixed; ${remedy}):\n${body}`);
    return;
  }
  expect(sorted, `[gate ${gate}] ${sorted.length} violation(s); ${remedy}:\n${body}`).toEqual([]);
}
