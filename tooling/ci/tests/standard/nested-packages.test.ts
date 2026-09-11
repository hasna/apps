/**
 * nested-packages — standard-adherence suite, fleet-alignment gate.
 *
 * One npm package per app (`rules/package-surfaces.md`): no package.json
 * below a member root may declare a publishable `@hasna/*` name. The rule,
 * the two recorded plugin-catalog families and the measurement live in
 * tooling/ci/nested-packages.ts, shared with the check-nested-packages.ts
 * gate script.
 *
 * MODE: report-only at landing (GATE_MODES in gate-mode.ts). Measured
 * violations 2026-09-11: apps/connectors/sdk (@hasna/connectors-sdk — the
 * one PUBLISHED split, 0.1.6), apps/todos/sdk (@hasna/todos-sdk),
 * apps/todos/ai (@hasna/todos-ai), and two connector catalog entries whose
 * name doubles the `connect-` prefix. Owners: connectors lane, W6 (todos).
 * Flip to hard (and drop `--report` from the ci.yml gate step) when this
 * report prints 0.
 */
import { describe, expect, test } from "bun:test";
import { REPO_ROOT } from "./census";
import { assertGate } from "./gate-mode";
import { NESTED_FAMILIES, formatViolation, nestedPackageViolations, staleFamilies } from "../../nested-packages";

export const GATE = "nested-packages";

describe("standard-adherence: nested packages (one package per app)", () => {
  test("no nested package.json declares a publishable @hasna/* name outside the recorded catalog families", () => {
    const violations = nestedPackageViolations(REPO_ROOT).map(formatViolation);
    assertGate(GATE, violations, "fold the split package into the member (./sdk export, -mcp bin) or mark it private:true; catalog entries must match their directory name");
  }, 60_000);

  test("family hygiene: every recorded catalog family still matches at least one manifest (no rot)", () => {
    expect(staleFamilies(REPO_ROOT).map((f) => `${f.member} ${f.file}`)).toEqual([]);
    expect(NESTED_FAMILIES.length).toBeGreaterThan(0);
  });

  test("self-test: the gate script's own two-sided self-test passes", () => {
    const res = Bun.spawnSync([process.execPath, `${REPO_ROOT}/tooling/ci/check-nested-packages.ts`, "--self-test"], { stdout: "pipe", stderr: "pipe" });
    const out = `${res.stdout.toString()}\n${res.stderr.toString()}`;
    expect(res.exitCode, out).toBe(0);
    expect(out).toContain("self-test: PASS");
  }, 60_000);
});
