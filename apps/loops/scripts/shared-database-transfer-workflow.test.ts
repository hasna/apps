import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const workflowPath = new URL("../.github/workflows/shared-database-transfer.yml", import.meta.url);
const workflow = readFileSync(workflowPath, "utf8");

describe("shared database transfer workflow contract", () => {
  test("is protected, manual, and has minimum permissions", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("confirmation:");
    expect(workflow).toContain("environment: shared-database-transfer");
    expect(workflow).toMatch(/permissions:\n  contents: read\n  id-token: write/);
    expect(workflow).toContain("runs-on: ubuntu-24.04-arm");
    expect(workflow).toContain("cancel-in-progress: false");
  });

  test("does not accept DSNs or operator shell commands from GitHub inputs", () => {
    const inputBlock = workflow.slice(workflow.indexOf("inputs:"), workflow.indexOf("concurrency:"));
    expect(inputBlock).not.toMatch(/dsn|database|url|command|override/i);
    expect(inputBlock).toContain("confirmation:");
    expect(workflow).toContain("source DSN inputs: \\`none from GitHub; ECS task secrets only\\`");
  });

  test("runs the fixed transfer command through ECS without snapshot restore authority", () => {
    expect(workflow).toContain('command:["bun","dist/serve/index.js","shared-to-dedicated-transfer"]');
    expect(workflow).toContain("--no-enable-execute-command");
    expect(workflow).not.toContain("--enable-execute-command false");
    expect(workflow).toContain("assignPublicIp:\"DISABLED\"");
    expect(workflow).not.toMatch(/restore-db-cluster|restore-db-instance|aws\s+rds|rds\s+restore/i);
    expect(workflow).toContain("snapshot restore: \\`not available\\`");
  });

  test("cleans up a started ECS task on post-start supervision failures", () => {
    expect(workflow).toContain("cleanup_started_task");
    expect(workflow).toContain("aws ecs stop-task");
    expect(workflow).toContain("waiting for transfer task failed");
    expect(workflow).toContain("describing transfer task failed");
    expect(workflow).toContain("transfer task cleanup did not reach STOPPED");
    expect(workflow).toMatch(/for attempt in \{1\.\.40\}/);
  });

  test("pins third-party actions to approved commit SHAs", () => {
    const uses = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)].map((match) => match[1]);
    expect(uses).toEqual([
      "aws-actions/configure-aws-credentials@7474bc4690e29a8392af63c5b98e7449536d5c3a",
    ]);
  });
});
