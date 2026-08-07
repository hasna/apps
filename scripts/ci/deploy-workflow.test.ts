import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workflow = readFileSync(join(import.meta.dir, "..", "..", ".github", "workflows", "deploy.yml"), "utf8");

describe("deploy migration failure evidence", () => {
  test("keeps migration and circuit-breaker gates intact", () => {
    expect(workflow).toContain('if [ "$EXIT" != "0" ]; then');
    expect(workflow).toContain('if [ "$RS" != "COMPLETED" ]; then');
    expect(workflow).toContain('if [ "$LIVE_TD" != "$WEB_ARN" ]; then');
  });

  test("reports exact ECS and awslogs coordinates before failing", () => {
    expect(workflow).toContain("taskDefinitionArn");
    expect(workflow).toContain("stopCode");
    expect(workflow).toContain("containerReason=");
    expect(workflow).toContain("awslogs-group");
    expect(workflow).toContain("awslogs-region");
    expect(workflow).toContain("awslogs-stream-prefix");
    expect(workflow).toContain('LOG_STREAM="${LOG_PREFIX}/${MIG_CONTAINER}/${TASK_ID}"');
    expect(workflow).toContain('>> "$GITHUB_STEP_SUMMARY"');
    expect(workflow).toContain("aws logs get-log-events");
    expect(workflow).toContain("| node scripts/ci/redact-log-lines.mjs");
  });

  test("does not print task environment or secret values", () => {
    expect(workflow).not.toContain(".containerDefinitions[].environment");
    expect(workflow).not.toContain(".containerDefinitions[].secrets");
    expect(workflow).not.toContain("aws secretsmanager get-secret-value");
  });
});
