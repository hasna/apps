import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const workflow = readFileSync(join(import.meta.dir, "..", "..", ".github", "workflows", "deploy.yml"), "utf8");
const resolver = join(import.meta.dir, "resolve-ecr-image.sh");

type ResolverMode = "absent" | "existing" | "error" | "empty";
const sourceSha = "a".repeat(40);
const differentSourceSha = "b".repeat(40);

function runResolver(mode: ResolverMode, sha = sourceSha) {
  const root = mkdtempSync(join(tmpdir(), "conversations-deploy-contract-"));
  const bin = join(root, "bin");
  const output = join(root, "github-output");
  const calls = join(root, "calls");
  const aws = join(bin, "aws");
  const docker = join(bin, "docker");

  try {
    mkdirSync(bin);
    writeFileSync(
      aws,
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${calls}"
if [[ "$*" == *"list-images"* ]]; then
  case "${mode}" in
    absent) printf '%s\\n' None ;;
    existing) printf '%s\\n' sha256:existing ;;
    empty) printf '\\n' ;;
    error) printf '%s\\n' 'AccessDeniedException: denied' >&2; exit 254 ;;
  esac
  exit 0
fi
if [[ "$*" == *"describe-images"* ]]; then
  printf '%s\\n' sha256:after-push
  exit 0
fi
printf '%s\\n' 'unexpected aws command' >&2
exit 2
`,
    );
    writeFileSync(
      docker,
      `#!/usr/bin/env bash
set -euo pipefail
printf 'docker %s\\n' "$*" >> "${calls}"
`,
    );
    chmodSync(aws, 0o755);
    chmodSync(docker, 0o755);

    const result = Bun.spawnSync(["bash", resolver], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        ECR_URL: "123456789012.dkr.ecr.us-east-1.amazonaws.com/conversations",
        GITHUB_SHA: sha,
        GITHUB_OUTPUT: output,
      },
      stderr: "pipe",
      stdout: "pipe",
    });

    return {
      result,
      output: existsSync(output) ? readFileSync(output, "utf8") : "",
      calls: existsSync(calls) ? readFileSync(calls, "utf8") : "",
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

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

  test("uses the resolver's digest-pinned image for migration and deploy", () => {
    expect(workflow).toContain("bash scripts/ci/resolve-ecr-image.sh");
    expect(workflow).toContain("IMAGE: ${{ steps.build.outputs.image }}");
    expect(readFileSync(resolver, "utf8")).toContain('IMAGE="${ECR_URL}@${DIGEST}"');
    expect(workflow).not.toContain(":latest");
  });

  test("rebuilds and pushes only when the exact source tag is proven absent", () => {
    const { result, output, calls } = runResolver("absent");
    expect(result.exitCode).toBe(0);
    expect(output).toContain("image=123456789012.dkr.ecr.us-east-1.amazonaws.com/conversations@sha256:after-push");
    expect(output).toContain(`tag=${sourceSha}`);
    expect(calls).toContain("list-images");
    expect(calls).toContain(sourceSha);
    expect(calls).toContain("describe-images");
    expect(calls).toContain(`docker buildx build --platform linux/arm64`);
    expect(calls).toContain(`--tag 123456789012.dkr.ecr.us-east-1.amazonaws.com/conversations:${sourceSha}`);
    expect(calls).toContain("--push");
  });

  test("binds each newly built artifact to its own full source SHA", () => {
    const first = runResolver("absent", sourceSha);
    const second = runResolver("absent", differentSourceSha);

    expect(first.result.exitCode).toBe(0);
    expect(second.result.exitCode).toBe(0);
    expect([
      first.calls.includes(`--build-arg BUILD_SHA=${sourceSha}`),
      first.calls.includes("--build-arg REQUIRE_BUILD_SHA=1"),
      second.calls.includes(`--build-arg BUILD_SHA=${differentSourceSha}`),
      second.calls.includes("--build-arg REQUIRE_BUILD_SHA=1"),
      !second.calls.includes(`--build-arg BUILD_SHA=${sourceSha}`),
    ]).toEqual([true, true, true, true, true]);
  });

  test("reuses the existing source tag digest without rebuilding or pushing", () => {
    const { result, output, calls } = runResolver("existing");
    expect(result.exitCode).toBe(0);
    expect(output).toContain("image=123456789012.dkr.ecr.us-east-1.amazonaws.com/conversations@sha256:existing");
    expect(output).toContain(`tag=${sourceSha}`);
    expect(calls).toContain("list-images");
    expect(calls).toContain(sourceSha);
    expect(calls).not.toContain("describe-images");
    expect(calls).not.toContain("docker buildx build");
  });

  test("fails closed when the registry lookup fails", () => {
    const { result, output, calls } = runResolver("error");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("AccessDeniedException: denied");
    expect(output).toBe("");
    expect(calls).toContain("list-images");
    expect(calls).not.toContain("docker buildx build");
  });

  test("fails closed on an empty successful registry response", () => {
    const { result, output, calls } = runResolver("empty");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("empty digest lookup");
    expect(output).toBe("");
    expect(calls).toContain("list-images");
    expect(calls).not.toContain("docker buildx build");
  });
});
