import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function assertHostedSecretScan(workflow: string): void {
  const requiredFragments = [
    "secret-scan:",
    "name: Secret scan (gitleaks)",
    "GITLEAKS_VERSION: 8.30.1",
    "GITLEAKS_SHA256: 551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    "fetch-depth: 0",
    "persist-credentials: false",
    'echo "${GITLEAKS_SHA256}  ${RUNNER_TEMP}/gitleaks.tar.gz" | sha256sum --check --strict -',
    "EVENT_NAME: ${{ github.event_name }}",
    "PR_BASE_SHA: ${{ github.event.pull_request.base.sha }}",
    "PR_HEAD_SHA: ${{ github.event.pull_request.head.sha }}",
    "PUSH_BEFORE: ${{ github.event.before }}",
    "PUSH_AFTER: ${{ github.event.after }}",
    'log_opts="--no-merges ${PR_BASE_SHA}..${PR_HEAD_SHA}"',
    'gitleaks git --log-opts "${GITLEAKS_LOG_OPTS}"',
    "gitleaks git --redact --no-banner --platform github --exit-code 1 .",
  ];

  for (const fragment of requiredFragments) {
    if (!workflow.includes(fragment)) {
      throw new Error(`missing hosted secret-scan fragment: ${fragment}`);
    }
  }

  for (const forbiddenFragment of [
    "secrets.",
    "--no-redact",
    "persist-credentials: true",
  ]) {
    if (workflow.includes(forbiddenFragment)) {
      throw new Error(
        `forbidden hosted secret-scan fragment: ${forbiddenFragment}`,
      );
    }
  }
}

describe("hosted CI secret scan", () => {
  test("pins and verifies gitleaks while scanning the event commit range", () => {
    const workflow = readFileSync(
      join(root, ".github/workflows/ci.yml"),
      "utf8",
    );

    expect(() => assertHostedSecretScan(workflow)).not.toThrow();
  });

  test("rejects a workflow whose hosted secret-scan job is absent", () => {
    const workflow = readFileSync(
      join(root, ".github/workflows/ci.yml"),
      "utf8",
    ).replace("  secret-scan:", "  removed-scan:");

    expect(() => assertHostedSecretScan(workflow)).toThrow(
      "missing hosted secret-scan fragment: secret-scan:",
    );
  });
});
