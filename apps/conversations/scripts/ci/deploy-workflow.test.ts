import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workflow = readFileSync(join(import.meta.dir, "..", "..", ".github", "workflows", "deploy.yml"), "utf8");

describe("production deploy workflow gates", () => {
  test("pins every privileged third-party action to an immutable commit", () => {
    const actionRefs = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1]);
    expect(actionRefs).not.toHaveLength(0);
    for (const actionRef of actionRefs) expect(actionRef).toMatch(/@[0-9a-f]{40}$/);
  });

  test("binds every trigger to reviewed main before requesting AWS credentials", () => {
    const ancestryGate = workflow.indexOf("git merge-base --is-ancestor");
    const credentialStep = workflow.indexOf("Configure AWS credentials (GitHub OIDC)");
    expect(ancestryGate).toBeGreaterThan(0);
    expect(credentialStep).toBeGreaterThan(ancestryGate);
    expect(workflow).toContain("refs/remotes/origin/main");
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow.slice(workflow.lastIndexOf("- name:", ancestryGate), ancestryGate)).not.toContain("if:");
  });

  test("keeps rollout convergence bounded and verifies the exact live task definition", () => {
    expect(workflow).toContain("ECS_ROLLOUT_MAX_ATTEMPTS:-30");
    expect(workflow).toContain("for ((i=1; i<=MAX_ROLLOUT_POLLS; i++))");
    expect(workflow).toContain('if [ "$LIVE_TD" != "$WEB_ARN" ]; then');
    expect(workflow).toContain('if [ "$i" -eq "$MAX_ROLLOUT_POLLS" ]; then');
  });
});
