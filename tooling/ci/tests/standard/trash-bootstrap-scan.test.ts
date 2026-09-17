import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dir, "../../../..");
const workflow = Bun.YAML.parse(readFileSync(join(root, ".github/workflows/deploy-trash.yml"), "utf8")) as { jobs: { deploy: { steps: { name?: string; run?: string }[] } } };
const step = workflow.jobs.deploy.steps.find(item => item.name === "Verify staged bootstrap image provenance and scan")!;
const source = "a".repeat(40);
const digest = `sha256:${"b".repeat(64)}`;
const ecr = "789877399345.dkr.ecr.us-east-1.amazonaws.com/trash";

function runScan(responses: string[], tags = [`deploy-${source}-bootstrap`]) {
  const scratch = mkdtempSync(join(tmpdir(), "trash-bootstrap-scan-"));
  try {
    writeFileSync(join(scratch, "tags.json"), JSON.stringify(tags));
    responses.forEach((response, index) => writeFileSync(join(scratch, `${index}.json`), response));
    writeFileSync(join(scratch, "aws"), `#!/usr/bin/env bash
set -euo pipefail
case "$1 $2" in
  'ecr describe-images') cat "$TRASH_SCAN_FIXTURE/tags.json" ;;
  'ecr describe-image-scan-findings')
    count=0
    if [[ -f "$TRASH_SCAN_FIXTURE/count" ]]; then count="$(cat "$TRASH_SCAN_FIXTURE/count")"; fi
    printf '%s' "$((count + 1))" > "$TRASH_SCAN_FIXTURE/count"
    cat "$TRASH_SCAN_FIXTURE/$count.json"
    ;;
  *) exit 44 ;;
esac
`, { mode: 0o700 });
    writeFileSync(join(scratch, "sleep"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o700 });
    const output = join(scratch, "output");
    const result = spawnSync("bash", ["-c", step.run!], {
      cwd: scratch, encoding: "utf8", timeout: 10_000,
      env: { ...process.env, PATH: `${scratch}:${process.env.PATH}`, TRASH_SCAN_FIXTURE: scratch,
        SOURCE_SHA: source, PREVIOUS_IMAGE: `${ecr}@${digest}`, ECR_URL: ecr,
        EXPECTED_ECR_REPOSITORY: "trash", GITHUB_OUTPUT: output },
    });
    return { status: result.status, error: result.error, stderr: result.stderr,
      output: existsSync(output) ? readFileSync(output, "utf8") : "",
      calls: existsSync(join(scratch, "count")) ? Number(readFileSync(join(scratch, "count"), "utf8")) : 0 };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

const clean = JSON.stringify({ status: "COMPLETE", counts: {} });
test("bootstrap accepts complete clean ECR JSON without appending a brace", () => {
  const result = runScan([clean]);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.output).toBe(`digest=${digest}\ndigest_image=${ecr}@${digest}\ncritical=0\nhigh=0\n`);
});
test("bootstrap waits through empty and in-progress scan responses", () => {
  const result = runScan(["", JSON.stringify({ status: "IN_PROGRESS" }), clean]);
  expect(result.status).toBe(0);
  expect(result.calls).toBe(3);
});
for (const severity of ["HIGH", "CRITICAL"]) {
  test(`bootstrap rejects nonzero ${severity} findings`, () => {
    const result = runScan([JSON.stringify({ status: "COMPLETE", counts: { [severity]: 1 } })]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("scan rejected the candidate");
    expect(result.output).toBe("");
  });
}
test("bootstrap rejects malformed JSON", () => {
  const result = runScan([`${clean}}`]);
  expect(result.status).not.toBe(0);
  expect(result.output).toBe("");
});
test("bootstrap rejects terminal scan failures", () => {
  const result = runScan([JSON.stringify({ status: "FAILED" })]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("terminal status FAILED");
  expect(result.output).toBe("");
});
test("bootstrap rejects a digest without the exact source tag before scanning", () => {
  const result = runScan([clean], ["deploy-other-bootstrap"]);
  expect(result.status).not.toBe(0);
  expect(result.calls).toBe(0);
  expect(result.output).toBe("");
});

for (const counts of [undefined, null, [], "", { HIGH: null }, { CRITICAL: false }, { HIGH: "0" }, { HIGH: -1 }, { CRITICAL: 0.5 }]) {
  test(`bootstrap rejects invalid scan counts ${JSON.stringify(counts)}`, () => {
    const result = runScan([JSON.stringify({ status: "COMPLETE", counts })]);
    expect(result.status).not.toBe(0);
    expect(result.output).toBe("");
  });
}
