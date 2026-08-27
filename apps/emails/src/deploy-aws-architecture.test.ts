import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for O15-04099 — deploy image arch mismatch: the emails
// deploy/aws module defaulted `container_architecture` to "ARM64" while the
// emails-prod Fargate service runs X86_64 (task-def has no runtimePlatform,
// Fargate default X86_64) and the DEPLOYMENT_CUTOVER runbook mandates
// `-var="container_architecture=X86_64"` at every apply and asserts
// `runtimePlatform.cpuArchitecture == "X86_64"` in staged task-def
// verification. A plain `terraform apply` of the module (no explicit var)
// silently registered an ARM64 task-def and invited an arm64 image build —
// the same mismatch class that produced the exec-format-error deploy on the
// X86_64 service (measured 2026-08-27, emails@1.4.10, PASS 19).
//
// The deploy-apps lane now measures the arch from the live task-def
// (O15-04098, #1324), but the module default is the package-side landmine:
// it must agree with the documented and live production architecture so an
// un-var'd apply cannot flip the service architecture.

const variablesTf = readFileSync(
  resolve(import.meta.dir, "../deploy/aws/variables.tf"),
  "utf8",
);
const cutoverRunbook = readFileSync(
  resolve(import.meta.dir, "../docs/DEPLOYMENT_CUTOVER.md"),
  "utf8",
);

describe("deploy/aws container architecture contract", () => {
  test("container_architecture defaults to X86_64, matching the live emails-prod Fargate service", () => {
    // The live emails-prod task-def has no runtimePlatform (Fargate default
    // X86_64) — measured 2026-08-27 via describe-task-definition. The module
    // default must not silently diverge from that.
    const block = variablesTf.slice(
      variablesTf.indexOf('variable "container_architecture"'),
      variablesTf.indexOf('variable "send_provider"'),
    );
    expect(block).toContain('default     = "X86_64"');
    expect(block).toContain(
      'error_message = "container_architecture must be ARM64 or X86_64."',
    );
  });

  test("runbook keeps the explicit X86_64 var at every apply site", () => {
    // The runbook's apply commands pass the arch explicitly; the regression
    // keeps them honest so the default and the runbook cannot drift apart.
    const applySites = [
      ...cutoverRunbook.matchAll(
        /-var="container_architecture=X86_64"/g,
      ),
    ];
    expect(applySites.length).toBeGreaterThanOrEqual(2);
  });

  test("runbook keeps asserting X86_64 in staged task-def verification", () => {
    const archAsserts = [
      ...cutoverRunbook.matchAll(
        /\.taskDefinition\.runtimePlatform\.cpuArchitecture == "X86_64"/g,
      ),
    ];
    expect(archAsserts.length).toBeGreaterThanOrEqual(2);
  });
});
