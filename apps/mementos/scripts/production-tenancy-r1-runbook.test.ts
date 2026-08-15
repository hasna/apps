import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const runbook = readFileSync(
  resolve(root, "docs/PRODUCTION-TENANCY-R1-RUNBOOK.md"),
  "utf8",
);

describe("production tenancy R1 runbook", () => {
  test("requires all four endpoint gates and both discriminating partial-id probes", () => {
    for (const endpoint of ["/health", "/v1/health", "/ready", "/v1/ready"]) {
      expect(runbook).toContain(endpoint);
    }
    expect(runbook).toContain("partial-id-acceptance.ts pre-deploy-negative");
    expect(runbook).toContain("partial-id-acceptance.ts post-deploy-positive");
    expect(runbook).toContain("version increments by exactly one");
    expect(runbook).toContain("independent full-ID read returns HTTP 404");
  });

  test("makes snapshot clone cutover and reversal executable before mutation", () => {
    expect(runbook).toContain("restore-db-instance-from-db-snapshot");
    expect(runbook).toContain("--deletion-protection");
    expect(runbook).toContain("dsn-clone-cutover.ts stage");
    expect(runbook).toContain("dsn-clone-cutover.ts cutover");
    expect(runbook).toContain("dsn-clone-cutover.ts reverse");
    expect(runbook).toContain("hasna/oss/mementos/database-url");
    expect(runbook).toContain("hasna/oss/mementos/database-url-owner");
    expect(runbook).toContain("shared RDS source is never modified or replaced");
    expect(runbook).toContain('.command=["mementos-tenancy-r1"]');
    expect(runbook).toContain("del(.entryPoint)");
    expect(
      runbook.match(/--task-definition "\$ROLLBACK_TD" --desired-count 1/g)
        ?.length,
    ).toBe(2);
    expect(runbook.match(/--desired-count 0/g)?.length).toBe(2);
    expect(runbook).toContain("--expect source");
  });
});
