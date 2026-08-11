import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workflow = readFileSync(join(import.meta.dir, "..", "..", ".github", "workflows", "release.yml"), "utf8");
const packageJson = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

describe("npm release workflow publish contract", () => {
  test("keeps normal package lifecycle validation for manual publishes", () => {
    expect(packageJson.scripts.prepack).toBe("bun run build");
    expect(packageJson.scripts.prepublishOnly).toContain("bun run typecheck");
    expect(packageJson.scripts.prepublishOnly).toContain("bun test");
    expect(packageJson.scripts.prepublishOnly).toContain("bun run contracts:conformance");
    expect(packageJson.scripts.prepublishOnly).toContain("contracts no-cloud-scan .");
  });

  test("runs required release gates before the trusted publish step", () => {
    const typecheckIndex = workflow.indexOf("- name: Typecheck");
    const testIndex = workflow.indexOf("- name: Test");
    const contractsIndex = workflow.indexOf("- name: Contracts conformance");
    const noCloudIndex = workflow.indexOf("- name: No-cloud scan");
    const buildIndex = workflow.indexOf("- name: Build");
    const publishIndex = workflow.indexOf("- name: Publish to npm via OIDC trusted publishing");

    expect(typecheckIndex).toBeGreaterThan(0);
    expect(testIndex).toBeGreaterThan(typecheckIndex);
    expect(contractsIndex).toBeGreaterThan(testIndex);
    expect(noCloudIndex).toBeGreaterThan(contractsIndex);
    expect(buildIndex).toBeGreaterThan(noCloudIndex);
    expect(publishIndex).toBeGreaterThan(buildIndex);
  });

  test("does not let npm publish rerun the full suite after release gates pass", () => {
    expect(workflow).toContain("npm publish --provenance --access public --ignore-scripts");
    expect(workflow).not.toContain("run: npm publish --provenance --access public\n");
  });
});
