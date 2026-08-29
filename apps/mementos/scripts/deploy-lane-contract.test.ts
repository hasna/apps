import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

// ---------------------------------------------------------------------------
// Deploy-lane contract for the mementos production service.
//
// Regression (O15-04621): the mementos deploy workflow lived NESTED at
// apps/mementos/.github/workflows/deploy.yml. GitHub Actions discovers
// workflows only at the repository root (.github/workflows/), so the lane
// never ran: MEMENTOS_CORS_ORIGIN never reached the live task definition and
// every cloud write 403'd with "Host is not allowed" even after the env
// injection fix (hasna/apps #1359) merged. This test pins the lane to the
// repository root, to the member-standard ci gate, and to the CORS origin
// secret that the live deployment must carry.
// ---------------------------------------------------------------------------

// apps/mementos/scripts/ -> repository root
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const rootWorkflowPath = new URL("../../../.github/workflows/deploy-mementos.yml", import.meta.url);
// One level up from scripts/ is apps/mementos/.github/workflows/deploy.yml.
// (Review finding: a "../../" form resolves to apps/.github/workflows/ and
// makes this assertion vacuous — the dead nested lane would pass it.)
const nestedWorkflowPath = new URL("../.github/workflows/deploy.yml", import.meta.url);
const nestedWorkflowsDir = new URL("../.github/workflows/", import.meta.url);
const deployScriptPath = new URL("../scripts/production-deploy.sh", import.meta.url);

type WorkflowStep = {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
};

type WorkflowJob = {
  if?: string;
  needs?: string | string[];
  environment?: string;
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  steps?: WorkflowStep[];
};

type Workflow = {
  on?: {
    workflow_run?: {
      workflows?: string[];
      types?: string[];
      branches?: string[];
    };
    workflow_dispatch?: Record<string, unknown>;
  };
  concurrency?: {
    group?: string;
    "cancel-in-progress"?: boolean;
  };
  permissions?: Record<string, string>;
  jobs?: Record<string, WorkflowJob>;
};

function envValues(...sources: Array<Record<string, string> | undefined>): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) merged[key] = value;
  }
  return merged;
}

function allWorkflowEnv(workflow: Workflow): Record<string, string> {
  const values: Record<string, string> = { ...envValues(workflow.env) };
  for (const job of Object.values(workflow.jobs ?? {})) {
    Object.assign(values, envValues(job?.env));
    for (const step of job?.steps ?? []) Object.assign(values, envValues(step?.env));
  }
  return values;
}

function workflowSource(): string {
  expect(
    existsSync(rootWorkflowPath),
    `mementos deploy lane must live at the repository root (${rootWorkflowPath.pathname}) — a workflow under apps/mementos/.github/workflows/ is never executed by GitHub Actions`,
  ).toBe(true);
  return readFileSync(rootWorkflowPath, "utf8");
}

const source = workflowSource();
const workflow = Bun.YAML.parse(source) as Workflow;
const allEnv = allWorkflowEnv(workflow);

describe("mementos deploy lane contract", () => {
  test("the deploy lane is discoverable by GitHub Actions (repository root, never nested)", () => {
    // GitHub Actions only executes workflows under <repo>/.github/workflows/.
    // The nested file this regression replaces was dead code that read as a
    // live lane ("deploy auto-runs on merge") while never running. Assert the
    // whole member workflows directory carries no deploy*.yml, so a re-added
    // nested lane under any name fails this test — not only the exact file
    // that was deleted.
    expect(
      existsSync(nestedWorkflowPath),
      "the dead nested apps/mementos/.github/workflows/deploy.yml must be removed so it cannot be mistaken for a live lane",
    ).toBe(false);
    if (existsSync(nestedWorkflowsDir)) {
      const nestedDeployLanes = readdirSync(nestedWorkflowsDir).filter(
        (f) => f.startsWith("deploy") && f.endsWith(".yml"),
      );
      expect(
        nestedDeployLanes,
        "no deploy workflow may live under apps/mementos/.github/workflows/ — GitHub Actions never executes it",
      ).toEqual([]);
    }
  });

  test("is triggered by a successful ci run on main (member-standard gate) and by manual dispatch", () => {
    expect(workflow.on?.workflow_run?.workflows).toEqual(["ci"]);
    expect(workflow.on?.workflow_run?.types).toEqual(["completed"]);
    expect(workflow.on?.workflow_run?.branches).toEqual(["main"]);
    expect(workflow.on?.workflow_dispatch).toBeDefined();
  });

  test("is scoped to the mementos member and bound to the ci workflow by exact file", () => {
    expect(allEnv.DEPLOY_PATH_SCOPE).toBe("apps/mementos/**");
    expect(allEnv.REQUIRED_CI_WORKFLOW).toBe("ci");
    expect(allEnv.CI_WORKFLOW_FILE).toBe("ci.yml");
  });

  test("carries the production CORS origin as a secret reference, never a literal internal origin", () => {
    // Regression (b77710cd / hasna/apps#1381): a literal internal origin in
    // the workflow env violates the repo publish-guard and was removed from
    // the nested lane; it must not return. The value lives in the
    // production-environment secret MEMENTOS_CORS_ORIGIN; the deploy script's
    // require_env keeps the gate fail-closed if the secret is ever unset.
    expect(allEnv.MEMENTOS_CORS_ORIGIN).toBe("${{ secrets.MEMENTOS_CORS_ORIGIN }}");
    expect(source).not.toMatch(/hasna\.[a-z]{2,}/);
  });

  test("resolves the production targets the deploy script requires", () => {
    expect(allEnv.AWS_REGION).toBe("us-east-1");
    expect(allEnv.CLUSTER).toBe("oss-fleet-prod");
    expect(allEnv.SERVICE).toBe("mementos-prod");
    expect(allEnv.WEB_FAMILY).toBe("mementos-prod");
    expect(allEnv.WEB_CONTAINER).toBe("mementos");
    expect(allEnv.ECR_REPOSITORY).toBe("mementos");
    expect(allEnv.ECR_URL).toContain(".dkr.ecr.us-east-1.amazonaws.com/mementos");
  });

  test("production-deploy.sh fails loudly without MEMENTOS_CORS_ORIGIN and injects it", () => {
    const script = readFileSync(deployScriptPath, "utf8");
    expect(script).toContain("require_env MEMENTOS_CORS_ORIGIN");
    expect(script).toContain('"MEMENTOS_CORS_ORIGIN"');
  });

  test("runs in the production environment so the env-scoped MEMENTOS_PROD_* secrets resolve", () => {
    const deployJob = workflow.jobs?.deploy;
    expect(deployJob, "the workflow must declare a deploy job").toBeDefined();
    expect(deployJob?.environment).toBe("production");
  });

  test("the deploy job authenticates AWS via OIDC before the ECR login and ECS deploy", () => {
    expect(workflow.permissions?.["id-token"]).toBe("write");
    const deployJob = workflow.jobs?.deploy;
    expect(deployJob, "the workflow must declare a deploy job").toBeDefined();
    const steps = deployJob?.steps ?? [];
    const credIndex = steps.findIndex((step) => step.name === "Configure AWS credentials (GitHub OIDC)");
    expect(credIndex, "the deploy job must carry a 'Configure AWS credentials (GitHub OIDC)' step").toBeGreaterThanOrEqual(0);
    const credStep = steps[credIndex];
    expect(credStep?.uses).toContain("aws-actions/configure-aws-credentials@");
    const withArgs = credStep?.with ?? {};
    expect(withArgs["role-to-assume"]).toBe("arn:aws:iam::${{ env.AWS_ACCOUNT_ID }}:role/${{ secrets.MEMENTOS_PROD_GHA_ROLE }}");
    expect(withArgs["aws-region"]).toBe("${{ env.AWS_REGION }}");
    const ecrIndex = steps.findIndex((step) => step.name === "Login to Amazon ECR");
    expect(ecrIndex).toBeGreaterThan(credIndex);
  });

  test("the deploy job runs only behind the ci gate (needs gate, proceed condition)", () => {
    const deployJob = workflow.jobs?.deploy;
    expect(deployJob, "the workflow must declare a deploy job").toBeDefined();
    const needs = Array.isArray(deployJob?.needs) ? deployJob?.needs : [deployJob?.needs];
    expect(needs).toContain("gate");
    expect(deployJob?.if).toContain("needs.gate.outputs.proceed == 'true'");
  });
});
