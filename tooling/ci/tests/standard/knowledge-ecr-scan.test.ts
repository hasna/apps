import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dir, "../../../..");
const workflow = Bun.YAML.parse(readFileSync(join(root, ".github/workflows/deploy-knowledge.yml"), "utf8")) as {
  jobs: { deploy: { steps: { name?: string; run?: string }[] } };
};
const step = workflow.jobs.deploy.steps.find(item => item.name === "Wait for ECR scan and enforce vulnerability gate")!;
const digest = `sha256:${"b".repeat(64)}`;
type Response = { body?: string; error?: string };
const clean: Response = { body: JSON.stringify({ status: "COMPLETE", counts: {} }) };

function runScan(responses: Response[], imageDigest = digest) {
  const scratch = mkdtempSync(join(tmpdir(), "knowledge-ecr-scan-"));
  try {
    responses.forEach((response, index) => {
      writeFileSync(join(scratch, `${index}.out`), response.body ?? "");
      writeFileSync(join(scratch, `${index}.err`), response.error ?? "");
    });
    writeFileSync(join(scratch, "aws"), `#!/usr/bin/env bash
set -euo pipefail
[[ "$*" == 'ecr describe-image-scan-findings --repository-name knowledge --image-id imageDigest=${digest} --query {status:imageScanStatus.status,counts:imageScanFindings.findingSeverityCounts} --output json' ]] || exit 44
count=0
if [[ -f "$KNOWLEDGE_SCAN_FIXTURE/count" ]]; then count="$(cat "$KNOWLEDGE_SCAN_FIXTURE/count")"; fi
printf '%s' "$((count + 1))" > "$KNOWLEDGE_SCAN_FIXTURE/count"
index="$count"
if (( index >= KNOWLEDGE_SCAN_RESPONSE_COUNT )); then index="$((KNOWLEDGE_SCAN_RESPONSE_COUNT - 1))"; fi
if [[ -s "$KNOWLEDGE_SCAN_FIXTURE/$index.err" ]]; then
  cat "$KNOWLEDGE_SCAN_FIXTURE/$index.err" >&2
  exit 255
fi
cat "$KNOWLEDGE_SCAN_FIXTURE/$index.out"
`, { mode: 0o700 });
    writeFileSync(join(scratch, "sleep"), "#!/usr/bin/env bash\n[[ \"$1\" == 5 ]] || exit 45\nexit 0\n", { mode: 0o700 });
    const result = spawnSync("bash", ["-c", step.run!], {
      cwd: scratch, encoding: "utf8", timeout: 10_000,
      env: { ...process.env, PATH: `${scratch}:${process.env.PATH}`, RUNNER_TEMP: scratch,
        KNOWLEDGE_SCAN_FIXTURE: scratch, KNOWLEDGE_SCAN_RESPONSE_COUNT: String(responses.length), IMAGE_DIGEST: imageDigest },
    });
    const receipt = join(scratch, "knowledge-ecr-scan.json");
    return { status: result.status, error: result.error, stderr: result.stderr,
      receipt: existsSync(receipt) ? readFileSync(receipt, "utf8") : "",
      calls: existsSync(join(scratch, "count")) ? Number(readFileSync(join(scratch, "count"), "utf8")) : 0 };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

test("Knowledge retries scan initialization and in-progress status for the same immutable digest", () => {
  const result = runScan([{ error: "An error occurred (ScanNotFoundException): not initialized" }, { body: JSON.stringify({ status: "IN_PROGRESS" }) }, clean]);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.calls).toBe(3);
  expect(JSON.parse(result.receipt)).toEqual({ status: "COMPLETE", counts: {} });
});

test("Knowledge bounds a scan that never initializes", () => {
  const result = runScan([{ error: "ScanNotFoundException" }]);
  expect(result.status).not.toBe(0);
  expect(result.calls).toBe(60);
  expect(result.stderr).toContain("ECR scan did not complete");
  expect(result.receipt).toBe("");
});

test("Knowledge bounds a scan that remains in progress", () => {
  const result = runScan([{ body: JSON.stringify({ status: "IN_PROGRESS" }) }]);
  expect(result.status).not.toBe(0);
  expect(result.calls).toBe(60);
  expect(result.receipt).toBe("");
});

test("Knowledge fails immediately on unrelated AWS errors without rendering the raw error", () => {
  const result = runScan([{ error: "AccessDeniedException: private-error-marker" }, clean]);
  expect(result.status).not.toBe(0);
  expect(result.calls).toBe(1);
  expect(result.stderr).toContain("ECR scan query failed");
  expect(result.stderr).not.toContain("private-error-marker");
  expect(result.receipt).toBe("");
});

for (const status of ["FAILED", "UNSUPPORTED_IMAGE", "SCAN_ELIGIBILITY_EXPIRED", "UNKNOWN"]) {
  test(`Knowledge rejects terminal or unknown scan state ${status}`, () => {
    const result = runScan([{ body: JSON.stringify({ status }) }, clean]);
    expect(result.status).not.toBe(0);
    expect(result.calls).toBe(1);
    expect(result.receipt).toBe("");
  });
}

for (const severity of ["HIGH", "CRITICAL"]) {
  test(`Knowledge rejects nonzero ${severity} findings`, () => {
    const result = runScan([{ body: JSON.stringify({ status: "COMPLETE", counts: { [severity]: 1 } }) }]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("scan rejected the candidate");
    expect(result.receipt).toBe("");
  });
}

for (const counts of [undefined, null, [], "", { HIGH: null }, { CRITICAL: false }, { HIGH: "0" }, { HIGH: -1 }, { CRITICAL: 0.5 }]) {
  test(`Knowledge rejects malformed severity counts ${JSON.stringify(counts)}`, () => {
    const result = runScan([{ body: JSON.stringify({ status: "COMPLETE", counts }) }]);
    expect(result.status).not.toBe(0);
    expect(result.receipt).toBe("");
  });
}

for (const body of ["", "{broken", JSON.stringify({ counts: {} }), JSON.stringify({ status: 1, counts: {} })]) {
  test(`Knowledge rejects malformed scan responses ${JSON.stringify(body)}`, () => {
    const result = runScan([{ body }]);
    expect(result.status).not.toBe(0);
    expect(result.receipt).toBe("");
  });
}

test("Knowledge refuses an invalid digest before any ECR query", () => {
  const result = runScan([clean], "latest");
  expect(result.status).not.toBe(0);
  expect(result.calls).toBe(0);
});
