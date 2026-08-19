import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WORKFLOW = ".github/workflows/deploy-todos.yml";

const required = [
  'paths: ["apps/todos/**"]',
  "contents: read",
  "id-token: write",
  "environment: production",
  "working-directory: apps/todos",
  'AWS_ACCOUNT_ID: "789877399345"',
  "DEPLOY_MANIFEST: /hasna/deploy/todos",
  "EXPECTED_CLUSTER: oss-fleet-prod",
  "EXPECTED_SERVICE: todos-prod",
  "EXPECTED_ECR_REPOSITORY: todos",
  "EXPECTED_MIGRATION_FAMILY: todos-prod-migrate",
  "arn:aws:iam::${{ env.AWS_ACCOUNT_ID }}:role/todos-prod-gha-deploy",
  'aws sts get-caller-identity --query Account --output text',
  '[[ "${cluster}" == "${EXPECTED_CLUSTER}" ]]',
  '[[ "${service}" == "${EXPECTED_SERVICE}" ]]',
  '[[ "${migration_family}" == "${EXPECTED_MIGRATION_FAMILY}" ]]',
  '[[ "${ecr_url}" == "${expected_ecr_url}" ]]',
  'imageTagMutability',
  '"IMMUTABLE"',
  'imageScanningConfiguration.scanOnPush',
  "aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25",
  "output: ${{ github.workspace }}/apps/todos/trivy-local.json",
  "describe-image-scan-findings",
  'printf \'digest_image=%s@%s\\n\'',
  'aws ecs run-task',
  '[[ "${exit_code}" == "0" ]]',
  'previous_task_definition=',
  'previous_image=',
  'aws ecs update-service',
  'steps.deploy.outputs.service_mutated == \'true\'',
  'task-definition "${PREVIOUS_TASK_DEFINITION}"',
  '[[ "${live}" == "${PREVIOUS_TASK_DEFINITION}" ]]',
  '[[ "${deployed_image}" == "${IMAGE}" ]]',
  'hasna.todos.production_deploy.v1',
  'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
];

const requiredDocumentation = ['repo:hasna/apps:environment:production'];

const forbidden = [
  "pull_request:",
  "terraform apply",
  "todos-prod-image-builder",
  ":latest",
  "secrets.AWS_",
  "aws-access-key-id",
  "aws-secret-access-key",
  "apps/todos/.github/workflows/deploy.yml",
];

function withoutComments(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      let singleQuoted = false;
      let doubleQuoted = false;
      let escaped = false;

      for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (character === "\\" && doubleQuoted) {
          escaped = true;
          continue;
        }
        if (character === "'" && !doubleQuoted) {
          singleQuoted = !singleQuoted;
          continue;
        }
        if (character === '"' && !singleQuoted) {
          doubleQuoted = !doubleQuoted;
          continue;
        }
        if (
          character === "#" &&
          !singleQuoted &&
          !doubleQuoted &&
          (index === 0 || /\s/.test(line[index - 1] ?? ""))
        ) {
          return line.slice(0, index).trimEnd();
        }
      }

      return line;
    })
    .join("\n");
}

export function validateTodosDeploy(workflow: string): string[] {
  const activeWorkflow = withoutComments(workflow);
  const errors: string[] = [];
  for (const fragment of required) {
    if (!activeWorkflow.includes(fragment)) errors.push(`missing required deployment control: ${fragment}`);
  }
  for (const fragment of requiredDocumentation) {
    if (!workflow.includes(fragment)) errors.push(`missing required deployment documentation: ${fragment}`);
  }
  for (const fragment of forbidden) {
    if (activeWorkflow.includes(fragment)) errors.push(`forbidden deployment construct: ${fragment}`);
  }

  const actionRefs = [...activeWorkflow.matchAll(/^\s*uses:\s*([^\s#]+)\s*$/gm)].map((match) => match[1]);
  for (const ref of actionRefs) {
    if (!ref || !/@[0-9a-f]{40}$/.test(ref)) errors.push(`action is not pinned to a full commit: ${ref ?? "unknown"}`);
  }

  const workflowDispatch = activeWorkflow.indexOf("workflow_dispatch:");
  const oidc = activeWorkflow.indexOf("Configure AWS credentials with GitHub OIDC");
  const accountGuard = activeWorkflow.indexOf("AWS account mismatch");
  const manifestGuard = activeWorkflow.indexOf("manifest cluster mismatch");
  const push = activeWorkflow.indexOf("Push scanned image and resolve immutable digest");
  const migration = activeWorkflow.indexOf("Run one-shot migration task on the digest");
  const deploy = activeWorkflow.indexOf("Register digest-pinned task definition and update service");
  const rollback = activeWorkflow.indexOf("Restore rollback anchor after a failed service rollout");
  if (!(workflowDispatch >= 0 && oidc > workflowDispatch && accountGuard > oidc && manifestGuard > accountGuard && push > manifestGuard && migration > push && deploy > migration && rollback > deploy)) {
    errors.push("deployment controls are not in fail-closed build/auth/target/push/migrate/deploy/rollback order");
  }

  return errors;
}

function selfTest(): boolean {
  const real = readFileSync(join(process.cwd(), WORKFLOW), "utf8");
  const temp = mkdtempSync(join(tmpdir(), "todos-deploy-check-"));
  try {
    const positive = real
      .replace('EXPECTED_SERVICE: todos-prod', 'EXPECTED_SERVICE: wrong-service # EXPECTED_SERVICE: todos-prod')
      .replace(
        '[[ "${live}" == "${PREVIOUS_TASK_DEFINITION}" ]]',
        'true # [[ "${live}" == "${PREVIOUS_TASK_DEFINITION}" ]]',
      );
    writeFileSync(join(temp, "broken.yml"), positive);
    const positiveErrors = validateTodosDeploy(readFileSync(join(temp, "broken.yml"), "utf8"));
    const targetFired = positiveErrors.some((error) => error.includes("EXPECTED_SERVICE: todos-prod"));
    const rollbackFired = positiveErrors.some((error) => error.includes('[[ "${live}" == "${PREVIOUS_TASK_DEFINITION}" ]]'));
    if (!targetFired || !rollbackFired) {
      console.error(`todos-deploy self-test: FAIL (target=${targetFired}, rollback=${rollbackFired})`);
      return false;
    }

    const negativeErrors = validateTodosDeploy(real);
    if (negativeErrors.length > 0) {
      console.error("todos-deploy self-test: FAIL (valid workflow rejected)");
      console.error(negativeErrors.join("\n"));
      return false;
    }
    console.log("todos-deploy self-test: PASS (target and rollback defects fire; valid workflow stays silent)");
    return true;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv.includes("--self-test")) process.exit(selfTest() ? 0 : 1);

const workflow = readFileSync(join(process.cwd(), WORKFLOW), "utf8");
const errors = validateTodosDeploy(workflow);
if (errors.length > 0) {
  for (const error of errors) console.error(`  ${error}`);
  console.error(`todos-deploy: FAIL — ${errors.length} violation(s)`);
  process.exit(1);
}
console.log("todos-deploy: PASS — root workflow is target-pinned, scan-gated, digest-pinned, and rollback-ready");
