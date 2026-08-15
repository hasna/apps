import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readme = readFileSync(join(import.meta.dir, "..", "README.md"), "utf8");

const retiredModePatterns: Array<[label: string, pattern: RegExp]> = [
  ["self_hosted mode", /\bself_hosted\b/i],
  ["deploymentMode field", /\bdeploymentModes?\b/i],
  ["three-way placement enum", /local\s*\|\s*self_hosted\s*\|\s*cloud/i],
  ["cloud mode", /\bcloud\s+mode\b/i],
  ["shared deployment mode", /\bshared\s+deployment\s+mode\b/i],
  ["remote mode", /\bremote\s+mode\b/i],
  ["hybrid mode", /\bhybrid\s+mode\b/i],
];

function retiredModeViolations(text: string): string[] {
  return retiredModePatterns
    .filter(([, pattern]) => pattern.test(text))
    .map(([label]) => label);
}

describe("README backend doctrine", () => {
  test("states the two product stories and the server backend contract", () => {
    expect(readme).toContain("user-hosted");
    expect(readme).toContain("Hasna SaaS");
    expect(readme).toMatch(/sqlite\s*\|\s*postgresql/i);
    expect(readme).toContain("HASNA_FEEDBACK_DATABASE_URL");
  });

  test("makes multi-user server APIs fail closed with scoped tokens", () => {
    expect(readme).toContain("sharedDeployment: true");
    expect(readme).toContain("FEEDBACK_SUBMIT_TOKEN");
    expect(readme).toContain("FEEDBACK_READ_TOKEN");
    expect(readme).toContain("FEEDBACK_TRIAGE_TOKEN");
    expect(readme).toContain("FEEDBACK_EXPORT_TOKEN");
  });

  test("does not teach retired placement modes", () => {
    expect(retiredModeViolations(readme)).toEqual([]);
  });

  test("allows ordinary location words without treating them as modes", () => {
    expect(
      retiredModeViolations(
        'A user-hosted server may use local SQLite; Hasna SaaS ("cloud") uses PostgreSQL.',
      ),
    ).toEqual([]);
  });
});
