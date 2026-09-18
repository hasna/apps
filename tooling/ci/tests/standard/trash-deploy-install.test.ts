import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dir, "../../../..");
type Step = { name?: string; uses?: string; run?: string };
const workflow = Bun.YAML.parse(readFileSync(join(root, ".github/workflows/deploy-trash.yml"), "utf8")) as { jobs: { deploy: { steps: Step[] } } };

test("Trash deployment installs without unordered workspace hooks before building", () => {
  const steps = workflow.jobs.deploy.steps;
  const buildIndex = steps.findIndex(step => step.name === "Build the Trash distribution");
  const step = steps[buildIndex];
  expect(step?.run).toBeString();
  const scratch = mkdtempSync(join(tmpdir(), "trash-deploy-install-"));
  try {
    // Model Bun's unordered workspace prepare failure: a scriptful install
    // imports an SDK before its sibling has produced dist. Frozen, scriptless
    // installation followed by the explicit member build avoids that race.
    writeFileSync(join(scratch, "bun"), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$TRASH_INSTALL_TRACE"
if [[ "$1" == install ]]; then
  [[ " $* " == *" --frozen-lockfile "* ]] || exit 41
  [[ " $* " == *" --ignore-scripts "* ]] || exit 42
elif [[ "$*" != 'run build' ]]; then
  exit 43
fi
`, { mode: 0o700 });
    const trace = join(scratch, "trace");
    const result = spawnSync("bash", ["-c", step!.run!], {
      cwd: scratch,
      env: { ...process.env, PATH: `${scratch}:${process.env.PATH}`, TRASH_INSTALL_TRACE: trace },
      encoding: "utf8", timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(readFileSync(trace, "utf8").trim().split("\n")).toEqual([
      "install --frozen-lockfile --ignore-scripts", "run build",
    ]);
    expect(buildIndex).toBeLessThan(steps.findIndex(item => item.name === "Build native ARM64 runtime image locally"));
    expect(buildIndex).toBeLessThan(steps.findIndex(item => item.uses?.startsWith("aws-actions/configure-aws-credentials@")));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
