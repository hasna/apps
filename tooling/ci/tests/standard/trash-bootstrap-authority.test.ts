import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const script = resolve(import.meta.dir, "../../verify-trash-bootstrap-release.sh");
const source = "a".repeat(40), controller = "b".repeat(40);
const image = `789877399345.dkr.ecr.us-east-1.amazonaws.com/trash@sha256:${"c".repeat(64)}`;
function run(options: { tuple?: unknown; running?: number; ancestor?: boolean; currentCi?: boolean; oldCi?: boolean; previous?: string; stream?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "trash-bootstrap-authority-"));
  try {
    const tuple = options.tuple === undefined ? { image, source_sha: source } : options.tuple;
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ bootstrap_release: tuple }));
    writeFileSync(join(dir, "service.json"), JSON.stringify({ failures: [], services: [{status: "ACTIVE", desiredCount: 0, runningCount: options.running ?? 0, pendingCount: 0}] }));
    writeFileSync(join(dir, "git"), `#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == 'rev-parse HEAD' ]]; then printf '%s\\n' '${controller}';
elif [[ "$*" == 'merge-base --is-ancestor ${source}^{commit} ${controller}^{commit}' ]]; then exit ${options.ancestor === false ? 1 : 0};
else exit 44; fi
`, { mode: 0o700 });
    const ci = (sha: string, pass: boolean) => JSON.stringify({ workflow_runs: [{ id: sha === source ? 11 : 22, name: "ci", path: ".github/workflows/ci.yml", head_sha: sha, head_branch: "main", event: "push", status: "completed", conclusion: pass ? "success" : "failure" }] });
    writeFileSync(join(dir, "old.json"), ci(source, options.oldCi !== false));
    writeFileSync(join(dir, "current.json"), ci(controller, options.currentCi !== false));
    writeFileSync(join(dir, "gh"), `#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == api ]] || exit 44
case "$2" in
 *head_sha=${source}'&per_page=100') cat "$FIXTURE/old.json" ;;
 *head_sha=${controller}'&per_page=100') cat "$FIXTURE/current.json" ;;
 *) exit 44 ;;
esac
${options.stream ? "printf '{}\\n'" : ""}
`, { mode: 0o700 });
    const output = join(dir, "output");
    const r = spawnSync("bash", [script], { cwd: dir, encoding: "utf8", timeout: 10_000, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FIXTURE: dir,
      TRASH_DEPLOY_MANIFEST_FILE: join(dir,"manifest.json"), TRASH_STAGED_SERVICE_FILE: join(dir,"service.json"), PREVIOUS_IMAGE: options.previous ?? image,
      SOURCE_SHA: controller, GITHUB_REPOSITORY: "hasna/apps", GITHUB_OUTPUT: output, RUNNER_TEMP: dir,
    }});
    return { status: r.status, stderr: r.stderr, output: existsSync(output) ? readFileSync(output,"utf8") : "" };
  } finally { rmSync(dir, {recursive:true,force:true}); }
}

test("reviewed historical image keeps its source distinct from the current controller", () => {
  const r=run(); expect(r.status).toBe(0); expect(r.output).toContain(`source_sha=${source}\n`); expect(r.output).toContain("bootstrap_ci_run_id=11\n"); expect(r.output).toContain("controller_ci_run_id=22\n");
});
for (const options of [
  {tuple:null}, {tuple:{image,source_sha:"bad"}}, {tuple:{image:image.replace("/trash@","/foreign@"),source_sha:source}},
  {previous:image.replace("c".repeat(64),"d".repeat(64))}, {running:1}, {ancestor:false}, {currentCi:false}, {oldCi:false}, {stream:true},
]) test(`bootstrap refuses unbound authority ${JSON.stringify(options)}`, () => {
  const r=run(options); expect(r.status).not.toBe(0); expect(r.output).toBe("");
});

test("migration receipt records both the application and controller sources", () => {
  const root = resolve(import.meta.dir, "../../../..");
  const workflow = Bun.YAML.parse(readFileSync(join(root,".github/workflows/deploy-trash.yml"),"utf8")) as any;
  const steps = workflow.jobs.deploy.steps;
  const step = steps.find((s:any)=>s.name === "Emit exact bootstrap migration receipt");
  const contract = steps.find((s:any)=>s.id === "bootstrap-contract");
  expect(contract.if).toBe("steps.before.outputs.bootstrap == 'true'");
  expect(steps.indexOf(contract)).toBeLessThan(steps.findIndex((s:any)=>s.id === "migration"));
  expect(step.env.BOOTSTRAP_SOURCE_SHA).toBe("${{ steps.bootstrap-contract.outputs.source_sha }}");
  const dir=mkdtempSync(join(tmpdir(),"trash-migration-receipt-"));
  try {
    writeFileSync(join(dir,"aws"), '#!/usr/bin/env bash\nset -euo pipefail\n[[ "$*" == "ssm put-parameter --cli-input-json file://migration-receipt-request.json" ]]\n', {mode:0o700});
    const r=spawnSync("bash",["-c",step.run],{cwd:dir,encoding:"utf8",timeout:10_000,env:{...process.env,PATH:`${dir}:${process.env.PATH}`,
      IMAGE:image, SOURCE_SHA:controller, BOOTSTRAP_SOURCE_SHA:source, BOOTSTRAP_CI_RUN_ID:"11", CONTROLLER_CI_RUN_ID:"22", GITHUB_RUN_ID:"33",
      MIGRATION_TASK_DEFINITION:"arn:aws:ecs:us-east-1:789877399345:task-definition/trash-prod-migrate:2",
      MIGRATION_TASK:"arn:aws:ecs:us-east-1:789877399345:task/oss-fleet-prod/"+"d".repeat(32), MIGRATION_RECEIPT_PARAMETER:"/hasna/deploy/trash/migration-receipt",
    }});
    expect(r.status).toBe(0);
    const receipt=JSON.parse(readFileSync(join(dir,"migration-receipt.json"),"utf8"));
    expect(receipt.source_sha).toBe(source); expect(receipt.controller_source_sha).toBe(controller);
    expect(receipt.bootstrap_ci_run_id).toBe(11); expect(receipt.controller_ci_run_id).toBe(22); expect(receipt.exit_code).toBe(0);
    expect(JSON.parse(JSON.parse(readFileSync(join(dir,"migration-receipt-request.json"),"utf8")).Value)).toEqual(receipt);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
