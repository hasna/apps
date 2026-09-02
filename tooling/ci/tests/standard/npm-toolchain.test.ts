import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// npm 10's bundled pacote runs prepare even with --ignore-scripts. Every
// independent CI job needs the same tested npm before builds, scans or tests.
const root = resolve(import.meta.dir, "../../../..");
const ci = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
const jobNames = ["gates", "test-suites", "build-test", "verify-generated", "publish-guard"];
const provision = 'set -euo pipefail\nnpm install --global npm@11.19.0 --ignore-scripts\ntest "$(npm --version)" = "11.19.0"';
type Step = { name?: string; uses?: string; run?: string; with?: Record<string, string | number>; if?: unknown; "continue-on-error"?: unknown };
type Workflow = { jobs: Record<string, { steps: Step[] }> };

function violations(source: string): string[] {
  const workflow = Bun.YAML.parse(source) as Workflow;
  const problems: string[] = [];
  for (const name of jobNames) {
    const steps = workflow.jobs[name]?.steps ?? [];
    const npmIndex = steps.findIndex((step) => step.name === "Install npm for artifact gates");
    const installIndex = steps.findIndex((step) => step.name === "Install");
    const npmStep = steps[npmIndex];
    if (npmIndex < 0 || npmIndex >= installIndex || npmStep?.run?.trim() !== provision || npmStep.if !== undefined || npmStep["continue-on-error"] !== undefined) {
      problems.push(`${name}: require the unconditional pinned npm install and exact version check before Install`);
    }
  }
  return problems;
}

describe("standard-adherence: npm artifact toolchain", () => {
  test("all five independent CI jobs pin and verify npm before package work", () => {
    expect(Object.keys((Bun.YAML.parse(ci) as Workflow).jobs)).toEqual(jobNames);
    expect(violations(ci)).toEqual([]);
  });

  test("the toolchain gate detects missing, wrong, unverified, late, or bypassable installs", () => {
    expect(violations(ci.replaceAll("Install npm for artifact gates", "Missing npm pin"))).toHaveLength(5);
    expect(violations(ci.replaceAll("npm@11.19.0", "npm@10.9.8"))).toHaveLength(5);
    expect(violations(ci.replaceAll('test "$(npm --version)" = "11.19.0"', "npm --version"))).toHaveLength(5);
    expect(violations(ci.replaceAll("- name: Install npm for artifact gates", "- name: Install\n        run: bun install\n\n      - name: Install npm for artifact gates"))).toHaveLength(5);
    expect(violations(ci.replaceAll("- name: Install npm for artifact gates", "- name: Install npm for artifact gates\n        if: false"))).toHaveLength(5);
    expect(violations(ci.replaceAll("- name: Install npm for artifact gates", "- name: Install npm for artifact gates\n        continue-on-error: true"))).toHaveLength(5);
  });

  test("Bun, frozen-lockfile and ordered prepare gates remain in every job", () => {
    for (const { steps } of Object.values((Bun.YAML.parse(ci) as Workflow).jobs)) {
      const bun = steps.find((step) => step.uses?.startsWith("oven-sh/setup-bun@"));
      expect(bun?.with?.["bun-version"]).toBe("1.3.14");
      const install = steps.find((step) => step.name === "Install");
      expect(install?.run).toContain("bun install --frozen-lockfile --ignore-scripts");
      expect(install?.run).toContain("bun run prepare:ordered");
    }
  });

  test("the release-tool prerequisite does not restrict Paths consumers", () => {
    const manifest = JSON.parse(readFileSync(resolve(root, "apps/paths/package.json"), "utf8"));
    expect(manifest.engines.npm).toBeUndefined();
  });
});
